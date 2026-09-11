import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { Icon } from "../../components/Icon";
import type {
  AgentRunEvent,
  AskUserEvent,
  FlowSegment,
  GuardConfirmEvent,
  SnapshotMessage,
  ToolSummary,
} from "../../lib/runtimeBridge";
import { ReasoningBlock } from "./activity";
import { DecisionCard } from "./decisionCard";
import { LONG_MESSAGE_THRESHOLD, LongMessage } from "./longMessage";
import {
  SkillRow,
  SubtaskCard,
  ToolRow,
  formatTurnDuration,
} from "./toolCards";
import { LazyMarkdown } from "./LazyMarkdown";
import { MediaSummary } from "./mediaSummary";
import { useT } from "../../lib/i18n";

type ActiveTool = {
  id?: string;
  tool: string;
  intent?: string;
  status?: "running" | "guard" | "failed";
};

/**
 * 轮次收尾行（模仿 TUI 的“✦ 已工作 1m23s · 14:05”）：
 * 品牌色星标 + 已工作文案 + 耗时 + 结束时刻，安静地收束一轮工具活动。
 */
function TurnDurationRow({
  durationMs,
  endedAt,
}: {
  durationMs: number;
  endedAt: number;
}) {
  const t = useT();
  const ended = new Date(endedAt);
  const timeLabel = `${String(ended.getHours()).padStart(2, "0")}:${String(ended.getMinutes()).padStart(2, "0")}`;
  return (
    <div className="my-4 flex items-center gap-2 text-[11px] text-ink-muted">
      <span aria-hidden="true" className="text-blue">
        ✦
      </span>
      <span>{t("chat.workedFor")}</span>
      <span className="font-mono font-bold text-ink">
        {formatTurnDuration(durationMs)}
      </span>
      <span aria-hidden="true">·</span>
      <time className="font-mono" dateTime={ended.toISOString()}>
        {timeLabel}
      </time>
    </div>
  );
}

/** 消息复制按钮：点击后短暂切换为对勾 + “已复制”，给操作明确反馈。 */
function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={copied ? t("chat.copied") : t("chat.copyMessage")}
      className={`grid h-6 w-6 cursor-pointer place-items-center rounded-md transition-colors duration-150 ${copied ? "text-green" : "text-ink-muted opacity-0 hover:bg-surface-subtle hover:text-ink focus:opacity-100 group-hover:opacity-100 max-[720px]:opacity-100"}`}
      onClick={() => {
        // 剪贴板写入失败静默忽略（非安全上下文等场景），不误报“已复制”。
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => undefined);
      }}
      type="button"
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
    </button>
  );
}

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
  /** 当前会话的工具执行汇总（仅 attach 恢复时展示）。 */
  toolSummary?: ToolSummary;
  /** 工具摘要是否来自 attach 恢复：只在恢复历史会话时展示一次。 */
  restoredToolSummary?: boolean;
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
  /** 空状态建议卡点击：把示例 prompt 交给外层（填入输入框）。 */
  onSuggestion?: (text: string) => void;
  /** 当前 run 的权威状态（失败且可恢复时显示“恢复执行”）。 */
  run?: AgentRunEvent;
  /** 恢复执行（agent.resumeRun）：不新增用户消息，重试未完成的 turn。 */
  onResume?: () => void;
  /** attach 恢复时 run 在等待交互但详情未达：显示“等待详情”占位。 */
  waitingForInteraction?: boolean;
  /** 是否已配置模型：false 时空状态显示“去配置模型”引导。 */
  hasModels?: boolean;
  /** 打开设置（无模型引导按钮用，直达模型 tab）。 */
  onOpenSettings?: () => void;
};

