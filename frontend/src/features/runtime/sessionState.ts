import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
  CompactResultEvent,
  FlowSegment,
  GuardConfirmEvent,
  SessionSnapshot,
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
   * 已发送但尚未收到权威 agent.run（非终态）的等待窗口。
   * 用于在 pendingUsers 被 user_message 确认清空、而 running 尚未由
   * run_start 置位的空档期，驱动活动卡显示“等待模型”。
   */
  awaitingRun?: boolean;
};

export const blankActive = (): ActiveData => ({
  flow: [],
  pendingUsers: [],
});

/**
 * 从权威快照的进行中 buffer 恢复叙事流：reasoning 在前、assistant 在后，
 * 均为未结束段（运行中 attach / 发送后 reattach 时使用）。
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

export function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
