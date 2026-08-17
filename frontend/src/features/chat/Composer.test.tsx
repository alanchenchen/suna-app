import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../lib/i18n";
import { Composer } from "./Composer";

/** 包裹 LocaleProvider：组件内部 useT() 需要 context。 */
function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = vi.fn<() => Promise<void>>();
  render(
    <LocaleProvider>
      <Composer onSubmit={onSubmit} {...props} />
    </LocaleProvider>,
  );
  return { onSubmit };
}

function type(text: string) {
  const textarea = screen.getByRole("textbox", { name: /message suna/i });
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

describe("Composer 乐观清空状态机", () => {
  it("发送成功后清空草稿", async () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockResolvedValue(undefined);

    const textarea = type("hello");
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(onSubmit).toHaveBeenCalledWith([{ type: "text", text: "hello" }]);
    // 发送瞬间草稿已清空（乐观清空）。
    expect(textarea).toHaveProperty("value", "");
  });

  it("发送失败时恢复草稿", async () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockRejectedValue(new Error("boom"));

    const textarea = type("keep me");
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    // 等失败处理完成（microtask）后草稿恢复。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textarea).toHaveProperty("value", "keep me");
  });

  it("空草稿时发送按钮禁用", () => {
    renderComposer();
    const button = screen.getByRole("button", { name: /send message/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("Enter 发送（非 Shift）", () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockResolvedValue(undefined);

    const textarea = type("enter send");
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter 不发送（换行）", () => {
    const { onSubmit } = renderComposer();
    onSubmit.mockResolvedValue(undefined);

    const textarea = type("shift enter");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
