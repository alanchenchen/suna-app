import { describe, expect, it, vi } from "vitest";

import type {
  FlowSegment,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
} from "../../lib/runtimeBridge";
import type { ActiveData } from "./sessionState";
import { blankActive } from "./sessionState";
import {
  createNotificationHandler,
  type NotificationDeps,
} from "./runtimeEvents";

/**
 * 测试装置：模拟 NotificationDeps，setActive 直接执行函数式 updater，
 * 让断言可以读取事件处理后的最新 active 状态。
 */
function createHarness(
  overrides: Partial<Record<"acceptsRun" | "acceptsSession", boolean>> = {},
) {
  let active: ActiveData = blankActive();
  let config: RuntimeConfig | undefined;
  const deps = {
    setActive: vi.fn(
      (updater: Parameters<NotificationDeps["setActive"]>[0]) => {
        active =
          typeof updater === "function"
            ? (updater as (value: ActiveData) => ActiveData)(active)
            : updater;
      },
    ),
    setConfig: vi.fn((value: Parameters<NotificationDeps["setConfig"]>[0]) => {
      config = typeof value === "function" ? value(config) : value;
    }),
    queueDelta: vi.fn(),
    flushDeltas: vi.fn(),
    acceptsRun: vi.fn(() => overrides.acceptsRun ?? true),
    acceptsSession: vi.fn(() => overrides.acceptsSession ?? true),
    mergeSession: vi.fn(),
    markSessionIdle: vi.fn(),
    mergeMcp: vi.fn(),
    getScope: vi.fn(() => ({ attach: 1, sessionId: "s1" })),
    isSyncing: vi.fn(() => false),
    getSelectedId: vi.fn(() => "s1"),
  };
  const handler = createNotificationHandler(deps);
  const send = (event: RuntimeNotification) => handler(event);
  return { deps, send, getActive: () => active, getConfig: () => config };
}

function snapshotSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    cwd: "/tmp",
    message_count: 0,
    created_at: "",
    updated_at: "",
    status: "idle",
    client_count: 1,
    ...overrides,
  };
}

