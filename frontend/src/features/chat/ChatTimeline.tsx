import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { Icon } from "../../components/Icon";
import type {
  AskUserEvent,
  FlowSegment,
  GuardConfirmEvent,
  SnapshotMessage,
  ToolSummary,
} from "../../lib/runtimeBridge";
import {
  activityCopy,
  ActivityDots,
  DecisionCard,
  LONG_MESSAGE_THRESHOLD,
  LongMessage,
  ReasoningBlock,
  StreamActivity,
  toneClasses,
  ToolCard,
} from "./blocks";
import { LazyMarkdown } from "./LazyMarkdown";

type ActiveTool = {
  id?: string;
  tool: string;
  intent?: string;
  status?: "running" | "guard" | "failed";
};

type ChatTimelineProps = {
  messages: SnapshotMessage[];
  /** 本轮 run 的按序叙事流：思考 / 工具 / 回复按到达顺序排列。 */
  flow?: FlowSegment[];
  running: boolean;
  /** Runtime 阶段（由应用壳提供时）。 */
  phase?: string;
  /** 已发送、正在等待 Runtime 响应的用户回合。 */
  pending?: boolean;
  /** 当前正在执行的 Runtime 工具（由应用壳提供时）。 */
  activeTool?: ActiveTool;
  /** 当前会话的工具执行汇总。 */
  toolSummary?: ToolSummary;
  /** 待处理的用户决策，内嵌渲染在时间线中。 */
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  onAskReply?: (id: string, answer: string) => Promise<void>;
  onGuardReply?: (id: string, decision: "approve" | "reject") => Promise<void>;
  /** 另一个客户端拥有 run 时禁用决策控件。 */
  controlsDisabled?: boolean;
  /** Runtime attach 了其他会话时变化，用于重置滚动锚点。 */
  sessionId?: string;
  /** 会话快照加载中时显示骨架占位。 */
  loading?: boolean;
};

