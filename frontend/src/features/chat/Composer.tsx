import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { MessagePart } from "../../lib/runtimeBridge";

type ComposerProps = {
  onSubmit: (parts: MessagePart[]) => Promise<void>;
  disabled?: boolean;
  waiting?: boolean;
  observer?: boolean;
  canAttachImageUrl?: boolean;
};

export function Composer({
  onSubmit,
  disabled,
  waiting,
  observer = false,
  canAttachImageUrl,
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
        <div className="attention-row">
          {waiting && (
            <span className="attention-chip">
              <span className="chip-icon">
                <Icon name="warning" size={13} />
              </span>
              等待你的回答
            </span>
          )}
          {error && <span className="form-error">{error}</span>}
        </div>
      )}
      <div className="composer">
        {showImageInput && (
          <label className="image-url-input">
            图片 URL
            <input
              autoFocus
              disabled={disabled || sending}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://example.com/image.png"
              type="url"
              value={imageUrl}
            />
          </label>
        )}
        <textarea
          aria-label="给 Suna 发送消息"
          disabled={disabled || sending}
          onChange={(event) => setDraft(event.target.value)}
          onInput={(event) => {
            // 随内容自动增高，最多 120px（与 CSS max-height 一致）；超出后内部滚动。
            const element = event.currentTarget;
            element.style.height = "auto";
            element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
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
        <div className="composer-actions">
          {canAttachImageUrl && (
            <button
              aria-expanded={showImageInput}
              aria-label="通过图片 URL 附加图片"
              className={`attach-url-button ${showImageInput ? "active" : ""}`}
              disabled={disabled || sending}
              onClick={() => setShowImageInput((value) => !value)}
              type="button"
            >
              URL 图片
            </button>
          )}
          <span className="shortcut">⇧↵ 换行</span>
          <button
            aria-label="发送消息"
            className="send-button"
            disabled={
              (!draft.trim() && !imageUrl.trim()) || disabled || sending
            }
            onClick={() => void submit()}
            type="button"
          >
            <Icon name="arrow-up" size={18} />
          </button>
        </div>
      </div>
    </footer>
  );
}
