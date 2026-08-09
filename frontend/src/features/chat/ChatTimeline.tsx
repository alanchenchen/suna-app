import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../../components/Icon";
import type {
  AskUserEvent,
  FlowSegment,
  GuardConfirmEvent,
  SnapshotMessage,
  ToolFlowItem,
  ToolSummary,
} from "../../lib/runtimeBridge";

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
  /** Runtime phase, supplied by the application shell when available. */
  phase?: string;
  /** A sent user turn that is awaiting a Runtime response. */
  pending?: boolean;
  /** The current Runtime tool, supplied by the application shell when available. */
  activeTool?: ActiveTool;
  /** Aggregate tool execution summary for the current session. */
  toolSummary?: ToolSummary;
  /** Pending user decision, rendered inline in the timeline. */
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  onAskReply?: (id: string, answer: string) => Promise<void>;
  onGuardReply?: (id: string, decision: "approve" | "reject") => Promise<void>;
  /** Disable decision controls while another client owns the run. */
  controlsDisabled?: boolean;
  /** Changes when Runtime attaches another session, resetting scroll anchoring. */
  sessionId?: string;
  /** Show skeleton placeholders while a session snapshot is loading. */
  loading?: boolean;
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
      label:
        activeTool?.status === "running" ? "正在执行工具" : "正在准备工具操作",
      detail:
        activeTool?.intent || activeTool?.tool || "正在处理任务中的下一步",
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
    <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current" />
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current [animation-delay:140ms]" />
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current [animation-delay:280ms]" />
    </span>
  );
}

function StreamActivity({ label, detail }: { label: string; detail?: string }) {
  return (
    <span className="ml-0.5 inline-flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-blue-strong">
      <ActivityDots />
      <span role="status">{label}</span>
      {detail && (
        <span className="max-w-[175px] truncate text-[10px] font-semibold text-ink-muted">
          · {detail}
        </span>
      )}
    </span>
  );
}

function ReasoningBlock({
  text,
  running,
  done,
}: {
  text: string;
  running: boolean;
  /** 该段思考已结束（run 完成或进入工具调用），折叠显示为过程记录。 */
  done?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
      <button
        aria-expanded={expanded}
        className="mb-1.5 flex w-full cursor-pointer items-center gap-1.5 text-[11px] text-ink-soft"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="grid h-[21px] w-[21px] place-items-center rounded-[7px] bg-[linear-gradient(145deg,#7c98ff,#536dde_62%,#744fc7)] text-white">
          <Icon name="sparkle" size={14} />
        </span>
        <strong className="text-ink">Suna</strong>
        <span className="ml-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-ink-muted">
          <Icon
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            name="chevron-down"
            size={12}
          />
          {done ? (expanded ? "收起思考" : "查看思考过程") : "思考中"}
        </span>
        {running && !done && <StreamActivity label="正在思考" />}
      </button>
      {expanded && (
        <div className="markdown-body min-w-0 max-w-[650px] rounded-[18px] bg-surface-subtle/70 px-4 py-3 text-[13px] leading-[1.82] text-ink-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [overflow-wrap:anywhere]">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      )}
    </article>
  );
}

