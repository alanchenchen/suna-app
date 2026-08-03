import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../../components/Icon";
import type { SnapshotMessage } from "../../lib/runtimeBridge";

type ActiveTool = {
  id?: string;
  tool: string;
  intent?: string;
  status?: "running" | "guard" | "failed";
};

type ChatTimelineProps = {
  messages: SnapshotMessage[];
  assistantBuffer?: string;
  reasoningBuffer?: string;
  running: boolean;
  /** Runtime phase, supplied by the application shell when available. */
  phase?: string;
  /** A sent user turn that is awaiting a Runtime response. */
  pending?: boolean;
  /** The current Runtime tool, supplied by the application shell when available. */
  activeTool?: ActiveTool;
  /** Changes when Runtime attaches another session, resetting scroll anchoring. */
  sessionId?: string;
};

function activityCopy(
  phase?: string,
  pending?: boolean,
  activeTool?: ActiveTool,
) {
  if (phase === "ask") {
    return {
      label: "等待你的回答",
      detail: "收到回复后会继续处理任务",
      tone: "ask",
    };
  }
  if (activeTool?.status === "failed") {
    return {
      label: "工具执行未完成",
      detail: activeTool.intent || activeTool.tool,
      tone: "failed",
    };
  }
  if (activeTool?.status === "guard" || phase === "guard") {
    return {
      label: "等待你确认操作",
      detail: activeTool?.intent || activeTool?.tool || "此操作需要授权后继续",
      tone: "guard",
    };
  }
  if (phase === "compact" || phase === "compacting") {
    return {
      label: "正在整理上下文",
      detail: "整理完成后将继续任务",
      tone: "compact",
    };
  }
  if (phase === "skill") {
    return {
      label: "正在准备技能",
      detail: "正在加载完成任务所需的能力",
      tone: "skill",
    };
  }
  if (activeTool || phase === "tool") {
    return {
      label: activeTool?.status === "running" ? "正在执行工具" : "正在准备工具操作",
      detail: activeTool?.intent || activeTool?.tool || "正在处理任务中的下一步",
      tone: "tool",
    };
  }
  if (phase === "model") {
    return {
      label: "正在分析任务",
      detail: "Suna 正在组织下一步操作",
      tone: "model",
    };
  }
  if (pending) {
    return {
      label: "已收到你的消息",
      detail: "Suna 正在开始处理这个任务",
      tone: "pending",
    };
  }
  return {
    label: "正在处理任务",
    detail: "Suna 正在准备下一步",
    tone: "model",
  };
}

function ActivityDots() {
  return (
    <span aria-hidden="true" className="activity-dots">
      <i />
      <i />
      <i />
    </span>
  );
}

function StreamActivity({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <span className="responding">
      <ActivityDots />
      <span role="status">{label}</span>
      {detail && <span className="responding-detail">· {detail}</span>}
    </span>
  );
}

