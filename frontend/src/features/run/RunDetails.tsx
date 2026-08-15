import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { Select } from "../../components/ui/Select";
import { ActivityDots } from "../chat/blocks";
import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
  CompactResultEvent,
  GuardConfirmEvent,
  RuntimeConfig,
  ToolSummary,
  UsagePeriod,
} from "../../lib/runtimeBridge";

type RunDetailsProps = {
  /** Defaults to run-details so the shell toggle can reference this panel. */
  id?: string;
  open: boolean;
  onClose: () => void;
  status?: string;
  phase?: string;
  run?: AgentRunEvent;
  usage?: AgentUsageEvent;
  totals?: UsagePeriod;
  toolSummary?: ToolSummary;
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  /** 压缩过程/结果（由 session.compact_result 驱动）。 */
  compact?: CompactResultEvent;
  config?: RuntimeConfig;
  modelRef?: string;
  canConfigure: boolean;
  controlsDisabled?: boolean;
  onCompact: () => Promise<void>;
  onUpdateModel: (model: string) => Promise<void>;
  onResume?: () => Promise<void>;
};
function tokenCount(value?: number) {
  return value
    ? Intl.NumberFormat("en", { notation: "compact" }).format(value)
    : "—";
}
export function RunDetails(props: RunDetailsProps) {
  const {
    id = "run-details",
    open,
    onClose,
    status,
    phase,
    run,
    usage,
    totals,
    ask,
    guard,
    compact,
    config,
    modelRef,
    canConfigure,
    controlsDisabled,
    onCompact,
    onUpdateModel,
    onResume,
  } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setError(undefined);
  }, [ask?.id, guard?.id]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败。");
    } finally {
      setBusy(false);
    }
  }
  const context = usage?.context_tokens ?? usage?.estimated_context_tokens;
  const contextPercent =
    context && usage?.context_window
      ? Math.min(100, (context / usage.context_window) * 100)
      : 0;
  // 缓存命中率：缓存读取 token 占输入 token 的比例（DeepSeek 前缀缓存）。
  const cachePercent =
    usage?.cache_read_tokens && usage.input_tokens
      ? Math.min(100, (usage.cache_read_tokens / usage.input_tokens) * 100)
      : undefined;
  const selectedModel = modelRef ?? "";
  const modelOptions = [
    ...(config?.models.some(
      (model) => `${model.provider}/${model.model}` === selectedModel,
    ) || !selectedModel
      ? []
      : [{ value: selectedModel, label: `${selectedModel}（不可用）` }]),
    ...(config?.models.map((model) => {
      const ref = `${model.provider}/${model.model}`;
      return { value: ref, label: ref };
    }) ?? []),
  ];
  return (
    <>
      {/* 详情遮罩：常驻 DOM，is-visible 控制淡入淡出（CSS 过渡）。 */}
      <button
        aria-label="关闭任务详情"
        className={`details-scrim ${open ? "is-visible" : ""}`}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <aside
        aria-hidden={!open}
        aria-label="任务详情"
        className={`details-panel ${open ? "is-open" : ""}`}
        id={id}
        inert={!open ? true : undefined}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
              当前会话
            </p>
            <h2 className="mt-1 text-[16px] font-extrabold text-ink">
              状态与用量
            </h2>
          </div>
          <IconButton
            buttonRef={closeButtonRef}
            label="关闭任务详情"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </IconButton>
        </div>
        <div className="details-scroll">
          <section
            aria-live="polite"
            className="relative overflow-hidden rounded-2xl border border-line bg-surface-subtle p-3.5"
          >
            {/* 顶部品牌色渐变细条：与用户消息/发送按钮统一视觉语言 */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2.5px] bg-[linear-gradient(90deg,#5b67f1,#6d5df0_55%,#7c54e8)]"
            />
            <div className="flex items-center gap-3">
              <span className="running-orb">
                <i />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-[13px] font-extrabold text-ink">
                  {status === "running"
                    ? "正在执行任务"
                    : status === "waiting"
                      ? "等待你的输入"
                      : status === "compacting"
                        ? "正在压缩上下文"
                        : "会话空闲"}
                </strong>
                <small className="block truncate text-[11px] text-ink-muted">
                  {phase
                    ? `阶段：${phase}`
                    : status === "running"
                      ? "Suna 正在处理任务"
                      : status === "waiting"
                        ? "回复后将继续处理"
                        : "可开始新任务或加入运行中的会话"}
                </small>
              </div>
              {status !== "running" && onResume && (
                <button
                  className="shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[11px] font-bold text-ink transition-colors duration-150 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={busy}
                  onClick={() => void act(onResume)}
                  type="button"
                >
                  恢复执行
                </button>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              {run?.state === "retrying"
                ? `正在重试${run.attempt && run.max_attempts ? `（${run.attempt}/${run.max_attempts}）` : ""}${run.delay_ms ? `，${Math.ceil(run.delay_ms / 1000)} 秒后继续` : ""}。`
                : run?.message || "实时状态和工具活动来自当前 Runtime 会话。"}
            </p>
            {run?.error && (
              <small className="mt-1 block text-[12px] font-semibold text-rose">
                {run.error.message}
              </small>
            )}
            {run?.run_error && (
              <small className="mt-1 block text-[12px] font-semibold text-rose">
                {run.run_error.kind === "session_model_unavailable"
                  ? `会话模型不可用：${run.run_error.model_ref ?? "—"}`
                  : "尚未配置模型。"}
              </small>
            )}
          </section>
          {(ask || guard) && (
            <section className="mt-4 rounded-2xl border border-amber/30 bg-amber-soft/50 p-3.5 animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-amber/15 text-amber">
                  <Icon name="warning" size={17} />
                </span>
                <div>
                  <strong className="block text-[13px] font-extrabold text-ink">
                    {guard ? "需要你的授权" : "Suna 有一个问题"}
                  </strong>
                  <small className="text-[11px] text-ink-muted">
                    {guard ? guard.tool : "请回复后继续"}
                  </small>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                {guard ? guard.reason : ask?.question}
              </p>
              {guard?.suggestion && (
                <p className="mt-1.5 rounded-lg border border-amber/25 bg-amber/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
                  <span className="font-extrabold text-ink">建议改为：</span>
                  <code className="font-mono">{guard.suggestion}</code>
                </p>
              )}
              {/* 只读摘要：决策按钮在时间线内嵌决策卡上（设计 §7.4），
                  右栏不重复操作，避免同一决策两处可点分散注意力。 */}
              <small className="mt-2 block text-[11px] font-semibold text-ink-muted">
                请在对话中处理此请求
              </small>
              {(ask && !ask.can_reply) || (guard && !guard.can_reply) ? (
                <small className="mt-1 block text-[11px] text-ink-muted">
                  此请求由其他客户端处理；当前窗口仅可查看。
                </small>
              ) : null}
              {error && (
                <small className="mt-2 block text-[12px] font-semibold text-rose">
                  {error}
                </small>
              )}
            </section>
          )}
          <section
            className="border-t border-line pt-4 mt-4 animate-[message-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
            key={`usage-${usage?.run_id ?? "none"}-${status ?? "none"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="m-0 text-[13px] font-bold text-ink">本次用量</h3>
              <button
                aria-label="压缩上下文"
                className="cursor-pointer rounded-lg border border-line px-2 py-1 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                disabled={
                  controlsDisabled ||
                  status === "running" ||
                  status === "compacting" ||
                  compact?.running
                }
                onClick={() => void act(onCompact)}
                type="button"
              >
                压缩
              </button>
            </div>
            {/* 压缩过程/结果：running 动画 → 完成结果（N→M tokens）→ 失败错误 */}
            {compact?.running ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue/25 bg-blue-soft/40 px-2.5 py-2 text-[12px] font-bold text-blue-strong">
                <ActivityDots />
                正在压缩上下文…
              </div>
            ) : compact?.error ? (
              <div className="mb-2 rounded-lg border border-rose/25 bg-rose/10 px-2.5 py-2 text-[12px] font-semibold text-rose">
                压缩失败：{compact.error}
              </div>
            ) : compact?.noop ? (
              <div className="mb-2 rounded-lg border border-line bg-surface-raised/60 px-2.5 py-2 text-[12px] font-semibold text-ink-muted">
                上下文足够短，无需压缩。
              </div>
            ) : compact ? (
              <div className="mb-2 rounded-lg border border-green/25 bg-green-soft/40 px-2.5 py-2 text-[12px] font-semibold text-ink">
                <span className="font-bold text-green">✓ 已压缩</span>{" "}
                {tokenCount(compact.before_tokens)} →{" "}
                {tokenCount(compact.after_tokens)} tokens
                {compact.turns_compressed
                  ? ` · 压缩 ${compact.turns_compressed} 轮`
                  : ""}
              </div>
            ) : null}
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">输入 / 输出</span>
              <b className="text-ink">
                {tokenCount(usage?.input_tokens)} /{" "}
                {tokenCount(usage?.output_tokens)}
              </b>
            </div>
            {usage?.cache_read_tokens !== undefined &&
              cachePercent !== undefined && (
                <>
                  <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
                    <span className="text-ink-muted">缓存命中</span>
                    <b className="text-green">{cachePercent.toFixed(0)}%</b>
                  </div>
                  <div className="mt-2 mb-2.5 h-[5px] overflow-hidden rounded-full bg-surface-subtle">
                    <span
                      className="block h-full rounded-full bg-green transition-[width] duration-500"
                      style={{ width: `${cachePercent}%` }}
                    />
                  </div>
                </>
              )}
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">今日请求</span>
              <b className="text-ink">{totals?.requests ?? "—"}</b>
            </div>
            <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-surface-subtle">
              <span
                className="block h-full rounded-full bg-blue transition-[width] duration-500"
                style={{ width: `${contextPercent}%` }}
              />
            </div>
            {usage?.context_window && (
              <small className="mt-1.5 block text-[11px] text-ink-muted">
                上下文 {tokenCount(context)} /{" "}
                {tokenCount(usage.context_window)}
              </small>
            )}
          </section>
          {canConfigure && config && (
            <section className="border-t border-line pt-4 mt-4">
              <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">
                会话模型
              </h3>
              <Select
                ariaLabel="会话模型"
                disabled={!selectedModel || controlsDisabled}
                onValueChange={(value) => void act(() => onUpdateModel(value))}
                options={modelOptions}
                value={selectedModel}
              />
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