describe("createNotificationHandler", () => {
  it("forwards agent.delta to the delta queue with run id", () => {
    const { deps, send } = createHarness();
    send({
      method: "agent.delta",
      params: { kind: "assistant", content: "你好", run_id: "run-1" },
    });
    expect(deps.queueDelta).toHaveBeenCalledWith("assistant", "你好", "run-1");
  });

  it("rejects agent.run from a stale run id", () => {
    const { deps, send } = createHarness({ acceptsRun: false });
    send({
      method: "agent.run",
      params: { run_id: "stale", state: "done", can_control: false },
    });
    expect(deps.flushDeltas).not.toHaveBeenCalled();
    expect(deps.markSessionIdle).not.toHaveBeenCalled();
  });

  it("marks segments done and session idle on run done", () => {
    const { deps, send, getActive } = createHarness();
    // 预置进行中的快照与叙事流（模拟 Join 恢复或发送后的进行中状态）。
    deps.setActive((value) => ({
      ...value,
      snapshot: {
        session: snapshotSession({ status: "running" }),
        current_run: { run_id: "run-1", status: "running", can_control: true },
      },
      flow: [
        { kind: "reasoning", id: 1, text: "思考中", done: false },
        { kind: "assistant", id: 2, text: "回复中", done: false },
      ],
    }));
    deps.setActive.mockClear();

    send({
      method: "agent.run",
      params: { run_id: "run-1", state: "done", can_control: false },
    });

    // done 前 flush 积压 delta。
    expect(deps.flushDeltas).toHaveBeenCalled();
    // 终态兜底：目录会话置 idle。
    expect(deps.markSessionIdle).toHaveBeenCalledWith("s1");
    const active = getActive();
    // current_run 状态收敛为 idle。
    expect(active.snapshot?.current_run?.status).toBe("idle");
    // 叙事流段全部标为已结束（工具段除外）。
    expect(
      active.flow.every((segment) => segment.kind === "tool" || segment.done),
    ).toBe(true);
  });

  it("keeps running display and uses event can_control on cancelling", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      snapshot: {
        session: snapshotSession({ status: "running" }),
        current_run: { run_id: "run-1", status: "running", can_control: true },
      },
    }));
    deps.setActive.mockClear();

    send({
      method: "agent.run",
      params: { run_id: "run-1", state: "cancelling", can_control: false },
    });

    const active = getActive();
    // cancelling 非终态：目录不置 idle、run 状态保留为 running 展示。
    expect(deps.markSessionIdle).not.toHaveBeenCalled();
    expect(active.run?.state).toBe("cancelling");
    expect(active.snapshot?.current_run?.status).toBe("running");
    expect(active.snapshot?.current_run?.can_control).toBe(false);
  });

  it("marks session idle on failed and exposes run error", () => {
    const { deps, send, getActive } = createHarness();
    send({
      method: "agent.run",
      params: {
        run_id: "run-1",
        state: "failed",
        can_control: false,
        error: {
          kind: "http",
          message: "429 too many requests",
          status_code: 429,
        },
        resume_available: true,
      },
    });
    expect(deps.markSessionIdle).toHaveBeenCalledWith("s1");
    const active = getActive();
    expect(active.run?.state).toBe("failed");
    expect(active.run?.error?.kind).toBe("http");
    expect(active.run?.resume_available).toBe(true);
  });

  it("appends a tool card on tool_start and finalizes it on tool_end", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.tool_start",
      params: {
        id: "t1",
        tool: "readfile",
        params: { path: "/tmp/a" },
        intent: "读取文件",
      },
    });
    let active = getActive();
    expect(active.activeTool?.tool).toBe("readfile");
    const toolSegment = active.flow.find((s) => s.kind === "tool");
    expect(toolSegment).toMatchObject({
      kind: "tool",
      item: { id: "t1", tool: "readfile", status: "running" },
    });

    send({
      method: "agent.tool_guard",
      params: {
        tool_call_id: "t1",
        tool: "readfile",
        risk: "medium",
        decision: "ask",
        source: "guard",
      },
    });
    active = getActive();
    const guarded = active.flow.find(
      (s): s is Extract<FlowSegment, { kind: "tool" }> =>
        s.kind === "tool" && s.item.id === "t1",
    );
    expect(guarded?.item.status).toBe("guard");

    send({
      method: "agent.tool_end",
      params: { id: "t1", tool: "readfile", result: "ok" },
    });
    active = getActive();
    const done = active.flow.find(
      (s): s is Extract<FlowSegment, { kind: "tool" }> =>
        s.kind === "tool" && s.item.id === "t1",
    );
    if (done?.kind !== "tool") {
      throw new Error("tool segment not found");
    }
    expect(done.item.status).toBe("success");
    expect(done.item.result).toBe("ok");
    expect(active.activeTool).toBeUndefined();
  });

  it("marks tool failed and keeps result on tool_end error", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.tool_start",
      params: { id: "t2", tool: "exec", params: {}, intent: "跑测试" },
    });
    send({
      method: "agent.tool_end",
      params: { id: "t2", tool: "exec", result: "exit 1", error: true },
    });
    const segment = getActive().flow.find(
      (s): s is Extract<FlowSegment, { kind: "tool" }> =>
        s.kind === "tool" && s.item.id === "t2",
    );
    if (segment?.kind !== "tool") {
      throw new Error("tool segment not found");
    }
    expect(segment.item.status).toBe("failed");
  });

  it("stores ask and guard with reply permission", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.ask_user",
      params: {
        id: "ask-1",
        session_id: "s1",
        question: "继续吗？",
        options: ["继续", "停止"],
        can_reply: true,
        allow_custom: false,
      },
    });
    expect(getActive().ask?.question).toBe("继续吗？");
    expect(getActive().ask?.can_reply).toBe(true);

    send({
      method: "agent.guard_confirm",
      params: {
        id: "g-1",
        session_id: "s1",
        tool: "rm",
        params: { path: "/tmp/x" },
        risk: "high",
        reason: "删除文件",
        can_reply: false,
      },
    });
    expect(getActive().guard?.tool).toBe("rm");
    expect(getActive().guard?.can_reply).toBe(false);
  });

  it("clears resolved interactions", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.ask_user",
      params: {
        id: "ask-1",
        session_id: "s1",
        question: "q",
        can_reply: true,
        allow_custom: false,
      },
    });
    send({
      method: "agent.interaction_resolved",
      params: { id: "ask-1", session_id: "s1" },
    });
    expect(getActive().ask).toBeUndefined();
  });

  it("merges session catalog and refreshes snapshot session when attached", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      snapshot: { session: snapshotSession({ status: "idle" }) },
    }));
    deps.setActive.mockClear();

    const updated = snapshotSession({ status: "running", client_count: 2 });
    send({ method: "session.updated", params: { session: updated } });

    // 目录增量总是合并。
    expect(deps.mergeSession).toHaveBeenCalledWith(updated);
    // 已 attach 的会话同步更新 snapshot 内的 session 视图。
    expect(getActive().snapshot?.session.status).toBe("running");
  });

  it("appends user message and removes matching pending entry", () => {
    const { deps, send, getActive } = createHarness();
    // 预置一条 pending 用户消息（发送后未收到确认时前端先展示）。
    deps.setActive((value) => ({
      ...value,
      snapshot: { session: snapshotSession(), messages: [] },
      pendingUsers: [{ id: "p1", content: "你好" }],
    }));
    deps.setActive.mockClear();

    send({
      method: "session.user_message",
      params: { session_id: "s1", parts: [{ type: "text", text: "你好" }] },
    });

    const active = getActive();
    // 已确认送达：pending 中匹配项移除，消息追加到快照。
    expect(active.pendingUsers).toHaveLength(0);
    expect(active.snapshot?.messages).toContainEqual({
      role: "user",
      content: "你好",
    });
  });

  it("forwards mcp.updated to the mcp snapshot", () => {
    const { deps, send } = createHarness();
    send({
      method: "mcp.updated",
      params: {
        server: {
          name: "dbx",
          active: true,
          configured: true,
          tool_count: 12,
          state: "active",
        },
      },
    });
    expect(deps.mergeMcp).toHaveBeenCalledWith(
      expect.objectContaining({ name: "dbx", state: "active" }),
    );
  });

  it("ignores session-scoped events for other sessions", () => {
    const { send, getActive } = createHarness({ acceptsSession: false });
    send({
      method: "agent.ask_user",
      params: {
        id: "ask-1",
        session_id: "other",
        question: "q",
        can_reply: true,
        allow_custom: false,
      },
    });
    // 会话不匹配时 ask 不应被保存。
    expect(getActive().ask).toBeUndefined();
  });
});
