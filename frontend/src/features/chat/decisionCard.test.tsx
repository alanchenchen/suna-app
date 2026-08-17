import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { DecisionCard } from "./decisionCard";

/** 包裹 LocaleProvider：组件内部 useT() 需要 context。
 * jsdom 的 navigator.language 默认 en-US，文案按英文断言。 */
function renderCard(props: Parameters<typeof DecisionCard>[0]) {
  return render(
    <LocaleProvider>
      <DecisionCard {...props} />
    </LocaleProvider>,
  );
}

/** 断言按钮 disabled（无 jest-dom matcher，用原生属性）。 */
function isDisabled(button: HTMLElement) {
  return (button as HTMLButtonElement).disabled;
}

describe("DecisionCard 交互状态机", () => {
  it("无 ask/guard 时不渲染", () => {
    const { container } = renderCard({
      controlsDisabled: false,
    });
    expect(container.firstChild).toBeNull();
  });

  it("点击选项调用 onAskReply 且提交期间按钮禁用（防连点）", async () => {
    let resolveReply!: () => void;
    const onAskReply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReply = resolve;
        }),
    );
    renderCard({
      ask: {
        id: "ask-1",
        question: "Choose",
        options: ["A", "B"],
        allow_custom: false,
        can_reply: true,
      },
      controlsDisabled: false,
      onAskReply,
    });

    const buttonA = screen.getByRole("button", { name: "A" });
    fireEvent.click(buttonA);

    // 提交中：两个选项按钮都应禁用（busy 态），避免重复入队。
    expect(onAskReply).toHaveBeenCalledTimes(1);
    expect(isDisabled(screen.getByRole("button", { name: "A" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "B" }))).toBe(true);

    // 完成后再点应再次允许。
    resolveReply();
    await waitFor(() =>
      expect(isDisabled(screen.getByRole("button", { name: "B" }))).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onAskReply).toHaveBeenCalledTimes(2);
  });

  it("guard 三按钮在提交中全部禁用", async () => {
    let resolveReply!: () => void;
    const onGuardReply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReply = resolve;
        }),
    );
    renderCard({
      guard: {
        id: "guard-1",
        tool: "edit_file",
        params: { path: "a.txt" },
        risk: "medium",
        reason: "Modify file",
        suggestion: "safe/path",
        can_reply: true,
      },
      controlsDisabled: false,
      onGuardReply,
    });

    fireEvent.click(screen.getByRole("button", { name: /apply suggestion/i }));
    expect(onGuardReply).toHaveBeenCalledWith("guard-1", "modify");
    expect(
      isDisabled(screen.getByRole("button", { name: /apply suggestion/i })),
    ).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: /reject/i }))).toBe(
      true,
    );
    expect(
      isDisabled(screen.getByRole("button", { name: /approve original/i })),
    ).toBe(true);

    resolveReply();
    await waitFor(() =>
      expect(isDisabled(screen.getByRole("button", { name: /reject/i }))).toBe(
        false,
      ),
    );
  });

  it("controlsDisabled 时选项不可点", () => {
    const onAskReply = vi.fn();
    renderCard({
      ask: {
        id: "ask-2",
        question: "Confirm?",
        options: ["OK"],
        allow_custom: false,
        can_reply: true,
      },
      controlsDisabled: true,
      onAskReply,
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onAskReply).not.toHaveBeenCalled();
  });
});