const toneClasses: Record<string, string> = {
  guard:
    "bg-amber-soft/70 border-amber/30 [&_.agent-activity-icon]:text-amber [&_.activity-dots]:text-amber",
  failed:
    "bg-rose/10 border-rose/25 [&_.agent-activity-icon]:text-rose [&_.activity-dots]:text-rose",
  default:
    "bg-blue-soft/60 border-blue/25 [&_.agent-activity-icon]:text-blue-strong [&_.activity-dots]:text-blue",
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
    const key = `${sessionId ?? "none"}:${messages.length}:${flow.length}:${flow.map((s) => (s.kind === "tool" ? "t" : `${s.kind[0]}${s.text.length}${s.done ? "d" : ""}`)).join(",")}:${running}:${pending}:${phase ?? ""}:${activeTool?.id ?? ""}:${activeTool?.status ?? ""}`;
    if (lastContentKeyRef.current === key) return;
    lastContentKeyRef.current = key;
    // Keep an active conversation anchored only when the reader is already at
    // its latest edge. Browsing history must never be force-scrolled away.
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
                  <div className="markdown-body rounded-[18px] bg-surface-subtle/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </Markdown>
                  </div>
                ) : (
                  <span className="inline-block max-w-[min(640px,100%)] rounded-[4px_15px_15px_15px] border border-line bg-surface-solid px-3.5 py-3 text-ink leading-[1.7] shadow-sm">
                    {message.content}
                  </span>
                )}
              </div>
            </article>
          ))}
        {!loading && (ask || guard) && (
          <section
            aria-atomic="true"
            aria-live="polite"
            className="mb-7 max-w-[520px] animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[15px] border border-amber/30 bg-amber-soft/70 p-3.5 shadow-sm"
            role="status"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-amber/15 text-amber">
                <Icon name="warning" size={17} />
              </span>
              <div className="min-w-0">
                <strong className="block text-[13px] font-extrabold text-ink">
                  {guard ? "需要你的授权" : "Suna 有一个问题"}
                </strong>
                <small className="truncate text-[11px] text-ink-muted">
                  {guard ? guard.tool : "请回复后继续"}
                </small>
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              {guard ? guard.reason : ask?.question}
            </p>
            {(ask && !ask.can_reply) || (guard && !guard.can_reply) ? (
              <small className="mt-1.5 block text-[11px] font-semibold text-ink-muted">
                此请求由其他客户端处理；当前窗口仅可查看。
              </small>
            ) : null}
            {ask && ask.options && ask.options.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {ask.options.map((option) => (
                  <button
                    className="cursor-pointer rounded-[7px] border border-line bg-surface-solid px-2.5 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-150 hover:border-blue/40 hover:text-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!ask.can_reply || controlsDisabled}
                    key={option}
                    onClick={() => void onAskReply?.(ask.id, option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {ask && ask.allow_custom && (
              <AskInlineInput
                disabled={!ask.can_reply || controlsDisabled}
                onSubmit={(answer) => onAskReply?.(ask.id, answer)}
              />
            )}
            {guard && (
              <div className="mt-2.5 flex gap-2">
                <button
                  className="flex-1 cursor-pointer rounded-lg border border-line bg-surface-solid px-3 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!guard.can_reply || controlsDisabled}
                  onClick={() => void onGuardReply?.(guard.id, "reject")}
                  type="button"
                >
                  拒绝
                </button>
                <button
                  className="flex-1 cursor-pointer rounded-lg bg-blue px-3 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!guard.can_reply || controlsDisabled}
                  onClick={() => void onGuardReply?.(guard.id, "approve")}
                  type="button"
                >
                  批准
                </button>
              </div>
            )}
          </section>
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
                    className={`markdown-body min-w-0 max-w-[650px] rounded-[18px] bg-surface-subtle/70 px-4 py-3 text-[13px] leading-[1.82] tracking-tight text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [overflow-wrap:anywhere]${streaming ? " [&::after]:ml-[3px] [&::after]:inline-block [&::after]:h-[1em] [&::after]:w-[2px] [&::after]:animate-[stream-blink_1s_steps(1)_infinite] [&::after]:rounded-[1px] [&::after]:bg-blue [&::after]:align-[-0.15em] [&::after]:content-['']" : ""}`}
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {segment.text}
                    </Markdown>
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

function ToolCard({ item }: { item: ToolFlowItem }) {
  const [expanded, setExpanded] = useState(false);
  const status = item.status;
  const statusMeta = {
    running: {
      dot: "bg-blue animate-pulse",
      label: "执行中",
      text: "text-blue-strong",
    },
    guard: {
      dot: "bg-amber animate-pulse",
      label: "等待授权",
      text: "text-amber",
    },
    success: { dot: "bg-green", label: "完成", text: "text-green" },
    failed: { dot: "bg-rose", label: "失败", text: "text-rose" },
  }[status];
  const hasDetail =
    Boolean(item.params && Object.keys(item.params).length > 0) ||
    Boolean(item.result);
  const iconTone = {
    running: "bg-blue-soft text-blue-strong",
    guard: "bg-amber-soft text-amber",
    success: "bg-green-soft text-green",
    failed: "bg-rose/15 text-rose",
  }[status];
  return (
    <article className="animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-[14px] border border-line bg-surface-solid shadow-sm transition-[border-color] duration-160 hover:border-line-strong">
      <button
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left disabled:cursor-default"
        disabled={!hasDetail}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[7px] w-[7px] shrink-0 rounded-full ${statusMeta.dot}`}
        />
        <span
          className={`grid h-[24px] w-[24px] shrink-0 place-items-center rounded-lg ${iconTone}`}
        >
          <Icon name="tool" size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <code className="block truncate font-mono text-[11.5px] font-semibold text-ink">
            {item.tool}
          </code>
          {item.intent && (
            <span className="block truncate text-[10.5px] text-ink-muted">
              {item.intent}
            </span>
          )}
        </span>
        <span
          className={`shrink-0 text-[10px] font-extrabold ${statusMeta.text}`}
        >
          {statusMeta.label}
        </span>
        {hasDetail && (
          <Icon
            name="chevron-down"
            size={14}
            className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {expanded && hasDetail && (
        <div className="space-y-2 border-t border-line/70 px-3 py-2.5">
          {item.params && Object.keys(item.params).length > 0 && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-ink-muted">
                参数
              </span>
              <pre className="max-h-[180px] overflow-auto rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                {JSON.stringify(item.params, null, 2)}
              </pre>
            </div>
          )}
          {item.result && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-ink-muted">
                结果
              </span>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                {item.result}
                {item.resultTruncated && (
                  <span className="mt-1 block text-[10px] font-semibold text-ink-muted">
                    （结果已截断）
                  </span>
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AskInlineInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="mt-2.5 flex gap-1.5">
      <input
        aria-label="回答"
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-solid px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
        disabled={disabled}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (answer.trim() && !disabled) {
              onSubmit(answer.trim());
              setAnswer("");
            }
          }
        }}
        placeholder="输入你的回答"
        value={answer}
      />
      <button
        className="cursor-pointer rounded-lg bg-blue px-3 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled || !answer.trim()}
        onClick={() => {
          onSubmit(answer.trim());
          setAnswer("");
        }}
        type="button"
      >
        发送
      </button>
    </div>
  );
}
