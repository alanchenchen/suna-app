import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps } from "react";

type MarkdownProps = ComponentProps<typeof Markdown>;

/**
 * 真正渲染 Markdown 的模块：与 LazyMarkdown 分离，使 react-markdown 与
 * remark-gfm 只进入这一个异步 chunk（约 50KB gzip），首屏不加载。
 */
export default function MarkdownRenderer(props: MarkdownProps) {
  return <Markdown remarkPlugins={[remarkGfm]} {...props} />;
}
