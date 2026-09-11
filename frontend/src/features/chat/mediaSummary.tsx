import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";

/**
 * 媒体引用摘要的友好展示（与 TUI renderMediaSummary 对齐）。
 *
 * Runtime 把用户消息里的图片块替换为确定性生成的摘要文本
 * （`[image: name.png, image/png, 89.8KB, source=attachment:name.png]`），
 * 并标记 `kind=media`。摘要文本里的 source 供模型读回原图，不适合直接
 * 展示给用户；这里解析出名称/大小，渲染成"图片 · name · size"的媒体卡。
 */

/** 从摘要文本解析展示信息：名称、MIME、大小。解析失败安全降级。 */
export function parseMediaSummary(summary: string): {
  name?: string;
  mime?: string;
  size?: string;
} {
  const inner = summary.trim().replace(/^\[/, "").replace(/\]$/, "");
  const parts = inner.split(",").map((part) => part.trim());
  if (parts.length < 2) return {};
  // 首段形如 "image: name.png"：取冒号后的名称。
  let name = parts[0];
  const colon = name.indexOf(":");
  if (colon >= 0) name = name.slice(colon + 1).trim();
  let mime: string | undefined;
  let size: string | undefined;
  for (const part of parts.slice(1)) {
    if (part.startsWith("source=")) continue;
    // MIME 含 "/"；大小是纯数字+单位（如 1.2MB / 89.8KB / 512B）。
    if (part.includes("/")) {
      mime ??= part;
    } else if (/^[\d.]+\s*[A-Za-z]+$/.test(part)) {
      size ??= part;
    }
  }
  return { name: name || undefined, mime, size };
}

/** 媒体摘要卡：图片图标 + "图片" + 名称 + 大小（ZCode 形态的紧凑媒体行）。 */
export function MediaSummary({ content }: { content: string }) {
  const t = useT();
  const { name, size } = parseMediaSummary(content);
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-[10px] bg-surface-subtle/80 px-2.5 py-1.5">
      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-blue-soft text-blue-strong">
        <Icon name="image" size={12} />
      </span>
      <span className="shrink-0 text-[11px] font-bold text-ink">
        {t("chat.mediaImage")}
      </span>
      {name && (
        <span
          className="min-w-0 truncate font-mono text-[10.5px] text-ink-soft"
          title={name}
        >
          {name}
        </span>
      )}
      {size && (
        <span className="shrink-0 font-mono text-[10px] text-ink-muted">
          {size}
        </span>
      )}
    </span>
  );
}
