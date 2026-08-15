import type { Dispatch, SetStateAction } from "react";
import type {
  MCPServerInfo,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
  ToolFlowItem,
} from "../../lib/runtimeBridge";
import type { ActiveData, Scope } from "./sessionState";

/** 单个 run 的时间线工具卡上限：超出丢弃最旧，避免超长 run 累积 DOM。 */
const MAX_TOOL_CARDS = 24;

export type NotificationDeps = {
  setActive: Dispatch<SetStateAction<ActiveData>>;
  setConfig: Dispatch<SetStateAction<RuntimeConfig | undefined>>;
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
 */
export function createNotificationHandler({
  setActive,
  setConfig,
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
  return (event: RuntimeNotification) => {
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
        const next: ActiveData = {
          ...value,
          run: event.params,
          snapshot: value.snapshot
            ? {
                ...value.snapshot,
                current_run: {
                  run_id: event.params.run_id,
                  status:
                    event.params.state === "done" ||
                    event.params.state === "cancelled" ||
                    event.params.state === "failed"
                      ? "idle"
                      : // cancelling/retrying/running 都保持 running 展示：
                        // 取消收尾阶段 UI 仍应显示任务在进行，can_control 以
                        // 事件参数为准（cancelling 时 Runtime 会置 false）。
                        "running",
                  phase: event.params.phase,
                  can_control: event.params.can_control,
                },
              }
            : value.snapshot,
        };
        // 运行终态兜底：sessions 目录的 status 可能因 session.updated 通知
        // 丢失（重连窗口）而卡在 running，导致 observer 误判、输入框禁用；
        // 这里直接以 run 事件为准同步置为 idle。
        if (
          event.params.state === "done" ||
          event.params.state === "cancelled" ||
          event.params.state === "failed"
        ) {
          markSessionIdle(getSelectedId());
        }
        // 叙事流保留：思考/回复段全部标为已结束，工具卡与回复块作为
        // 本轮操作流继续显示在时间线中（不再清空、不再拍平成消息）。
        if (event.params.state === "done" && value.snapshot) {
          next.flow = value.flow.map((segment) =>
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
      const item: ToolFlowItem = {
        id: event.params.id,
        tool: event.params.tool,
        intent: event.params.intent,
        params: event.params.params,
        status: "running",
        // 前端本地计时：tool_start 记录开始时间，tool_end 计算耗时。
        startedAt: Date.now(),
      };
      setActive((value) => {
        // 工具开始 = 之前的思考/回复段落结束；工具卡按顺序插入叙事流。
        const flow = value.flow.map((segment) =>
          segment.kind === "assistant" || segment.kind === "reasoning"
            ? { ...segment, done: true }
            : segment,
        );
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
          ...value,
          activeTool: { ...event.params, status: "running" },
          flow: [...flow, { kind: "tool", item }],
        };
      });
      return;
    }
    if (event.method === "agent.tool_guard") {
      setActive((value) => ({
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
      }));
      return;
    }
    if (event.method === "agent.tool_end") {
      setActive((value) => ({
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
                  // tool_end 时结算耗时；若缺失 startedAt（如快照恢复）则不计。
                  durationMs: segment.item.startedAt
                    ? Date.now() - segment.item.startedAt
                    : undefined,
                },
              }
            : segment,
        ),
      }));
      return;
    }
    if (event.method === "agent.ask_user") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({ ...value, ask: event.params }));
      return;
    }
    if (event.method === "agent.guard_confirm") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({ ...value, guard: event.params }));
      return;
    }
    if (event.method === "agent.interaction_resolved") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({
        ...value,
        ask: value.ask?.id === event.params.id ? undefined : value.ask,
        guard: value.guard?.id === event.params.id ? undefined : value.guard,
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
    if (event.method === "session.user_message") {
      if (!acceptsSession(event.params.session_id)) return;
      const text = event.params.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const content =
        text ||
        (event.params.parts?.some((part) => part.type === "image")
          ? "[图片]"
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
