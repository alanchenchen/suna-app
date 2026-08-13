import { describe, expect, it } from "vitest";

import type { SessionSnapshot } from "../../lib/runtimeBridge";
import { blankActive, flowFromSnapshot } from "./sessionState";

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
