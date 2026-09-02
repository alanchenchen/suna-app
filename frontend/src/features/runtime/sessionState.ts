import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
  CompactResultEvent,
  FlowSegment,
  GuardConfirmEvent,
  SessionSnapshot,
  SteeringMessage,
  ToolStartEvent,
  ToolSummary,
} from "../../lib/runtimeBridge";

/** 会话操作的作用域：attach 意图序号 + 会话 + 可选 run_id。 */
export type Scope = {
  attach: number;
  sessionId: string;
  runId?: string;
};

export type PendingUserMessage = { id: string; content: string };

/** 当前选中会话的活跃状态：快照、按序叙事流与待处理交互。 */
export type ActiveData = {
  snapshot?: SessionSnapshot;
  /** 本轮 run 的按序叙事流：思考 / 工具 / 回复按到达顺序排列。 */
  flow: FlowSegment[];
  usage?: AgentUsageEvent;
  run?: AgentRunEvent;
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  toolSummary?: ToolSummary;
  activeTool?: ToolStartEvent & { status?: "running" | "guard" | "failed" };
  /** 最近一次压缩（compact）的过程/结果：由 session.compact_result 驱动。 */
  compact?: CompactResultEvent;
  pendingUsers: PendingUserMessage[];
  /**
   * 运行中注入的引导消息（agent.steer），按 sequence 升序；
   * state=removed 的条目由通知驱动移除。
   */
  steering?: SteeringMessage[];
  /**
   * 已发送但尚未收到权威 agent.run（非终态）的等待窗口。
   * 用于在 pendingUsers 被 user_message 确认清空、而 running 尚未由
   * run_start 置位的空档期，驱动活动卡显示“等待模型”。
   */
  awaitingRun?: boolean;
  /** attach 恢复时展示的进行中 run 阶段（model/tool/compact/guard/ask）。 */
  restoredPhase?: string;
  /** attach 恢复时 run 在等待交互但尚无详情（真实通知到达前显示占位）。 */
  waitingForInteraction?: boolean;
};

export const blankActive = (): ActiveData => ({
  flow: [],
  pendingUsers: [],
  steering: [],
});

/**
 * 从权威快照的进行中 buffer 恢复叙事流：reasoning 在前、assistant 在后，
 * 均为未结束段（运行中 attach / 发送后 reattach 时使用）。
 * 同时恢复进行中 run 的交互：waiting_type=ask/guard 时重建决策卡，
 * 并记录 restoredPhase 供 UI 展示恢复后的运行阶段。
 */
export function flowFromSnapshot(snapshot: SessionSnapshot): FlowSegment[] {
  const flow: FlowSegment[] = [];
  if (snapshot.current_run?.reasoning_buffer) {
    flow.push({
      kind: "reasoning",
      id: Date.now(),
      text: snapshot.current_run.reasoning_buffer,
      done: false,
    });
  }
  if (snapshot.current_run?.assistant_buffer) {
    flow.push({
      kind: "assistant",
      id: Date.now() + 1,
      text: snapshot.current_run.assistant_buffer,
      done: false,
    });
  }
  return flow;
}

/**
 * 从权威快照恢复进行中 run 的交互（ask/guard）与阶段信息。
 * attach 后 UI 据此直接展示等待中的决策卡，而不是等下一次通知。
 * 注意：快照只有 waiting_type，没有交互 id——重建的卡片不能直接回复
 * （agent.askReply/guardReply 需要真实 id），真实交互会通过
 * agent.ask_user / agent.guard_confirm 通知到达并替换占位。
 */
export function interactionsFromSnapshot(snapshot: SessionSnapshot): {
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  restoredPhase?: string;
  /** 快照显示 run 在等待交互但尚无交互详情：UI 应显示“等待详情”占位。 */
  waitingForInteraction?: boolean;
} {
  const run = snapshot.current_run;
  if (!run) return {};
  const restoredPhase = run.phase;
  if (run.waiting_type === "ask") {
    return {
      ask: {
        id: "",
        question: "",
        options: [],
        can_reply: false,
        allow_custom: true,
      },
      restoredPhase,
      waitingForInteraction: true,
    };
  }
  if (run.waiting_type === "guard") {
    return {
      guard: {
        id: "",
        tool: "",
        params: {},
        readonly: false,
        reason: "",
        can_reply: false,
      },
      restoredPhase,
      waitingForInteraction: true,
    };
  }
  return { restoredPhase };
}

export function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
