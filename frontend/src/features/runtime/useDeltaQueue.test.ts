// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SetStateAction } from "react";
import type { ActiveData, Scope } from "./sessionState";
import { blankActive } from "./sessionState";
import { useDeltaQueue } from "./useDeltaQueue";

/**
 * 测试装置：渲染 useDeltaQueue，提供可变的 scope / syncing 状态，
 * 并把 flush 后的 flow 暴露给断言。
 */
function createHarness() {
  let active: ActiveData = blankActive();
  let scope: Scope | undefined = { attach: 1, sessionId: "s1" };
  let syncing = false;
  const setActive = vi.fn((updater: SetStateAction<ActiveData>) => {
    active = typeof updater === "function" ? updater(active) : updater;
  });
  const setScope = vi.fn((next: Scope) => {
    scope = next;
  });
  const rendered = renderHook(() =>
    useDeltaQueue({
      setActive: setActive as never,
      getScope: () => scope,
      setScope: setScope as never,
      isSyncing: () => syncing,
    }),
  );
  return {
    result: rendered.result,
    setScopeValue: (next: Scope | undefined) => {
      scope = next;
    },
    setSyncing: (value: boolean) => {
      syncing = value;
    },
    getActive: () => active,
    setScopeMock: setScope,
  };
}

describe("useDeltaQueue", () => {
  // jsdom 自带 requestAnimationFrame（按 16ms 帧调度）；
  // 不要 stub 它——同步执行会干扰 React 渲染挂载。
  // 测试里通过 act + 微任务等待帧回调执行。

  it("buffers deltas into a single narrative flow segment", async () => {
    const h = createHarness();
    await act(async () => {
      h.result.current.queueDelta("assistant", "你好", "run-1");
      h.result.current.queueDelta("assistant", "，世界", "run-1");
      // 等待 rAF 帧回调 flush。
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const flow = h.getActive().flow;
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({
      kind: "assistant",
      text: "你好，世界",
      done: false,
    });
    // 首个 delta 携带 run_id 时绑定作用域。
    expect(h.setScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("starts a new segment when kind changes", async () => {
    const h = createHarness();
    await act(async () => {
      h.result.current.queueDelta("reasoning", "思考中", "run-1");
      // 每帧只 flush 一次：两次 delta 各占一帧，确保分成两段。
      await new Promise((resolve) => requestAnimationFrame(resolve));
      h.result.current.queueDelta("assistant", "回复", "run-1");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const flow = h.getActive().flow;
    expect(flow).toHaveLength(2);
    expect(flow[0]).toMatchObject({ kind: "reasoning", text: "思考中" });
    expect(flow[1]).toMatchObject({ kind: "assistant", text: "回复" });
  });

  it("closes earlier narrative segments when a new segment starts", async () => {
    const h = createHarness();
    // 预置恢复场景：快照段已 done（flowFromSnapshot 的产物）。
    h.getActive().flow.push({
      kind: "reasoning",
      id: 1,
      text: "恢复的思考",
      done: true,
    });
    await act(async () => {
      h.result.current.queueDelta("reasoning", "继续思考", "run-1");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const flow = h.getActive().flow;
    // 快照段保持 done；新 delta 开新段继续流式，而不是并入快照段
    // （否则两段内容混在一起，且“思考中”状态会错误地叠加）。
    expect(flow).toHaveLength(2);
    expect(flow[0]).toMatchObject({ text: "恢复的思考", done: true });
    expect(flow[1]).toMatchObject({ text: "继续思考", done: false });
  });

  it("marks earlier segments done when new reasoning follows finished assistant", async () => {
    const h = createHarness();
    // 预置：快照恢复了 reasoning+assistant 两段（均 done=true）。
    h.getActive().flow.push(
      { kind: "reasoning", id: 1, text: "快照思考", done: true },
      { kind: "assistant", id: 2, text: "快照回复", done: true },
    );
    await act(async () => {
      h.result.current.queueDelta("reasoning", "新一轮思考", "run-1");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const flow = h.getActive().flow;
    // 前面的叙事段全部收口，只有末尾新段是未结束：避免双“思考中”。
    expect(flow).toHaveLength(3);
    expect(flow[0]).toMatchObject({ kind: "reasoning", done: true });
    expect(flow[1]).toMatchObject({ kind: "assistant", done: true });
    expect(flow[2]).toMatchObject({ kind: "reasoning", done: false });
  });

  it("rejects deltas from a different run after scope is bound", async () => {
    const h = createHarness();
    h.setScopeValue({ attach: 1, sessionId: "s1", runId: "run-1" });
    await act(async () => {
      h.result.current.queueDelta("assistant", "旧 run", "run-1");
      h.result.current.queueDelta("assistant", "迟到", "run-2");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const flow = h.getActive().flow;
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ kind: "assistant", text: "旧 run" });
  });

  it("drops deltas while syncing", async () => {
    const h = createHarness();
    h.setSyncing(true);
    await act(async () => {
      h.result.current.queueDelta("assistant", "不应出现", "run-1");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(h.getActive().flow).toEqual([]);
  });

  it("resetQueuedDeltas clears buffered items", async () => {
    const h = createHarness();
    await act(async () => {
      h.result.current.queueDelta("assistant", "第一段", "run-1");
      h.result.current.resetQueuedDeltas();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(h.getActive().flow).toEqual([]);
  });
});
