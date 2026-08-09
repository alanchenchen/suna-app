import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { MessagePart } from "../../lib/runtimeBridge";

type ComposerProps = {
  onSubmit: (parts: MessagePart[]) => Promise<void>;
  disabled?: boolean;
  waiting?: boolean;
  observer?: boolean;
  canAttachImageUrl?: boolean;
  /** Increment to request focus on the composer textarea. */
  focusTrigger?: number;
};

export function Composer({
  onSubmit,
  disabled,
  waiting,
  observer = false,
  canAttachImageUrl,
  focusTrigger = 0,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 发送后清空草稿时，把自动增高的高度恢复为初始值。
    if (!draft && textareaRef.current) textareaRef.current.style.height = "";
  }, [draft]);

  useEffect(() => {
    if (focusTrigger > 0 && !disabled) textareaRef.current?.focus();
  }, [disabled, focusTrigger]);

  async function submit() {
    const message = draft.trim();
    const url = imageUrl.trim();
    if ((!message && !url) || sending || disabled) return;
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
          throw new Error();
      } catch {
        setError("请输入以 http:// 或 https:// 开头的图片地址。");
        return;
      }
    }
    setSending(true);
    setError(undefined);
    try {
      const parts: MessagePart[] = [];
      if (message) parts.push({ type: "text", text: message });
      if (url) parts.push({ type: "image", source: { kind: "url", url } });
      await onSubmit(parts);
      setDraft("");
      setImageUrl("");
      setShowImageInput(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "消息发送失败。");
    } finally {
      setSending(false);
    }
  }

  return (
    <footer className="composer-area">
      {(waiting || error) && (
        <div className="mx-auto mb-2 flex w-[min(720px,100%)] items-center justify-between">
          {waiting && (
            <span className="inline-flex min-h-[27px] animate-[slide-up_240ms_cubic-bezier(0.2,0.8,0.2,1)_both] items-center gap-1.5 rounded-full border border-amber/20 bg-amber-soft px-2 py-1 text-[10px] font-extrabold text-amber">
              <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-amber/15">
                <Icon name="warning" size={13} />
              </span>
              等待你的回答
            </span>
          )}
          {error && (
            <span className="text-[12px] font-semibold text-rose">{error}</span>
          )}
        </div>
      )}
      <div className="mx-auto w-[min(720px,100%)] rounded-[20px] border border-line bg-surface-solid px-4 pt-3 pb-2.5 shadow-[0_8px_24px_rgba(28,42,72,0.08),var(--shadow-sm)] transition-[border-color,box-shadow,transform] duration-180 focus-within:border-blue/40 focus-within:shadow-[0_0_0_3px_var(--color-blue-soft),var(--shadow-md)] max-[720px]:rounded-2xl max-[720px]:px-3 max-[720px]:pt-2.5 max-[720px]:pb-2">
        {showImageInput && (
          <label className="mb-2 grid gap-1 px-0.5 text-[10px] font-bold text-ink-muted">
            图片 URL
            <input
              autoFocus
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              disabled={disabled || sending}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://example.com/image.png"
              type="url"
              value={imageUrl}
            />
          </label>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            aria-label="给 Suna 发送消息"
            className="min-h-[38px] max-h-[132px] flex-1 resize-none bg-transparent px-1 py-[9px] text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-muted max-[720px]:min-h-[44px] max-[720px]:py-[11px]"
            disabled={disabled || sending}
            onChange={(event) => setDraft(event.target.value)}
            onInput={(event) => {
              // 随内容自动增高，最多 132px（与 CSS max-height 一致）；超出后内部滚动。
              const element = event.currentTarget;
              element.style.height = "auto";
              element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
            }}
            onKeyDown={(event) => {
              // isComposing：中文输入法组合输入中的回车用于选词，不能发送。
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              disabled
                ? observer
                  ? "其他客户端正在运行此会话，当前仅可查看…"
                  : "请先选择一个会话…"
                : "给 Suna 发送消息…"
            }
            ref={textareaRef}
            rows={1}
            value={draft}
          />
          <div className="flex shrink-0 items-center gap-1.5 pb-1.5">
            {canAttachImageUrl && (
              <button
                aria-expanded={showImageInput}
                aria-label="通过图片 URL 附加图片"
                className={`grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[11px] transition-colors duration-150 ${showImageInput ? "bg-blue-soft text-blue-strong" : "text-ink-muted hover:bg-surface-subtle hover:text-ink"}`}
                disabled={disabled || sending}
                onClick={() => setShowImageInput((value) => !value)}
                type="button"
              >
                <Icon name="image" size={16} />
              </button>
            )}
            <button
              aria-label="发送消息"
              className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[11px] bg-blue text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[transform,background,box-shadow] duration-160 hover:bg-blue-strong hover:shadow-[0_7px_15px_var(--color-blue-glow)] hover:-translate-y-px active:scale-90 disabled:cursor-default disabled:opacity-40 disabled:shadow-none max-[720px]:h-[42px] max-[720px]:w-[42px]"
              disabled={
                (!draft.trim() && !imageUrl.trim()) || disabled || sending
              }
              onClick={() => void submit()}
              type="button"
            >
              <Icon name="arrow-up" size={17} />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
