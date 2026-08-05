import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
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
        <div className="details-header">
          <div>
            <p className="eyebrow">当前 Runtime</p>
            <h2>执行详情</h2>
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
          <section aria-live="polite" className="run-overview">
            <div className="run-top">
              <span className="running-orb">
                <i />
              </span>
              <div>
                <strong>
                  {status === "running"
                    ? "正在执行任务"
                    : status === "waiting"
                      ? "等待你的输入"
                      : status === "compacting"
                        ? "正在压缩上下文"
                        : "会话空闲"}
                </strong>
                <small>{phase ? `阶段：${phase}` : "等待下一步"}</small>
              </div>
            </div>
            <p>
              {run?.state === "retrying"
                ? `正在重试${run.attempt && run.max_attempts ? `（${run.attempt}/${run.max_attempts}）` : ""}${run.delay_ms ? `，${Math.ceil(run.delay_ms / 1000)} 秒后继续` : ""}。`
                : run?.message || "实时状态和工具活动来自当前 Runtime 会话。"}
            </p>
            {run?.error && (
              <small className="form-error">{run.error.message}</small>
            )}
            {run?.run_error && (
              <small className="form-error">
                {run.run_error.kind === "session_model_unavailable"
                  ? `会话模型不可用：${run.run_error.model_ref ?? "—"}`
                  : "尚未配置模型。"}
              </small>
            )}
            {onResume && (
              <button
                className="resume-button"
                disabled={busy}
                onClick={() => void act(onResume)}
                type="button"
              >
                恢复执行
              </button>
            )}
          </section>
          {(ask || guard) && (
            <section className="approval-card">
              <div className="approval-heading">
                <span>
                  <Icon name="warning" size={17} />
                </span>
                <div>
                  <strong>{guard ? "需要你的授权" : "Suna 有一个问题"}</strong>
                  <small>{guard ? guard.tool : "请回复后继续"}</small>
                </div>
              </div>
              <p>{guard ? guard.reason : ask?.question}</p>
              {(ask && !ask.can_reply) || (guard && !guard.can_reply) ? (
                <small className="reply-unavailable">
                  此请求由其他客户端处理；当前窗口仅可查看。
                </small>
              ) : null}
              {ask?.options && (
                <div className="ask-options">
                  {ask.options.map((option) => (
                    <button
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
                <div className="reply-box">
                  <input
                    aria-label="回答"
                    disabled={!ask.can_reply || busy}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="输入你的回答"
                    value={answer}
                  />
                  <button
                    className="approve"
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
                <div className="approval-actions">
                  <button
                    disabled={!canGuardReply}
                    onClick={() =>
                      void act(() => onGuardReply(guard.id, "reject"))
                    }
                    type="button"
                  >
                    拒绝
                  </button>
                  <button
                    className="approve"
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
              {error && <small className="form-error">{error}</small>}
            </section>
          )}
          <section className="detail-section">
            <div className="section-heading">
              <h3>工具活动</h3>
            </div>
            <div className="metric-row">
              <span>已执行</span>
              <b>{toolSummary?.total ?? 0}</b>
            </div>
            <div className="metric-row">
              <span>成功 / 失败</span>
              <b>
                {toolSummary
                  ? `${toolSummary.success} / ${toolSummary.failed}`
                  : "—"}
              </b>
            </div>
            {toolSummary?.recent?.slice(0, 4).map((tool, index) => (
              <div className="metric-row" key={`${tool.tool}-${index}`}>
                <span>{tool.tool}</span>
                <small>{tool.status}</small>
              </div>
            ))}
          </section>
          <section className="detail-section usage">
            <div className="section-heading">
              <h3>本次用量</h3>
              <button
                aria-label="压缩上下文"
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
            <div>
              <span>输入 / 输出</span>
              <b>
                {tokenCount(usage?.input_tokens)} /{" "}
                {tokenCount(usage?.output_tokens)}
              </b>
            </div>
            <div>
              <span>今日请求</span>
              <b>{totals?.requests ?? "—"}</b>
            </div>
            <div className="usage-track">
              <span style={{ width: `${contextPercent}%` }} />
            </div>
            {usage?.context_window && (
              <small>
                上下文 {tokenCount(context)} / {tokenCount(usage.context_window)}
              </small>
            )}
          </section>
          {canConfigure && config && (
            <section className="detail-section">
              <div className="section-heading">
                <h3>会话模型</h3>
              </div>
              <select
                aria-label="会话模型"
                disabled={!selectedModel || controlsDisabled}
                onChange={(event) =>
                  void act(() => onUpdateModel(event.target.value))
                }
                value={selectedModel}
              >
                {!config.models.some(
                  (model) => `${model.provider}/${model.model}` === selectedModel,
                ) &&
                  selectedModel && (
                    <option value={selectedModel}>
                      {selectedModel}（不可用）
                    </option>
                  )}
                {config.models.map((model) => {
                  const ref = `${model.provider}/${model.model}`;
                  return (
                    <option key={ref} value={ref}>
                      {ref}
                    </option>
                  );
                })}
              </select>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
