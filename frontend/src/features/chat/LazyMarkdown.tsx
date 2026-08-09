import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type MarkdownRenderer from "./MarkdownRenderer";

// react-markdown + remark-gfm 只在渲染消息内容时才需要：用 React.lazy
// 让 Vite 将其拆为独立异步 chunk，首屏（连接页/总览/空会话）不再加载。
// 首次使用时才请求该 chunk；加载中显示纯文本占位（等宽、半透明）。
const Renderer = lazy(() => import("./MarkdownRenderer"));

type MarkdownProps = ComponentProps<typeof MarkdownRenderer>;

/** 懒加载的 Markdown 渲染：首次渲染消息时才加载解析栈（约 50KB gzip）。 */
export function LazyMarkdown(props: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <span className="block whitespace-pre-wrap opacity-70">
          {String(props.children)}
        </span>
      }
    >
      <Renderer {...props} />
    </Suspense>
  );
}
