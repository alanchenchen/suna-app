import type { Dispatch, SetStateAction } from "react";
import type {
  MCPServerInfo,
  ModelsDiscoveryResult,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
  ToolFlowItem,
} from "../../lib/runtimeBridge";
import { t } from "../../lib/i18n";
import type { ActiveData, Scope } from "./sessionState";

/** 单个 run 的时间线工具卡上限：超出丢弃最旧，避免超长 run 累积 DOM。 */
const MAX_TOOL_CARDS = 24;

/**
 * 从 tool_end.metadata 提取 Runtime 权威耗时（毫秒）。
 * exec 系工具由 daemon 在执行侧计时（不含 SSE 传输/批处理延迟），
 * 比前端 receivedAt 差值更接近 TUI 的本地计时；其他工具无此字段。
 */
function metadataDuration(
  metadata?: Record<string, unknown>,
): number | undefined {
  const value = metadata?.["duration_ms"];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export type NotificationDeps = {
  setActive: Dispatch<SetStateAction<ActiveData>>;
  setConfig: Dispatch<SetStateAction<RuntimeConfig | undefined>>;
  /** config.discoverModels 异步结果：按 provider 合并到本地模型发现缓存。 */
  onModelsDiscovered: (result: ModelsDiscoveryResult) => void;
  queueDelta: (
    kind: "assistant" | "reasoning",
    content: string,
    runId?: string,
  ) => void;
  flushDeltas: () => void;
  acceptsRun: (runId?: string) => boolean;
  acceptsSession: (sessionId?: string) => boolean;
  mergeSession: (session: SessionInfo) => void;
  /** 运行终态兜底：把目录中该 session 的 status 置为 idle，不依赖 session.updated 通知。 */
  markSessionIdle: (sessionId?: string) => void;
  mergeMcp: (server: MCPServerInfo) => void;
  getScope: () => Scope | undefined;
  isSyncing: () => boolean;
  getSelectedId: () => string | undefined;
};

/**
 * 构造 Runtime 通知处理器。事件与当前 attach 作用域绑定：
 * 会话无关的全局通知（session.updated 目录增量、config.state）始终处理；
 * 会话相关通知（agent.*、session.user_message）必须匹配当前作用域。
 * receivedAt 为解析层收到事件时刻（工具计时起点/终点），比在 React
 * setState 回调里取 Date.now() 更接近真实执行窗口。
 */
export function createNotificationHandler({
  setActive,
  setConfig,
  onModelsDiscovered,
  queueDelta,
  flushDeltas,
  acceptsRun,
  acceptsSession,
  mergeSession,
  markSessionIdle,
  mergeMcp,
  getScope,
  isSyncing,
  getSelectedId,
}: NotificationDeps) {
  return (event: RuntimeNotification, receivedAt = Date.now()) => {
    if (event.method === "session.updated") {
      mergeSession(event.params.session);
      if (acceptsSession(event.params.session.id))
        setActive((value) =>
          value.snapshot?.session.id === event.params.session.id
            ? {
                ...value,
                snapshot: {
                  ...value.snapshot,
                  session: event.params.session,
                },
              }
            : value,
        );
      return;
    }
    if (event.method === "config.state") {
      setConfig(event.params);
      return;
    }
    if (event.method === "config.models_result") {
      onModelsDiscovered(event.params);
      return;
    }
    // 0.4 MCP 状态增量：按 server 名覆盖本地快照，驱动设置面板状态徽章。
    if (event.method === "mcp.updated") {
      mergeMcp(event.params.server);
      return;
    }
    if (event.method === "agent.delta") {
      queueDelta(event.params.kind, event.params.content, event.params.run_id);
      return;
    }
    if (event.method === "agent.run") {
      if (!acceptsRun(event.params.run_id)) return;
      // 终态事件前先提交本帧内积压的 delta，避免最后一段内容重复出现。
      if (event.params.state === "done") flushDeltas();
      setActive((value) => {
        const terminal =
          event.params.state === "done" ||
          event.params.state === "cancelled" ||
          event.params.state === "failed";
        // 轮次耗时行（模仿 TUI）：run 终态且本轮调用过工具时，在叙事流
        // 末尾追加“已工作”行。Runtime 权威 usage.duration_ms 优先
        // （含模型等待与全部工具执行），本地计时仅在缺失时兑底。
        let flow = value.flow;
        if (terminal && value.hadToolCall) {
          const durationMs =
            value.usage?.duration_ms ??
            (value.runStartedAt != null
              ? receivedAt - value.runStartedAt
              : undefined);
          if (durationMs != null && durationMs >= 0) {
            flow = [
              ...flow,
              {
                kind: "turnDuration",
                id: Date.now(),
                durationMs,
                endedAt: receivedAt,
              },
            ];
          }
        }
        const next: ActiveData = {
          ...value,
          flow,
          run: event.params,
          // 终态后清零计时状态，下轮 run 重新开始；非终态首次出现时记录起点。
          runStartedAt: terminal
            ? undefined
            : (value.runStartedAt ?? receivedAt),
          hadToolCall: terminal ? false : value.hadToolCall,
          // 收到权威 run 事件（含终态）即结束“等待模型”窗口。
          awaitingRun: false,
          // 终态对账：daemon 对 session.user_message 通知屏蔽发送者本人
          // （协议 §5：owner 不回显），乐观 pendingUsers 等不到回执。
          // run 终态即本轮对话已入权威快照，本地清空 pending——否则
          // loading 永不消失、后续 re-attach 后与快照重复渲染。
          pendingUsers: terminal ? [] : value.pendingUsers,
          snapshot: value.snapshot
            ? {
                ...value.snapshot,
                current_run: {
                  run_id: event.params.run_id,
                  // terminal 时置 idle；cancelling/retrying/running 保持
                  // running 展示：取消收尾阶段 UI 仍显示任务在进行，
                  // can_control 以事件参数为准（cancelling 时 Runtime 置 false）。
                  status: terminal ? ("idle" as const) : ("running" as const),
                  phase: event.params.phase,
                  can_control: event.params.can_control,
                },
              }
            : value.snapshot,
        };
        // 运行终态兑底：sessions 目录的 status 可能因 session.updated 通知
        // 丢失（重连窗口）而卡在 running，导致 observer 误判、输入框禁用；
        // 这里直接以 run 事件为准同步置为 idle。
        if (terminal) {
          markSessionIdle(getSelectedId());
          // 乐观消息并入权威快照：若终态通知早于状态保存落库（快照里
          // 还没有这条 user turn），补一条占位，保证与 re-attach 后的
          // 权威 messages 一致，不重不漏。
          if (next.snapshot && value.pendingUsers.length > 0) {
            const existing = new Set(
              (next.snapshot.messages ?? []).map(
                (message) => `${message.role}:${message.content}`,
              ),
            );
            const merged = [...(next.snapshot.messages ?? [])];
            for (const item of value.pendingUsers) {
              if (!existing.has(`user:${item.content}`)) {
                merged.push({ role: "user", content: item.content });
              }
            }
            next.snapshot = { ...next.snapshot, messages: merged };
          }
        }
        // 叙事流保留：思考/回复段全部标为已结束，工具卡与回复块作为
        // 本轮操作流继续显示在时间线中（不再清空、不再拍平成消息）。
        if (event.params.state === "done" && value.snapshot) {
          next.flow = next.flow.map((segment) =>
            segment.kind === "assistant" || segment.kind === "reasoning"
              ? { ...segment, done: true }
              : segment,
          );
        }
        return next;
      });
      return;
    }
    if (event.method === "agent.usage") {
      if (!acceptsRun(event.params.run_id)) return;
      setActive((value) => ({ ...value, usage: event.params }));
      return;
    }
    if (event.method === "agent.tool_start") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      const id = event.params.id;
      const subtaskMatch = id.match(/^spawn:([^:]+):(.+)$/);
      const isSpawn = event.params.tool === "spawn";
      setActive((value) => {
        // 工具开始 = 之前的思考/回复段落结束；工具卡按顺序插入叙事流。
        const flow = value.flow.map((segment) =>
          segment.kind === "assistant" || segment.kind === "reasoning"
            ? { ...segment, done: true }
            : segment,
        );
        // 工具已开始执行：明确结束“等待模型”窗口。
        const base = { ...value, awaitingRun: false };
        // 子任务内部工具（id 前缀 spawn:<spawnID>:）：归入对应子任务组。
        if (subtaskMatch) {
          const spawnId = subtaskMatch[1];
          const index = flow.findIndex(
            (segment) =>
              segment.kind === "subtask" && segment.item.id === spawnId,
          );
          if (index < 0) return { ...base, flow };
          const segment = flow[index];
          if (segment.kind !== "subtask") return { ...base, flow };
          const item: ToolFlowItem = {
            id,
            tool: event.params.tool,
            intent: event.params.intent,
            params: event.params.params,
            status: "running",
            startedAt: receivedAt,
          };
          const next = [...flow];
          next[index] = {
            kind: "subtask",
            item: { ...segment.item, tools: [...segment.item.tools, item] },
          };
          return {
            ...base,
            activeTool: { ...event.params, status: "running" },
            flow: next,
          };
        }
        // spawn 工具自身：创建子任务组段（替代普通工具行）。
        if (isSpawn) {
          const task =
            typeof event.params.params?.task === "string"
              ? event.params.params.task
              : event.params.intent;
          // spawn params 里的权威元数据：模型 ref 与被授予的工具清单。
          const model =
            typeof event.params.params?.model === "string"
              ? event.params.params.model
              : undefined;
          const grantedTools = Array.isArray(event.params.params?.tools)
            ? event.params.params.tools.filter(
                (name): name is string => typeof name === "string",
              )
            : undefined;
          return {
            ...base,
            activeTool: { ...event.params, status: "running" },
            flow: [
              ...flow,
              {
                kind: "subtask",
                item: {
                  id,
                  task,
                  model,
                  grantedTools,
                  status: "running" as const,
                  tools: [],
                },
              },
            ],
          };
        }
        const item: ToolFlowItem = {
          id,
          tool: event.params.tool,
          intent: event.params.intent,
          params: event.params.params,
          status: "running",
          // 前端本地计时：以解析层收到 tool_start 的时刻为起点（receivedAt），
          // tool_end 结算耗时。相比在 setState 回调里取 Date.now()，能消除
          // React 事件循环排队造成的计时起点偏晚。
          startedAt: receivedAt,
        };
        // 单 run 工具卡硬上限：超长 run 会累积大量 DOM，丢弃最旧的
        // 工具段保持叙事顺序，历史细节由 toolSummary 统计兜底。
        const toolCount = flow.filter(
          (segment) => segment.kind === "tool",
        ).length;
        if (toolCount >= MAX_TOOL_CARDS) {
          const firstToolIndex = flow.findIndex(
            (segment) => segment.kind === "tool",
          );
          if (firstToolIndex >= 0) flow.splice(firstToolIndex, 1);
        }
        return {
          ...base,
          activeTool: { ...event.params, status: "running" },
          // 本轮已调用工具：终态时据此决定是否显示“已工作”行（与 TUI 一致）。
          hadToolCall: true,
          flow: [...flow, { kind: "tool", item }],
        };
      });
      return;
    }
    if (event.method === "agent.tool_guard") {
      const subtaskMatch =
        event.params.tool_call_id.match(/^spawn:([^:]+):(.+)$/);
      setActive((value) => {
        // 子任务内部工具的 guard：更新组内对应工具状态。
        if (subtaskMatch) {
          const spawnId = subtaskMatch[1];
          return {
            ...value,
            flow: value.flow.map((segment) =>
              segment.kind === "subtask" && segment.item.id === spawnId
                ? {
                    ...segment,
                    item: {
                      ...segment.item,
                      tools: segment.item.tools.map((tool) =>
                        tool.id === event.params.tool_call_id
                          ? { ...tool, status: "guard" as const }
                          : tool,
                      ),
                    },
                  }
                : segment,
            ),
          };
        }
        return {
          ...value,
          activeTool:
            value.activeTool?.id === event.params.tool_call_id
              ? { ...value.activeTool, status: "guard" }
              : value.activeTool,
          flow: value.flow.map((segment) =>
            segment.kind === "tool" &&
            segment.item.id === event.params.tool_call_id
              ? {
                  ...segment,
                  item: { ...segment.item, status: "guard" as const },
                }
              : segment,
          ),
        };
      });
      return;
    }
    if (event.method === "agent.tool_end") {
      const subtaskMatch = event.params.id.match(/^spawn:([^:]+):(.+)$/);
      const isSpawn = event.params.tool === "spawn";
      setActive((value) => {
        // 子任务内部工具结束：更新组内工具状态与耗时。
        if (subtaskMatch) {
          const spawnId = subtaskMatch[1];
          return {
            ...value,
            activeTool:
              value.activeTool?.id === event.params.id
                ? event.params.error
                  ? { ...value.activeTool, status: "failed" }
                  : undefined
                : value.activeTool,
            flow: value.flow.map((segment) =>
              segment.kind === "subtask" && segment.item.id === spawnId
                ? {
                    ...segment,
                    item: {
                      ...segment.item,
                      tools: segment.item.tools.map((tool) =>
                        tool.id === event.params.id
                          ? {
                              ...tool,
                              status: event.params.error
                                ? ("failed" as const)
                                : ("success" as const),
                              result: event.params.result,
                              resultTruncated: event.params.result_truncated,
                              error: event.params.error,
                              // 耗时来源与主时间线一致：Runtime 权威优先。
                              durationMs:
                                metadataDuration(event.params.metadata) ??
                                (tool.startedAt != null
                                  ? receivedAt - tool.startedAt
                                  : undefined),
                            }
                          : tool,
                      ),
                    },
                  }
                : segment,
            ),
          };
        }
        // spawn 工具自身结束：结算子任务组状态（success/failed + 结果）。
        if (isSpawn) {
          return {
            ...value,
            activeTool: undefined,
            flow: value.flow.map((segment) =>
              segment.kind === "subtask" && segment.item.id === event.params.id
                ? {
                    ...segment,
                    item: {
                      ...segment.item,
                      status: event.params.error
                        ? ("failed" as const)
                        : ("success" as const),
                      result: event.params.result,
                      error: event.params.error,
                    },
                  }
                : segment,
            ),
          };
        }
        return {
          ...value,
          activeTool:
            value.activeTool?.id === event.params.id
              ? event.params.error
                ? { ...value.activeTool, status: "failed" }
                : undefined
              : value.activeTool,
          flow: value.flow.map((segment) =>
            segment.kind === "tool" && segment.item.id === event.params.id
              ? {
                  ...segment,
                  item: {
                    ...segment.item,
                    status: event.params.error
                      ? ("failed" as const)
                      : ("success" as const),
                    result: event.params.result,
                    resultTruncated: event.params.result_truncated,
                    error: event.params.error,
                    // 耗时来源优先级：Runtime 权威 metadata.duration_ms（
                    // exec 系工具由 daemon 计时，不含 SSE 传输延迟）→
                    // 前端 receivedAt 差值兑底（其他工具）；startedAt 缺失
                    // （快照恢复）且无 metadata 时不计。
                    durationMs:
                      metadataDuration(event.params.metadata) ??
                      (segment.item.startedAt != null
                        ? receivedAt - segment.item.startedAt
                        : undefined),
                  },
                }
              : segment,
          ),
        };
      });
      return;
    }
    if (event.method === "agent.ask_user") {
      if (!acceptsSession(event.params.session_id)) return;
      // 真实交互到达：替换 attach 恢复的占位（waitingForInteraction 清除）。
      setActive((value) => ({
        ...value,
        ask: event.params,
        waitingForInteraction: false,
      }));
      return;
    }
    if (event.method === "agent.guard_confirm") {
      if (!acceptsSession(event.params.session_id)) return;
      // 真实交互到达：替换 attach 恢复的占位（waitingForInteraction 清除）。
      setActive((value) => ({
        ...value,
        guard: event.params,
        waitingForInteraction: false,
      }));
      return;
    }
    if (event.method === "agent.interaction_resolved") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({
        ...value,
        ask: value.ask?.id === event.params.id ? undefined : value.ask,
        guard: value.guard?.id === event.params.id ? undefined : value.guard,
        waitingForInteraction:
          value.ask?.id === event.params.id ||
          value.guard?.id === event.params.id
            ? false
            : value.waitingForInteraction,
        activeTool:
          value.activeTool?.id === event.params.id
            ? { ...value.activeTool, status: undefined }
            : value.activeTool,
      }));
      return;
    }
    // Skill 加载 / 校验状态：按技能名合并到叙事流中的 skill 段。
    // 同名的 loading→loaded、reviewing→done/error 是同一段生命周期，
    // 更新已有段而不是重复插入，保持时间线紧凑。
    if (event.method === "skill.load" || event.method === "skill.review") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      const name = event.params.name;
      const nextStatus =
        event.method === "skill.load"
          ? event.params.status === "loaded"
            ? ("loaded" as const)
            : ("loading" as const)
          : event.params.status === "done"
            ? ("done" as const)
            : event.params.status === "error"
              ? ("error" as const)
              : ("reviewing" as const);
      const detail =
        event.method === "skill.review"
          ? event.params.review || event.params.error
          : undefined;
      setActive((value) => {
        const index = value.flow.findIndex(
          (segment) => segment.kind === "skill" && segment.item.name === name,
        );
        if (index < 0) {
          return {
            ...value,
            flow: [
              ...value.flow,
              { kind: "skill", item: { name, status: nextStatus, detail } },
            ],
          };
        }
        const flow = [...value.flow];
        const segment = flow[index];
        if (segment.kind !== "skill") return value;
        flow[index] = {
          kind: "skill",
          item: {
            name,
            status: nextStatus,
            detail: detail ?? segment.item.detail,
          },
        };
        return { ...value, flow };
      });
      return;
    }
    // 压缩（compact）过程/结果：running=true 进入压缩中，running=false
    // 显示结果或错误。事件为全局通知，按当前作用域过滤。
    if (event.method === "session.compact_result") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      setActive((value) => ({ ...value, compact: event.params }));
      return;
    }
    if (event.method === "agent.steering") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      // daemon 直接以 SteeringMessage 作为 params 下发（协议 §5.6）。
      const message = event.params;
      if (message.run_id !== scope.runId) return;
      setActive((value) => {
        const current = value.steering ?? [];
        const exists = current.some((item) => item.id === message.id);
        const steering = exists
          ? current.map((item) => (item.id === message.id ? message : item))
          : [...current, message];
        return {
          ...value,
          steering: steering
            .filter(
              (item) => item.state !== "removed" && item.state !== "rejected",
            )
            .sort((a, b) => a.sequence - b.sequence),
        };
      });
      // applied = daemon 已消费（注入模型）；立即从待发列表移除，
      // 避免消息已出现在对话流里、输入区上方还挂着“待注入”的陈旧状态。
      if (message.state === "applied") {
        setActive((value) => ({
          ...value,
          steering: (value.steering ?? []).filter(
            (item) => item.id !== message.id,
          ),
        }));
      }
      return;
    }
    if (event.method === "session.user_message") {
      if (!acceptsSession(event.params.session_id)) return;
      const text = event.params.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const content =
        text ||
        (event.params.parts?.some((part) => part.type === "image")
          ? t("action.imagePlaceholder")
          : undefined);
      if (!content) return;
      setActive((value) => {
        const pendingIndex = value.pendingUsers.findIndex(
          (item) => item.content === content,
        );
        return {
          ...value,
          pendingUsers:
            pendingIndex < 0
              ? value.pendingUsers
              : value.pendingUsers.filter((_, index) => index !== pendingIndex),
          snapshot: value.snapshot
            ? {
                ...value.snapshot,
                messages: (value.snapshot.messages ?? []).some(
                  (message) =>
                    message.role === "user" && message.content === content,
                )
                  ? value.snapshot.messages
                  : [
                      ...(value.snapshot.messages ?? []),
                      { role: "user", content },
                    ],
              }
            : value.snapshot,
        };
      });
      return;
    }
  };
}
