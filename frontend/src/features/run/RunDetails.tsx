import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { Select } from "../../components/ui/Select";
import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
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
  config?: RuntimeConfig;
  modelRef?: string;
  canConfigure: boolean;
  controlsDisabled?: boolean;
  onAskReply: (id: string, answer: string) => Promise<void>;
  onGuardReply: (id: string, decision: "approve" | "reject") => Promise<void>;
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
    toolSummary,
    ask,
    guard,
    config,
    modelRef,
    canConfigure,
    controlsDisabled,
    onAskReply,
    onGuardReply,
    onCompact,
    onUpdateModel,
    onResume,
  } = props;
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setAnswer("");
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
  const canAskReply = Boolean(ask?.can_reply) && !busy;
  const canGuardReply = Boolean(guard?.can_reply) && !busy;
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
      {open && (
        <button
          aria-label="关闭任务详情"
          className="details-scrim"
          onClick={onClose}
          type="button"
        />
      )}
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
              当前 Runtime
            </p>
            <h2 className="mt-1 text-[16px] font-extrabold text-ink">
              执行详情
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
            className="rounded-2xl border border-line bg-surface-subtle p-3.5"
          >
            <div className="flex items-center gap-3">
              <span className="running-orb">
                <i />
              </span>
              <div>
                <strong className="text-[13px] font-extrabold text-ink">
                  {status === "running"
                    ? "正在执行任务"
                    : status === "waiting"
                      ? "等待你的输入"
                      : status === "compacting"
                        ? "正在压缩上下文"
                        : "会话空闲"}
                </strong>
                <small className="block text-[11px] text-ink-muted">
                  {phase ? `阶段：${phase}` : "等待下一步"}
                </small>
              </div>
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
            {onResume && (
              <button
                className="mt-2.5 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
                disabled={busy}
                onClick={() => void act(onResume)}
                type="button"
              >
                恢复执行
              </button>
            )}
          </section>
          {(ask || guard) && (
            <section className="mt-4 rounded-2xl border border-amber/30 bg-amber-soft/50 p-3.5">
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
              {(ask && !ask.can_reply) || (guard && !guard.can_reply) ? (
                <small className="mt-1 block text-[11px] text-ink-muted">
                  此请求由其他客户端处理；当前窗口仅可查看。
                </small>
              ) : null}
              {ask?.options && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {ask.options.map((option) => (
                    <button
                      className="cursor-pointer rounded-[7px] border border-line px-2 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-150 hover:bg-surface-solid disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!canAskReply}
                      key={option}
                      onClick={() => void act(() => onAskReply(ask.id, option))}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {ask?.allow_custom && (
                <div className="mt-2.5 flex gap-1.5">
                  <input
                    aria-label="回答"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
                    disabled={!ask.can_reply || busy}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="输入你的回答"
                    value={answer}
                  />
                  <button
                    className="cursor-pointer rounded-lg bg-blue px-3 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!answer.trim() || !canAskReply}
                    onClick={() =>
                      void act(() => onAskReply(ask.id, answer.trim()))
                    }
                    type="button"
                  >
                    发送
                  </button>
                </div>
              )}
              {guard && (
                <div className="mt-2.5 flex gap-2">
                  <button
                    className="flex-1 cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!canGuardReply}
                    onClick={() =>
                      void act(() => onGuardReply(guard.id, "reject"))
                    }
                    type="button"
                  >
                    拒绝
                  </button>
                  <button
                    className="flex-1 cursor-pointer rounded-lg bg-blue px-3 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!canGuardReply}
                    onClick={() =>
                      void act(() => onGuardReply(guard.id, "approve"))
                    }
                    type="button"
                  >
                    批准
                  </button>
                </div>
              )}
              {error && (
                <small className="mt-2 block text-[12px] font-semibold text-rose">
                  {error}
                </small>
              )}
            </section>
          )}
          <section className="border-t border-line pt-4 mt-4">
            <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">
              工具活动
            </h3>
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">已执行</span>
              <b className="text-ink">{toolSummary?.total ?? 0}</b>
            </div>
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">成功 / 失败</span>
              <b className="text-ink">
                {toolSummary
                  ? `${toolSummary.success} / ${toolSummary.failed}`
                  : "—"}
              </b>
            </div>
            {toolSummary?.recent?.slice(0, 4).map((tool, index) => (
              <div
                className="flex items-center justify-between border-b border-line py-2 text-[13px]"
                key={`${tool.tool}-${index}`}
              >
                <span className="truncate text-ink-muted">{tool.tool}</span>
                <small className="text-ink-soft">{tool.status}</small>
              </div>
            ))}
          </section>
          <section className="border-t border-line pt-4 mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="m-0 text-[13px] font-bold text-ink">本次用量</h3>
              <button
                aria-label="压缩上下文"
                className="cursor-pointer rounded-lg border border-line px-2 py-1 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                disabled={
                  controlsDisabled ||
                  status === "running" ||
                  status === "compacting"
                }
                onClick={() => void act(onCompact)}
                type="button"
              >
                压缩
              </button>
            </div>
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">输入 / 输出</span>
              <b className="text-ink">
                {tokenCount(usage?.input_tokens)} /{" "}
                {tokenCount(usage?.output_tokens)}
              </b>
            </div>
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