export function ChatTimeline({
  messages,
  flow = [],
  running,
  phase,
  pending,
  activeTool,
  toolSummary,
  ask,
  guard,
  onAskReply,
  onGuardReply,
  controlsDisabled = false,
  sessionId,
  loading = false,
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
    // 不同的会话可能恰好包含相同数量的消息：重置时间线而不是继承
    // 上一个会话的滚动位置。
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
    const key = `${sessionId ?? "none"}:${messages.length}:${flow.length}:${flow.map((s) => (s.kind === "tool" ? "t" : `${s.kind[0]}${s.text.length}${s.done ? "d" : ""}`)).join(",")}:${running}:${pending}:${phase ?? ""}:${activeTool?.id ?? ""}:${activeTool?.status ?? ""}`;
    if (lastContentKeyRef.current === key) return;
    lastContentKeyRef.current = key;
    // 只在读者已经位于最新边缘时保持活跃对话锚定；浏览历史时绝不能被
    // 强制滚动离开。
    if (nearBottomRef.current) scrollToLatest("auto");
  }, [
    activeTool?.id,
    activeTool?.status,
    flow,
    messages.length,
    pending,
    phase,
    running,
    sessionId,
  ]);

  const hasStream = flow.some(
    (segment) =>
      (segment.kind === "reasoning" || segment.kind === "assistant") &&
      !segment.done,
  );
  const showActivityCard = Boolean((running || pending) && !hasStream);
  const streamActivity = activityCopy(phase, false, activeTool);
  const activity = activityCopy(phase, pending, activeTool);
  const toneClass = toneClasses[activity.tone] ?? toneClasses.default;

  return (
    <div className="conversation-wrap" onScroll={onScroll} ref={scrollRef}>
      <section
        aria-label="会话消息"
        className="animate-[message-in_300ms_cubic-bezier(0.2,0.8,0.2,1)_both] mx-auto w-[min(720px,calc(100%-48px))] px-0 pt-8 pb-12 max-[720px]:w-[min(100%-28px,640px)] max-[720px]:pt-6 max-[720px]:pb-7"
        key={sessionId ?? "none"}
      >
        {loading && (
          <div aria-busy="true" className="space-y-7">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="mb-2 flex items-center gap-1.5">
                  <div className="h-[21px] w-[21px] rounded-[7px] bg-surface-subtle" />
                  <div className="h-2.5 w-14 rounded bg-surface-subtle" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full max-w-[420px] rounded bg-surface-subtle" />
                  <div className="h-3 w-3/4 max-w-[320px] rounded bg-surface-subtle" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading &&
          messages.length === 0 &&
          flow.length === 0 &&
          !showActivityCard && (
            <div className="flex min-h-[300px] animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex-col items-center justify-center text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(145deg,#7c98ff,#536dde_62%,#744fc7)] text-white shadow-[0_8px_24px_rgba(83,109,222,0.35)]">
                <Icon name="sparkle" size={22} />
              </span>
              <h2 className="mt-4 mb-1.5 text-[17px] font-extrabold tracking-tight text-ink">
                开始一个任务
              </h2>
              <p className="m-0 max-w-[300px] text-[12.5px] leading-relaxed text-ink-muted">
                告诉 Suna 你想在这个工作目录中完成什么，它会负责执行与推进。
              </p>
              <div className="mt-6 grid gap-2 text-left">
                <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-solid px-3.5 py-2.5 shadow-sm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-soft text-blue-strong">
                    <Icon name="search" size={14} />
                  </span>
                  <span className="text-[12px] text-ink-soft">
                    让 Suna 分析代码、查找问题并解释架构
                  </span>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-solid px-3.5 py-2.5 shadow-sm">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-green-soft text-green">
                    <Icon name="check" size={14} />
                  </span>
                  <span className="text-[12px] text-ink-soft">
                    让它修改文件、运行测试并汇报结果
                  </span>
                </div>
              </div>
            </div>
          )}
        {!loading && messages.length > historyWindow && (
          <button
            className="mb-6 block cursor-pointer rounded-full bg-blue-soft px-3 py-2 text-[11px] font-extrabold text-blue-strong transition-[transform,background] duration-160 hover:bg-blue/20 hover:-translate-y-px mx-auto"
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
        {!loading &&
          messages.slice(-historyWindow).map((message, index) => (
            <article
              className={`mb-7 animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both] max-[720px]:mb-6`}
              key={`${messages.length - historyWindow + index}-${message.role}`}
            >
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-soft">
                <span
                  className={
                    message.role === "user"
                      ? "grid h-[21px] w-[21px] place-items-center rounded-[7px] bg-blue-soft text-[7px] font-bold text-blue-strong"
                      : "grid h-[21px] w-[21px] place-items-center rounded-[7px] bg-[linear-gradient(145deg,#7c98ff,#536dde_62%,#744fc7)] text-white"
                  }
                >
                  {message.role === "user" ? (
                    "你"
                  ) : (
                    <Icon name="sparkle" size={14} />
                  )}
                </span>
                <strong className="text-ink">
                  {message.role === "user" ? "你" : "Suna"}
                </strong>
              </div>
              <div className="min-w-0 max-w-[650px] text-[13px] leading-[1.82] tracking-tight text-ink [overflow-wrap:anywhere] max-[720px]:text-[12.5px] max-[720px]:leading-[1.76]">
                {message.role === "assistant" ? (
                  message.content.length > LONG_MESSAGE_THRESHOLD ? (
                    <LongMessage text={message.content} />
                  ) : (
                    <div className="markdown-body rounded-[18px] bg-surface-subtle/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <LazyMarkdown>{message.content}</LazyMarkdown>
                    </div>
                  )
                ) : (
                  <span className="inline-block max-w-[min(640px,100%)] rounded-[4px_15px_15px_15px] border border-line bg-surface-solid px-3.5 py-3 text-ink leading-[1.7] shadow-sm">
                    {message.content}
                  </span>
                )}
              </div>
            </article>
          ))}
        {!loading && (
          <DecisionCard
            ask={ask}
            controlsDisabled={controlsDisabled}
            guard={guard}
            onAskReply={onAskReply}
            onGuardReply={onGuardReply}
          />
        )}
        {!loading && showActivityCard && (
          <section
            aria-atomic="true"
            aria-live="polite"
            className={`mb-7 grid max-w-[520px] min-h-[68px] animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[15px] border p-3 shadow-sm ${toneClass}`}
            role="status"
          >
            <span className="agent-activity-icon grid h-[34px] w-[34px] place-items-center rounded-[11px] bg-surface-solid shadow-sm">
              <Icon
                name={activity.tone === "guard" ? "warning" : "sparkle"}
                size={17}
              />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <strong className="text-[11px] font-extrabold text-ink">
                {activity.label}
              </strong>
              <small className="truncate text-[10px] leading-[1.4] text-ink-muted">
                {activity.detail}
              </small>
            </span>
            <ActivityDots />
          </section>
        )}
        {!loading && flow.length > 0 && (
          <div aria-label="执行过程" className="space-y-7">
            {flow.map((segment) => {
              if (segment.kind === "reasoning") {
                return (
                  <ReasoningBlock
                    done={segment.done}
                    key={segment.id}
                    running={running && !segment.done}
                    text={segment.text}
                  />
                );
              }
              if (segment.kind === "tool") {
                return <ToolCard item={segment.item} key={segment.item.id} />;
              }
              const streaming = !segment.done;
              return (
                <article
                  className="arriving animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] [animation-delay:80ms]"
                  key={segment.id}
                >
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-soft">
                    <span className="grid h-[21px] w-[21px] place-items-center rounded-[7px] bg-[linear-gradient(145deg,#7c98ff,#536dde_62%,#744fc7)] text-white">
                      <Icon name="sparkle" size={14} />
                    </span>
                    <strong className="text-ink">Suna</strong>
                    {streaming && (running || pending) && (
                      <StreamActivity
                        label="正在回复"
                        detail={streamActivity.detail}
                      />
                    )}
                  </div>
                  <div
                    className={`min-w-0 max-w-[650px] rounded-[18px] px-4 py-3 text-[13px] leading-[1.82] tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [overflow-wrap:anywhere] ${streaming ? "bg-surface-subtle/70 text-ink whitespace-pre-wrap" : "markdown-body bg-surface-subtle/70 text-ink"}`}
                  >
                    {/* 流式过程中用纯文本（不解析 Markdown）：避免每帧对
                        全文重新解析导致 O(n²)；完成后才一次性渲染。 */}
                    {streaming ? (
                      <>
                        {segment.text}
                        <span
                          aria-hidden="true"
                          className="ml-[3px] inline-block h-[1em] w-[2px] animate-[stream-blink_1s_steps(1)_infinite] rounded-[1px] bg-blue align-[-0.15em]"
                        />
                      </>
                    ) : (
                      <LazyMarkdown>{segment.text}</LazyMarkdown>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!loading &&
          flow.filter((segment) => segment.kind === "tool").length === 0 &&
          toolSummary &&
          toolSummary.total > 0 && (
            <section className="mb-7 max-w-[520px] animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[15px] border border-line bg-surface-solid p-3.5 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-ink">
                  <span className="grid h-[21px] w-[21px] place-items-center rounded-[7px] bg-blue-soft text-blue-strong">
                    <Icon name="tool" size={13} />
                  </span>
                  工具执行
                </span>
                <span className="text-[10px] font-bold text-ink-muted">
                  共 {toolSummary.total} 次 · {toolSummary.success} 成功
                  {toolSummary.failed > 0 && (
                    <span className="text-rose">
                      {" "}
                      · {toolSummary.failed} 失败
                    </span>
                  )}
                </span>
              </div>
              {toolSummary.recent?.slice(0, 4).map((tool, index) => (
                <div
                  className="flex items-center gap-2 border-t border-line/60 py-2 text-[11px] first:border-t-0"
                  key={`${tool.tool}-${index}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-[6px] w-[6px] shrink-0 rounded-full ${tool.status === "success" ? "bg-green" : tool.status === "failed" ? "bg-rose" : "bg-ink-muted"}`}
                  />
                  <code className="shrink-0 font-mono text-[11px] font-semibold text-ink">
                    {tool.tool}
                  </code>
                  {tool.summary && (
                    <span className="truncate text-ink-muted">
                      {tool.summary}
                    </span>
                  )}
                </div>
              ))}
            </section>
          )}
        <div ref={endRef} />
      </section>
      {showJumpToLatest && (
        <button
          className="animate-[slide-up_240ms_cubic-bezier(0.2,0.8,0.2,1)_both] sticky bottom-4 left-1/2 z-10 -mt-4 mb-4 flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-blue/25 bg-surface-solid/95 px-3 py-2 text-[11px] font-extrabold text-blue-strong shadow-md backdrop-blur-xl transition-[transform,background] duration-160 hover:bg-surface-solid hover:-translate-y-px"
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
