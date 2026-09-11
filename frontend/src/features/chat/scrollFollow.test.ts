import { describe, expect, it } from "vitest";

/**
 * 滚动跟随状态机（纯逻辑复刻 ChatTimeline 的 onScroll 判定）：
 * - 程序化滚动回声不参与跟随判定
 * - 用户向上滚动立即脱离（方向判定，不等 96px 容差）
 * - 滚回底部（96px 内）恢复跟随
 */

type State = {
  follow: boolean;
  programmatic: boolean;
  lastScrollTop: number;
};

function onScroll(
  state: State,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): State {
  const nearBottom = scrollHeight - scrollTop - clientHeight < 96;
  if (state.programmatic) {
    return {
      ...state,
      programmatic: nearBottom ? false : state.programmatic,
      lastScrollTop: scrollTop,
    };
  }
  let follow = state.follow;
  if (scrollTop < state.lastScrollTop - 1 || !nearBottom) {
    follow = false;
  } else if (nearBottom) {
    follow = true;
  }
  return { ...state, follow, lastScrollTop: scrollTop };
}

function scrollToLatest(state: State, scrollTop: number, max: number): State {
  return {
    follow: true,
    programmatic: max - scrollTop > 1 ? true : state.programmatic,
    lastScrollTop: scrollTop,
  };
}

/** 用户手势（滚轮/触摸）：立即取消程序化标记（真实代码 onUserGesture）。 */
function onUserGesture(state: State): State {
  return { ...state, programmatic: false };
}

describe("滚动跟随状态机", () => {
  it("用户上滑立即脱离跟随（不等 96px 容差）", () => {
    let state: State = {
      follow: true,
      programmatic: false,
      lastScrollTop: 5000,
    };
    // 内容高 6000，视口 800：底部 = 5200。上滑到 5150（距底 50px，容差内）
    // 方向判定：scrollTop 5150 < lastScrollTop 5000？否——5000 起点已在
    // 容差内。真实场景起点在底部（5200），先校正基线再上滑：
    state = onScroll(state, 5200, 6000, 800); // 在底部（基线）
    state = onScroll(state, 5150, 6000, 800); // 上滑 50px
    expect(state.follow).toBe(false);
  });

  it("程序化滚底的回声不翻转跟随判定", () => {
    let state: State = { follow: true, programmatic: false, lastScrollTop: 0 };
    state = scrollToLatest(state, 0, 6000);
    expect(state.programmatic).toBe(true);
    // 回声事件（中途）：follow 保持 true，不误判为用户上滑
    state = onScroll(state, 3000, 6000, 800);
    expect(state.follow).toBe(true);
    // 到底后清除标记
    state = onScroll(state, 5200, 6000, 800);
    expect(state.programmatic).toBe(false);
    expect(state.follow).toBe(true);
  });

  it("回声结束后用户上滑仍能立即脱离", () => {
    let state: State = { follow: true, programmatic: true, lastScrollTop: 0 };
    state = onScroll(state, 5200, 6000, 800); // 回声到底
    state = onScroll(state, 5100, 6000, 800); // 用户上滑 100px
    expect(state.follow).toBe(false);
  });

  it("脱离后滚回底部恢复跟随", () => {
    let state: State = {
      follow: false,
      programmatic: false,
      lastScrollTop: 3000,
    };
    state = onScroll(state, 5150, 6000, 800);
    expect(state.follow).toBe(true);
  });

  it("流式竞态：滚底途中用户滚轮接管，不被回声拽回", () => {
    // 真实竞态：跟随中 delta 到达 → scrollToLatest（平滑滚动）→
    // 用户在滚动途中滚轮上滑 → 后续回声必须按用户意图判定。
    let state: State = {
      follow: true,
      programmatic: false,
      lastScrollTop: 5200,
    };
    state = scrollToLatest(state, 5200, 6200); // delta 触发滚底
    expect(state.programmatic).toBe(true);
    // 用户滚轮上滑（onUserGesture 先清标记，scroll 随后到达）
    state = onUserGesture(state);
    state = onScroll(state, 5000, 6200, 800); // 滚动位置被滚轮改变
    expect(state.follow).toBe(false);
    // 后续内容更新不再滚底（follow=false）——用户决策不被覆盖
  });

  it("流式竞态：120ms 手势窗口内的 delta 不滚底", () => {
    // 用户刚滚完（<120ms）时 effect 暂缓滚底：跟随判定可能尚未翻转，
    // 此窗口内滚底会覆盖用户滚动。
    let state: State = {
      follow: true,
      programmatic: false,
      lastScrollTop: 5200,
    };
    const gestureAt = Date.now();
    state = onUserGesture(state);
    // effect 判定：followRef.current && Date.now() - gestureAt > 120
    const shouldScroll =
      state.follow && Date.now() - gestureAt <= 120 ? false : state.follow;
    expect(shouldScroll).toBe(false);
  });
});