export function ChatTimeline({
  messages,
  assistantBuffer,
  reasoningBuffer,
  running,
  phase,
  pending,
  activeTool,
  sessionId,
}: ChatTimelineProps) {
  const [historyWindow, setHistoryWindow] = useState(80);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const lastContentKeyRef = useRef("");
  const historyAnchorRef = useRef<{ height: number; top: number } | undefined>(
    undefined,
  );
  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    nearBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  };
  useLayoutEffect(() => {
    // A different session may happen to contain the same number of messages.
    // Reset the timeline rather than inheriting the previous session's scroll.
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    setHistoryWindow(80);
    requestAnimationFrame(() => scrollToLatest("auto"));
  }, [sessionId]);
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor || !element) return;
    element.scrollTop = anchor.top + (element.scrollHeight - anchor.height);
    historyAnchorRef.current = undefined;
  }, [historyWindow]);
  useLayoutEffect(() => {
    const key = `${sessionId ?? "none"}:${messages.length}:${assistantBuffer?.length ?? 0}:${reasoningBuffer?.length ?? 0}:${running}:${pending}:${phase ?? ""}:${activeTool?.id ?? ""}:${activeTool?.status ?? ""}`;
    if (lastContentKeyRef.current === key) return;
    lastContentKeyRef.current = key;
    // Keep an active conversation anchored only when the reader is already at
    // its latest edge. Browsing history must never be force-scrolled away.
    if (nearBottomRef.current) scrollToLatest("auto");
  }, [
    activeTool?.id,
    activeTool?.status,
    assistantBuffer,
    messages.length,
    pending,
    phase,
    reasoningBuffer,
    running,
    sessionId,
  ]);

  const hasStream = Boolean(reasoningBuffer || assistantBuffer);
  const showActivityCard = Boolean((running || pending) && !hasStream);
  const streamActivity = activityCopy(phase, false, activeTool);
  const activity = activityCopy(phase, pending, activeTool);

  return (
    <div className="conversation-wrap" onScroll={onScroll} ref={scrollRef}>
      <section className="conversation" aria-label="会话消息">
        {messages.length === 0 &&
          !assistantBuffer &&
          !showActivityCard &&
          !reasoningBuffer && (
          <div className="empty-conversation">
            <span className="agent-avatar">
              <Icon name="sparkle" size={16} />
            </span>
            <h2>开始一个任务</h2>
            <p>告诉 Suna 你想在这个工作目录中完成什么。</p>
          </div>
        )}
        {messages.length > historyWindow && (
          <button
            className="load-history"
            onClick={() => {
              const element = scrollRef.current;
              if (element)
                historyAnchorRef.current = {
                  height: element.scrollHeight,
                  top: element.scrollTop,
                };
              setHistoryWindow((count) => count + 80);
            }}
            type="button"
          >
            显示更早的 {Math.min(80, messages.length - historyWindow)} 条消息
          </button>
        )}
        {messages.slice(-historyWindow).map((message, index) => (
          <article
            className={`message ${message.role === "user" ? "user-message" : "agent-message"}`}
            key={`${messages.length - historyWindow + index}-${message.role}`}
          >
            <div className="message-meta">
              <span
                className={
                  message.role === "user" ? "avatar small" : "agent-avatar"
                }
              >
                {message.role === "user" ? (
                  "你"
                ) : (
                  <Icon name="sparkle" size={14} />
                )}
              </span>
              <strong>{message.role === "user" ? "你" : "Suna"}</strong>
            </div>
            <div className="message-body">
              {message.role === "assistant" ? (
                <Markdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </Markdown>
              ) : (
                message.content
              )}
            </div>
          </article>
        ))}
        {showActivityCard && (
          <section
            aria-atomic="true"
            aria-live="polite"
            className={`agent-activity-card ${activity.tone}`}
            role="status"
          >
            <span className="agent-activity-icon">
              <Icon name={activity.tone === "guard" ? "warning" : "sparkle"} size={17} />
            </span>
            <span className="agent-activity-copy">
              <strong>{activity.label}</strong>
              <small>{activity.detail}</small>
            </span>
            <ActivityDots />
          </section>
        )}
        {reasoningBuffer && (
          <article className="message agent-message">
            <div className="message-meta">
              <span className="agent-avatar">
                <Icon name="sparkle" size={14} />
              </span>
              <strong>Suna</strong>
              <StreamActivity label="正在思考" detail={streamActivity.detail} />
            </div>
            <div className="message-body">
              <p>{reasoningBuffer}</p>
            </div>
          </article>
        )}
        {assistantBuffer && (
          <article className="message agent-message arriving">
            <div className="message-meta">
              <span className="agent-avatar">
                <Icon name="sparkle" size={14} />
              </span>
              <strong>Suna</strong>
              {(running || pending) && (
                <StreamActivity label="正在回复" detail={streamActivity.detail} />
              )}
            </div>
            <div className="message-body">
              <Markdown remarkPlugins={[remarkGfm]}>{assistantBuffer}</Markdown>
            </div>
          </article>
        )}
        <div ref={endRef} />
      </section>
      {showJumpToLatest && (
        <button
          className="jump-to-latest"
          onClick={() => scrollToLatest()}
          type="button"
        >
          <Icon name="arrow-up" size={14} />
          回到最新消息
        </button>
      )}
    </div>
  );
}
