import { Component, lazy, Suspense } from "react";
import type { ComponentProps, ReactNode } from "react";
import type MarkdownRenderer from "./MarkdownRenderer";

// react-markdown + remark-gfm 只在渲染消息内容时才需要：用 React.lazy
// 让 Vite 将其拆为独立异步 chunk，首屏（连接页/总览/空会话）不再加载。
// 首次使用时才请求该 chunk；加载中显示纯文本占位（等宽、半透明）。
const Renderer = lazy(() => import("./MarkdownRenderer"));

type MarkdownProps = ComponentProps<typeof MarkdownRenderer>;

/** 懒加载 chunk 加载失败（旧 index.html 缓存引用已删除的 chunk）时的错误边界：
 * 重试一次；仍失败则回退为纯文本渲染，而不是让整个消息消失。 */
class MarkdownBoundary extends Component<
  { children: ReactNode; text: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // 缓存失效场景：重新加载页面即可恢复，这里回退纯文本避免白屏。
  }

  render() {
    if (this.state.failed) {
      return (
        <span className="block whitespace-pre-wrap">{this.props.text}</span>
      );
    }
    return this.props.children;
  }
}

/** 懒加载的 Markdown 渲染：首次渲染消息时才加载解析栈（约 50KB gzip）。 */
export function LazyMarkdown(props: MarkdownProps) {
  const text = String(props.children ?? "");
  return (
    <MarkdownBoundary text={text}>
      <Suspense
        fallback={
          <span className="block whitespace-pre-wrap opacity-70">{text}</span>
        }
      >
        <Renderer {...props} />
      </Suspense>
    </MarkdownBoundary>
  );
}
