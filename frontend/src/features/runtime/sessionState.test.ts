import { describe, expect, it } from "vitest";

import type { SessionSnapshot } from "../../lib/runtimeBridge";
import {
  blankActive,
  flowFromSnapshot,
  interactionsFromSnapshot,
} from "./sessionState";

describe("blankActive", () => {
  it("returns an empty narrative flow and no pending users", () => {
    const active = blankActive();
    expect(active.flow).toEqual([]);
    expect(active.pendingUsers).toEqual([]);
    expect(active.snapshot).toBeUndefined();
    expect(active.run).toBeUndefined();
  });
});

describe("flowFromSnapshot", () => {
  it("recovers reasoning and assistant buffers as unfinished segments", () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "running",
        client_count: 2,
      },
      current_run: {
        run_id: "run-1",
        status: "running",
        phase: "model",
        can_control: false,
        reasoning_buffer: "正在分析问题…",
        assistant_buffer: "好的，我来处理。",
      },
    };
    const flow = flowFromSnapshot(snapshot);
    // 顺序：reasoning 在前、assistant 在后；都是未结束段（运行中 Join 恢复用）。
    expect(flow).toHaveLength(2);
    expect(flow[0]).toMatchObject({
      kind: "reasoning",
      text: "正在分析问题…",
      done: false,
    });
    expect(flow[1]).toMatchObject({
      kind: "assistant",
      text: "好的，我来处理。",
      done: false,
    });
  });

  it("recovers only reasoning when assistant buffer is empty", () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "running",
        client_count: 1,
      },
      current_run: {
        run_id: "run-1",
        status: "running",
        can_control: false,
        reasoning_buffer: "思考中…",
      },
    };
    const flow = flowFromSnapshot(snapshot);
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ kind: "reasoning", text: "思考中…" });
  });

  it("returns an empty flow when there is no active run buffer", () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "idle",
        client_count: 1,
      },
    };
    expect(flowFromSnapshot(snapshot)).toEqual([]);
  });
});

describe("interactionsFromSnapshot", () => {
  it("marks waiting for ask without a replyable card (no interaction id)", () => {
    const snapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "waiting" as const,
        client_count: 1,
      },
      current_run: {
        run_id: "run-1",
        status: "waiting" as const,
        phase: "ask" as const,
        waiting_type: "ask" as const,
        can_control: true,
      },
    };
    const restored = interactionsFromSnapshot(snapshot);
    // 快照没有交互 id：占位卡不可回复，等待真实 agent.ask_user 通知替换。
    expect(restored.ask?.id).toBe("");
    expect(restored.ask?.can_reply).toBe(false);
    expect(restored.waitingForInteraction).toBe(true);
    expect(restored.restoredPhase).toBe("ask");
  });

  it("marks waiting for guard without a replyable card", () => {
    const snapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "waiting" as const,
        client_count: 1,
      },
      current_run: {
        run_id: "run-1",
        status: "waiting" as const,
        phase: "guard" as const,
        waiting_type: "guard" as const,
        can_control: false,
      },
    };
    const restored = interactionsFromSnapshot(snapshot);
    expect(restored.guard?.id).toBe("");
    expect(restored.guard?.can_reply).toBe(false);
    expect(restored.waitingForInteraction).toBe(true);
    expect(restored.restoredPhase).toBe("guard");
  });

  it("returns only phase when run is not waiting for interaction", () => {
    const snapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "running" as const,
        client_count: 1,
      },
      current_run: {
        run_id: "run-1",
        status: "running" as const,
        phase: "tool" as const,
        can_control: true,
      },
    };
    const restored = interactionsFromSnapshot(snapshot);
    expect(restored.ask).toBeUndefined();
    expect(restored.guard).toBeUndefined();
    expect(restored.waitingForInteraction).toBeUndefined();
    expect(restored.restoredPhase).toBe("tool");
  });
});