export function ChatTimeline({
  messages,
  flow = [],
  running,
  phase,
  pending,
  activeTool,
  toolSummary,
  restoredToolSummary = false,
  ask,
  guard,
  onAskReply,
  onGuardReply,
  controlsDisabled = false,
  sessionId,
  loading = false,
  onSuggestion,
  run,
  onResume,
  waitingForInteraction = false,
  hasModels = true,
  onOpenSettings,
}: ChatTimelineProps) {
  const t = useT();
  const [historyWindow, setHistoryWindow] = useState(80);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 跟随开关：用户向上滚动立即脱离，滚回底部（96px 内，含点“回到最新”）恢复。
  // 内容更新只在跟随开启时滚底，绝不改写开关本身。
  const followRef = useRef(true);
  // 程序化滚动标记：scrollToLatest 触发的 scroll 事件是“回声”，
  // 不能当作用户意图（否则流式期间每次滚底都会覆盖用户刚做出的
  // 上滑决策——delta 与 wheel 事件交错时表现为滚动抽搐）。
  const programmaticScrollRef = useRef(false);
  // 用户滚动方向基线 + 最近用户手势时刻（滚轮/触摸）。
  const lastScrollTopRef = useRef(0);
  const lastUserGestureAtRef = useRef(0);
  const lastContentKeyRef = useRef("");
  const historyAnchorRef = useRef<{ height: number; top: number } | undefined>(
    undefined,
  );
  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    // 已在底部时无需滚动也不设标记：避免标记残留吞掉下一条用户滚动。
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 1) {
      programmaticScrollRef.current = true;
      element.scrollTo({ top: element.scrollHeight, behavior });
    }
    followRef.current = true;
    setShowJumpToLatest(false);
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    // 程序化滚动的回声：只同步基线，不参与跟随判定；到达底部后清除
    // 标记（平滑滚动会产生多次回声，到底才算结束）。
    if (programmaticScrollRef.current) {
      if (nearBottom) programmaticScrollRef.current = false;
      lastScrollTopRef.current = element.scrollTop;
      return;
    }
    // 用户滚动：向上移动立即脱离跟随（方向判定，不等 96px 容差——
    // 容差会吞掉流式期间的小幅上滑）；滚回底部恢复跟随。
    if (element.scrollTop < lastScrollTopRef.current - 1 || !nearBottom) {
      followRef.current = false;
    } else if (nearBottom) {
      followRef.current = true;
    }
    lastScrollTopRef.current = element.scrollTop;
    setShowJumpToLatest(!nearBottom);
  };
  // 用户输入手势立即取消程序化标记：平滑滚动（“回到最新”）途中用户
  // 滚轮/触摸接管时，后续 scroll 事件立刻按用户意图判定。
  const onUserGesture = () => {
    lastUserGestureAtRef.current = Date.now();
    programmaticScrollRef.current = false;
  };
  // 会话切换时保存/恢复滚动位置：localStorage 按 sessionId 记忆，
  // 切回来时回到上次阅读位置（新会话/无记忆时仍滚动到底部）。
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const prev = prevSessionIdRef.current;
    if (prev && prev !== sessionId && element) {
      try {
        localStorage.setItem(
          `suna-app:scroll:${prev}`,
          String(element.scrollTop),
        );
      } catch {
        // 存储失败静默忽略（隐私模式等）。
      }
    }
    prevSessionIdRef.current = sessionId;
    // 不同的会话可能恰好包含相同数量的消息：重置时间线而不是继承
    // 上一个会话的滚动位置。
    followRef.current = true;
    setShowJumpToLatest(false);
    setHistoryWindow(80);
    requestAnimationFrame(() => {
      if (!sessionId) {
        scrollToLatest("auto");
        return;
      }
      let saved = 0;
      try {
        saved = Number(
          localStorage.getItem(`suna-app:scroll:${sessionId}`) ?? 0,
        );
      } catch {
        saved = 0;
      }
      if (saved > 0 && element) {
        element.scrollTop = saved;
        // 恢复位置后仍要等内容渲染完成：下一帧校正一次（localStorage 的
        // 位置可能因消息数变化而偏移，但大体回到阅读处）。
        requestAnimationFrame(() => {
          if (element) element.scrollTop = saved;
        });
      } else {
        scrollToLatest("auto");
      }
    });
  }, [sessionId]);
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor || !element) return;
    element.scrollTop = anchor.top + (element.scrollHeight - anchor.height);
    historyAnchorRef.current = undefined;
  }, [historyWindow]);
  useLayoutEffect(() => {
    const key = `${sessionId ?? "none"}:${messages.length}:${flow.length}:${flow.map((s) => (s.kind === "tool" ? "t" : s.kind === "skill" ? `sk${s.item.name}:${s.item.status}` : s.kind === "subtask" ? `st${s.item.id}:${s.item.status}:${s.item.tools.length}` : s.kind === "turnDuration" ? `td${s.durationMs}` : s.kind === "user" ? `u${s.text.length}` : `${s.kind[0]}${s.text.length}${s.done ? "d" : ""}`)).join(",")}:${running}:${pending}:${phase ?? ""}:${activeTool?.id ?? ""}:${activeTool?.status ?? ""}`;
    if (lastContentKeyRef.current === key) return;
    lastContentKeyRef.current = key;
    // 只在用户仍处于跟随模式时锚定；一旦上滑（followRef=false），内容更新
    // 不再滚动——用户滚回底部或点“回到最新”才恢复跟随。用户正在主动
    // 滚动（最近 120ms 内有滚轮/触摸）时也暂缓：delta 渲染与 wheel 事件
    // 交错的竞态窗口里跟随判定可能尚未翻转，此时滚底会覆盖用户滚动。
    if (followRef.current && Date.now() - lastUserGestureAtRef.current > 120) {
      scrollToLatest("auto");
    } else {
      // 非跟随模式下内容增长会把视口“顶”离底部，但 scrollTop 不变、
      // 不产生 scroll 事件——“回到最新”按钮的显隐必须在这里同步判定，
      // 否则流式期间上滑后按钮永远不出现（onScroll 只在滚动时触发）。
      const element = scrollRef.current;
      if (element) {
        setShowJumpToLatest(
          element.scrollHeight - element.scrollTop - element.clientHeight >= 96,
        );
      }
    }
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

  /** 思考/回复段渲染（工具块之间的叙事内容，ZCode 平铺形态）。
   * 思考链属于同一条消息：先思考块（可折叠），紧接正文，共享一个段落。 */
  const renderNarrative = (segment: FlowSegment) => {
    if (segment.kind === "reasoning") return null; // 与后续 assistant 段合并渲染。
    if (segment.kind !== "assistant") return null;
    const streaming = !segment.done;
    // 思考链：本条消息前面紧邻的 reasoning 段（未结束时展示思考中状态）。
    const index = flow.indexOf(segment);
    const reasoning =
      index > 0 && flow[index - 1].kind === "reasoning"
        ? flow[index - 1]
        : undefined;
    return (
      <article className="mb-6" key={segment.id}>
        {reasoning && reasoning.kind === "reasoning" && (
          <div className="mb-2">
            <ReasoningBlock
              done={reasoning.done}
              running={running && !reasoning.done}
              text={reasoning.text}
            />
          </div>
        )}
        <div
          className={`min-w-0 max-w-[650px] text-[13px] leading-[1.82] tracking-tight [overflow-wrap:anywhere] ${streaming ? "text-ink whitespace-pre-wrap" : "markdown-body text-ink"}`}
        >
          {/* 流式过程中用纯文本（不解析 Markdown）：避免每帧对
              全文重新解析导致 O(n²)；完成后才一次性渲染。 */}
          {streaming ? (
            <>
              {segment.text}
              {/* 光标只在段内有内容时显示：空段（等待首个 delta）不渲染，
                  避免“空气泡 + 孤光标”。 */}
              {segment.text.trim() !== "" && (
                <span
                  aria-hidden="true"
                  className="ml-[3px] inline-block h-[1em] w-[2px] animate-[stream-blink_1s_steps(1)_infinite] rounded-[1px] bg-blue align-[-0.15em]"
                />
              )}
            </>
          ) : (
            <LazyMarkdown>{segment.text}</LazyMarkdown>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="conversation-host relative flex min-h-0 flex-1 flex-col">
      <div
        className="conversation-wrap"
        onScroll={onScroll}
        onTouchStart={onUserGesture}
        onWheel={onUserGesture}
        ref={scrollRef}
      >
        <section
          aria-label={t("chat.timelineLabel")}
          className="mx-auto w-[min(720px,calc(100%-48px))] px-0 pt-8 pb-12 max-[720px]:w-[min(100%-28px,640px)] max-[720px]:pt-6 max-[720px]:pb-7"
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
            !running &&
            !pending && (
              <div className="flex min-h-[300px] animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex-col items-center justify-center text-center">
                <span className="grid h-12 w-12 animate-[float-y_5s_ease-in-out_infinite] place-items-center rounded-2xl bg-blue text-white">
                  <Icon name="sparkle" size={22} />
                </span>
                <h2 className="mt-4 mb-1.5 text-[17px] font-extrabold tracking-tight text-ink">
                  {hasModels
                    ? t("chat.empty.title")
                    : t("chat.empty.noModelTitle")}
                </h2>
                <p className="m-0 max-w-[300px] text-[12.5px] leading-relaxed text-ink-muted">
                  {hasModels
                    ? t("chat.empty.desc")
                    : t("chat.empty.noModelDesc")}
                </p>
                {!hasModels && onOpenSettings && (
                  <button
                    className="mt-6 inline-flex h-[40px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue px-5 text-[12px] font-extrabold text-white transition-colors duration-150 hover:bg-blue-strong active:scale-[0.97]"
                    onClick={onOpenSettings}
                    type="button"
                  >
                    <Icon name="settings" size={14} />
                    {t("chat.empty.noModelCta")}
                  </button>
                )}
                {onSuggestion && hasModels && (
                  <div className="mt-6 grid gap-2 text-left">
                    {" "}
                    <button
                      className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface-solid px-3.5 py-2.5 text-left shadow-sm transition-[transform,border-color,box-shadow] duration-180 hover:-translate-y-px hover:border-blue/25 hover:shadow-md active:scale-[0.985]"
                      onClick={() =>
                        onSuggestion?.(t("chat.suggestion.analyze"))
                      }
                      type="button"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-soft text-blue-strong">
                        <Icon name="search" size={14} />
                      </span>
                      <span className="text-[12px] text-ink-soft">
                        {t("chat.suggestion.analyzeLabel")}
                      </span>
                    </button>
                    <button
                      className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface-solid px-3.5 py-2.5 text-left shadow-sm transition-[transform,border-color,box-shadow] duration-180 hover:-translate-y-px hover:border-green/30 hover:shadow-md active:scale-[0.985]"
                      onClick={() => onSuggestion?.(t("chat.suggestion.fix"))}
                      type="button"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-green-soft text-green">
                        <Icon name="check" size={14} />
                      </span>
                      <span className="text-[12px] text-ink-soft">
                        {t("chat.suggestion.fixLabel")}
                      </span>
                    </button>
                  </div>
                )}
                <p className="mt-7 flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <kbd className="rounded-md border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
                    ⌘K
                  </kbd>
                  {t("chat.empty.hint")}
                </p>
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
              {t("chat.moreHistory", {
                count: Math.min(80, messages.length - historyWindow),
              })}
            </button>
          )}
          {!loading &&
            messages.slice(-historyWindow).map((message, index) => (
              <article
                className={`group mb-7 max-[720px]:mb-6 ${message.role === "user" ? "flex flex-col items-end" : ""}`}
                key={`${messages.length - historyWindow + index}-${message.role}`}
              >
                <div
                  className={`mb-1.5 flex items-center gap-1.5 text-[11px] text-ink-muted ${message.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <CopyButton text={message.content} />
                </div>
                <div
                  className={`min-w-0 text-[13px] leading-[1.82] tracking-tight [overflow-wrap:anywhere] max-[720px]:text-[12.5px] max-[720px]:leading-[1.76] ${message.role === "user" ? "max-w-[85%] rounded-[14px] rounded-br-[4px] border border-line bg-surface-raised px-3.5 py-2.5 text-ink" : "max-w-[650px] text-ink"}`}
                >
                  {message.role === "assistant" ? (
                    message.content.length > LONG_MESSAGE_THRESHOLD ? (
                      <LongMessage text={message.content} />
                    ) : (
                      <div className="markdown-body">
                        <LazyMarkdown>{message.content}</LazyMarkdown>
                      </div>
                    )
                  ) : message.kind === "media" ? (
                    // 媒体引用摘要（Runtime 标记 kind=media）：展示为媒体卡，
                    // 而不是把含 source= 的原始摘要文本丢给用户（与 TUI 对齐）。
                    <MediaSummary content={message.content} />
                  ) : (
                    // 用户消息：浅色圆角气泡 + 右对齐（ZCode/Linear 惯例），
                    // 与 Suna 的平铺形态一眼区分。
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  )}
                </div>
              </article>
            ))}
          {!loading &&
            run?.state === "failed" &&
            run.resume_available &&
            onResume && (
              <section
                aria-atomic="true"
                aria-live="polite"
                className="mb-6 flex max-w-[520px] items-center gap-2 border-l-2 border-rose py-1 pl-2.5 text-[11px]"
                role="status"
              >
                <span className="shrink-0 font-extrabold text-rose">
                  {t("run.failed")}
                </span>
                <span className="min-w-0 truncate text-ink-muted">
                  {run.message || t("run.failedHint")}
                </span>
                <button
                  className="ml-auto shrink-0 cursor-pointer rounded-md border border-line bg-surface-raised px-2 py-0.5 text-[10.5px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle"
                  onClick={onResume}
                  type="button"
                >
                  {t("run.resume")}
                </button>
              </section>
            )}
          {!loading && waitingForInteraction && (
            <section
              aria-atomic="true"
              aria-live="polite"
              className="mb-6 flex max-w-[520px] animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] items-center gap-2 border-l-2 border-amber py-1 pl-2.5 text-[11px]"
              role="status"
            >
              <span className="shrink-0 font-extrabold text-amber">
                {t("chat.waitingInteraction")}
              </span>
              <span className="min-w-0 truncate text-ink-muted">
                {t("chat.waitingInteractionHint")}
              </span>
            </section>
          )}
          {!loading && (
            <DecisionCard
              ask={ask}
              controlsDisabled={controlsDisabled}
              guard={guard}
              onAskReply={onAskReply}
              onGuardReply={onGuardReply}
            />
          )}
          {!loading && flow.length > 0 && (
            <div aria-label={t("chat.processLabel")}>
              {/* ZCode 工作台语言：连续的工具/技能/子任务活动收进一个
                带边框的容器（行间分隔线），与消息的平铺形态区分开，
                也避免每张工具卡独立描边造成的碎片感。
                容器 key 用首尾段 id（内容寻址）：运行中分组变化时
                React 能正确复用节点，不会因 index key 错位重放动画
                （消息区“抽搐”的根源之一）。 */}
              {(() => {
                const blocks: React.ReactNode[] = [];
                let current: React.ReactNode[] = [];
                let currentIds: string[] = [];
                const flush = () => {
                  if (current.length === 0) return;
                  const first = currentIds[0];
                  const last = currentIds[currentIds.length - 1];
                  blocks.push(
                    <div
                      className="my-5 overflow-hidden rounded-[10px] border border-line bg-surface-solid/60"
                      key={`toolblock-${first}-${last}-${current.length}`}
                    >
                      {current}
                    </div>,
                  );
                  current = [];
                  currentIds = [];
                };
                for (const segment of flow) {
                  if (
                    segment.kind === "tool" ||
                    segment.kind === "skill" ||
                    segment.kind === "subtask"
                  ) {
                    const id =
                      segment.kind === "tool"
                        ? segment.item.id
                        : segment.kind === "skill"
                          ? `skill-${segment.item.name}`
                          : `subtask-${segment.item.id}`;
                    currentIds.push(id);
                    current.push(
                      segment.kind === "tool" ? (
                        <ToolRow item={segment.item} key={segment.item.id} />
                      ) : segment.kind === "skill" ? (
                        <SkillRow
                          item={segment.item}
                          key={`skill-${segment.item.name}`}
                        />
                      ) : (
                        <SubtaskCard
                          item={segment.item}
                          key={`subtask-${segment.item.id}`}
                        />
                      ),
                    );
                  } else if (segment.kind === "turnDuration") {
                    // 轮次收尾行（模仿 TUI）：工具块先落盘，再追加耗时行。
                    flush();
                    blocks.push(
                      <TurnDurationRow
                        durationMs={segment.durationMs}
                        endedAt={segment.endedAt}
                        key={`turn-${segment.id}`}
                      />,
                    );
                  } else if (segment.kind === "user") {
                    // 运行中注入的引导消息（steering applied 广播）：
                    // 插在当前内容流末尾（与 TUI 形态一致），用用户气泡
                    // 形态与平铺的 assistant 内容区分。
                    flush();
                    blocks.push(
                      <article
                        className="mb-6 flex flex-col items-end"
                        key={`flow-user-${segment.id}`}
                      >
                        <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] border border-line bg-surface-raised px-3.5 py-2.5 text-[13px] leading-[1.82] tracking-tight text-ink [overflow-wrap:anywhere]">
                          <div className="whitespace-pre-wrap">
                            {segment.text}
                          </div>
                        </div>
                      </article>,
                    );
                  } else if (segment.kind === "reasoning") {
                    // 思考段：后面紧邻 assistant 时由其合并渲染；否则
                    // （思考中、后面是工具块或收尾行）独立渲染——否则流式
                    // 中的思考在正文到来前完全不可见（TUI 有思考中状态，
                    // App 却空白）。
                    const next = flow[flow.indexOf(segment) + 1];
                    if (!next || next.kind !== "assistant") {
                      flush();
                      blocks.push(
                        <div className="mb-6" key={`reasoning-${segment.id}`}>
                          <ReasoningBlock
                            done={segment.done}
                            running={running && !segment.done}
                            text={segment.text}
                          />
                        </div>,
                      );
                    }
                  } else {
                    // 思考/回复段打断工具块：先落盘已积累的工具组。
                    flush();
                    blocks.push(renderNarrative(segment));
                  }
                }
                flush();
                return blocks;
              })()}
            </div>
          )}
          {!loading &&
            restoredToolSummary &&
            toolSummary &&
            toolSummary.total > 0 && (
              <section className="mb-7 max-w-[520px] animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
                <div className="mb-0.5 flex items-center justify-between text-[11px]">
                  <span className="font-extrabold text-ink">
                    {t("toolSummary.title")}
                  </span>
                  <span className="font-semibold text-ink-muted">
                    {t("toolSummary.total", {
                      total: toolSummary.total,
                      success: toolSummary.success,
                    })}
                    {toolSummary.failed > 0 && (
                      <span className="text-rose">
                        {" "}
                        {t("toolSummary.failed", {
                          failed: toolSummary.failed,
                        })}
                      </span>
                    )}
                  </span>
                </div>
                {toolSummary.recent?.slice(0, 4).map((tool, index) => (
                  <div
                    className="flex items-center gap-2 py-[5px] pl-2.5 text-[11px]"
                    key={`${tool.tool}-${index}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-[5px] w-[5px] shrink-0 rounded-full ${tool.status === "success" ? "bg-green" : tool.status === "failed" ? "bg-rose" : "bg-ink-muted"}`}
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
      </div>
      {/* “回到最新”：absolute 覆盖层，不占布局流。此前是 sticky + 负 margin
          ——显隐会增减 scrollHeight，触发 onScroll 翻转跟随状态，再反过来
          控制显隐，形成自激振荡（流式期间滚动抽搐的另一根源）。
          挂在滚动容器外的宿主层：absolute 锚定可视区底部（滚动容器内的
          absolute 锚定的是内容盒底部，长会话里按钮永远滚不进视口）。 */}
      <div
        aria-hidden={!showJumpToLatest}
        className={`pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center transition-[opacity,transform] duration-200 ${showJumpToLatest ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
      >
        <button
          className={`flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface-solid px-3 py-2 text-[11px] font-extrabold text-ink shadow-md transition-[transform,background] duration-160 hover:bg-surface-subtle hover:-translate-y-px ${showJumpToLatest ? "pointer-events-auto" : "pointer-events-none"}`}
          onClick={() => scrollToLatest()}
          tabIndex={showJumpToLatest ? 0 : -1}
          type="button"
        >
          <Icon name="arrow-down" size={14} />
          {t("chat.backToLatest")}
        </button>
      </div>
    </div>
  );
}
