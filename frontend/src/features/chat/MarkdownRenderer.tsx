import { Children, useState, type ReactElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps } from "react";
import { Icon } from "../../components/Icon";

type MarkdownProps = ComponentProps<typeof Markdown>;

/** 递归提取 React 节点树的纯文本（复制用）。 */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as ReactElement).props as { children?: ReactNode };
    return extractText(props?.children);
  }
  return "";
}

/** 代码块：语言标签 + 复制按钮；内容超高时内部滚动（不撑爆消息卡片）。 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0] as ReactElement | undefined;
  const props = (child?.props ?? {}) as {
    className?: string;
    children?: ReactNode;
  };
  const lang = /language-([\w-]+)/.exec(props.className ?? "")?.[1] ?? "text";
  // 提取纯文本：children 可能是单个文本节点或多节点数组，递归拼接避免
  // String() 对数组插入逗号。
  const code = extractText(props.children);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败。
    }
  }
  return (
    <div className="mt-3 mb-3 overflow-hidden rounded-xl border border-line bg-surface-raised/70">
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-1.5">
        <span className="font-mono text-[10px] font-bold text-ink-muted">
          {lang}
        </span>
        <button
          aria-label="复制代码"
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
          onClick={() => void copy()}
          type="button"
        >
          <Icon name="copy" size={11} />
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {/* 覆盖 .markdown-body pre 的底色/边框/圆角/外边距：容器已承担视觉，
          pre 只负责内滚动与排版，避免“框中框”。 */}
      <pre className="m-0 max-h-[420px] overflow-auto rounded-none border-0 bg-transparent p-3 font-mono text-[11.5px] leading-[1.7] text-ink-soft">
        {children}
      </pre>
    </div>
  );
}

/**
 * 真正渲染 Markdown 的模块：与 LazyMarkdown 分离，使 react-markdown 与
 * remark-gfm 只进入这一个异步 chunk（约 50KB gzip），首屏不加载。
 */
export default function MarkdownRenderer(props: MarkdownProps) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{ pre: CodeBlock, ...props.components }}
      {...props}
    />
  );
}
