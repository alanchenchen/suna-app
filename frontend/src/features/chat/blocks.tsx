import { useState } from "react";
import { Icon } from "../../components/Icon";
import type {
  AskUserEvent,
  GuardConfirmEvent,
  SkillFlowItem,
  ToolFlowItem,
} from "../../lib/runtimeBridge";
import { LazyMarkdown } from "./LazyMarkdown";

function activityCopy(
  phase?: string,
  pending?: boolean,
  activeTool?: { tool: string; intent?: string; status?: string },
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

export function ActivityDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current" />
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current [animation-delay:140ms]" />
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current [animation-delay:280ms]" />
    </span>
  );
}

export function StreamActivity({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
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

/** 思考段：琥珀色 brain 头像，与蓝色 sparkle 的正式回复区分；
 * 未结束时显示“思考中 + 呼吸点”，结束后折叠为可展开的过程记录。 */
export function ReasoningBlock({
  text,
  running,
  done,
}: {
  text: string;
  running: boolean;
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
        <span className="grid h-[21px] w-[21px] place-items-center rounded-[7px] bg-amber-soft text-amber">
          <Icon name="brain" size={13} />
        </span>
        <strong className="text-ink">Suna</strong>
        <span className="ml-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber">
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
        <div className="markdown-body min-w-0 max-w-[650px] rounded-[18px] border border-amber/20 bg-amber-soft/45 px-4 py-3 text-[13px] leading-[1.82] text-ink-soft [overflow-wrap:anywhere]">
          <LazyMarkdown>{text}</LazyMarkdown>
        </div>
      )}
    </article>
  );
}

export const toneClasses: Record<string, string> = {
  guard:
    "bg-amber-soft/70 border-amber/30 [&_.agent-activity-icon]:text-amber [&_.activity-dots]:text-amber",
  failed:
    "bg-rose/10 border-rose/25 [&_.agent-activity-icon]:text-rose [&_.activity-dots]:text-rose",
  default:
    "bg-blue-soft/60 border-blue/25 [&_.agent-activity-icon]:text-blue-strong [&_.activity-dots]:text-blue",
};

/** 格式化工具耗时：不足 1 秒显示毫秒，超过显示秒（一位小数）。 */
export function formatDuration(ms?: number) {
  if (ms == null) return undefined;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 工具行折叠态的目标摘要：优先 intent，其次 params 里的路径/命令。 */
export function toolTarget(item: ToolFlowItem) {
  if (item.intent) return item.intent;
  const params = item.params ?? {};
  const candidates = [params.path, params.command, params.url, params.pattern];
  const found = candidates.find((value) => typeof value === "string" && value);
  return typeof found === "string" ? found : undefined;
}

/** 工具行：单行状态 + 工具名 + 目标摘要 + 耗时，点击展开参数与结果。
 * 紧凑形态是主流 agent UI 的共识（Claude Code / Cursor / OpenHands），
 * 一屏可扫读更多工具，展开才看细节。 */
export function ToolRow({ item }: { item: ToolFlowItem }) {
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
    Boolean(item.result) ||
    Boolean(item.error);
  const iconTone = {
    running: "bg-blue-soft text-blue-strong",
    guard: "bg-amber-soft text-amber",
    success: "bg-green-soft text-green",
    failed: "bg-rose/15 text-rose",
  }[status];
  const target = toolTarget(item);
  const duration = formatDuration(item.durationMs);
  return (
    <article className="animate-[message-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-[10px] border border-transparent transition-colors duration-150 hover:border-line hover:bg-surface-subtle/60">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2 py-[5px] text-left disabled:cursor-default"
        disabled={!hasDetail}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusMeta.dot}`}
        />
        <span
          className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-md ${iconTone}`}
        >
          <Icon name="tool" size={11} />
        </span>
        <code className="shrink-0 font-mono text-[11px] font-bold text-ink">
          {item.tool}
        </code>
        {target && (
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-muted">
            {target}
          </span>
        )}
        {duration && (
          <time className="shrink-0 font-mono text-[10px] text-ink-muted">
            {duration}
          </time>
        )}
        <span
          className={`shrink-0 text-[10px] font-extrabold ${statusMeta.text}`}
        >
          {statusMeta.label}
        </span>
        {hasDetail && (
          <Icon
            name="chevron-down"
            size={12}
            className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {expanded && hasDetail && (
        <div className="mx-2 mb-2 space-y-2 rounded-lg border border-line/70 bg-surface-raised/60 px-2.5 py-2">
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
          {item.result && !item.error && (
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
          {item.error && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-rose">
                错误
              </span>
              <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-rose">
                {item.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** 技能行：单行状态 + 技能名 + 徽章，review 结论点击展开（SkillCard 行化）。 */
export function SkillRow({ item }: { item: SkillFlowItem }) {
  const [expanded, setExpanded] = useState(false);
  const statusMeta = {
    loading: {
      dot: "bg-blue animate-pulse",
      label: "加载中",
      text: "text-blue-strong",
    },
    reviewing: {
      dot: "bg-amber animate-pulse",
      label: "校验中",
      text: "text-amber",
    },
    loaded: { dot: "bg-green", label: "已加载", text: "text-green" },
    done: { dot: "bg-green", label: "校验通过", text: "text-green" },
    error: { dot: "bg-rose", label: "校验失败", text: "text-rose" },
  }[item.status];
  const iconTone = {
    loading: "bg-blue-soft text-blue-strong",
    reviewing: "bg-amber-soft text-amber",
    loaded: "bg-green-soft text-green",
    done: "bg-green-soft text-green",
    error: "bg-rose/15 text-rose",
  }[item.status];
  return (
    <article className="animate-[message-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-[10px] border border-transparent transition-colors duration-150 hover:border-line hover:bg-surface-subtle/60">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2 py-[5px] text-left disabled:cursor-default"
        disabled={!item.detail}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusMeta.dot}`}
        />
        <span
          className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-md ${iconTone}`}
        >
          <Icon name="book" size={11} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">
          技能 {item.name}
        </span>
        <span
          className={`shrink-0 text-[10px] font-extrabold ${statusMeta.text}`}
        >
          {statusMeta.label}
        </span>
        {item.detail && (
          <Icon
            name="chevron-down"
            size={12}
            className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {expanded && item.detail && (
        <div className="mx-2 mb-2 rounded-lg border border-line/70 bg-surface-raised/60 px-2.5 py-2">
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
            {item.detail}
          </pre>
        </div>
      )}
    </article>
  );
}

/** 兼容别名：旧调用点（测试/外部）仍可引用 ToolCard/SkillCard 名称。 */
export const ToolCard = ToolRow;
export const SkillCard = SkillRow;

/** AskUser 自定义回答输入：回车发送，IME 组合输入时不误触。 */
export function AskInlineInput({
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

export { activityCopy };

/** 超长消息折叠阈值：超过则默认只显示预览，避免一次性渲染几万 token。 */
export const LONG_MESSAGE_THRESHOLD = 20_000;

/** 超长 assistant 消息：默认折叠为预览，点击展开完整 Markdown。 */
export function LongMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="markdown-body rounded-[18px] border border-line bg-surface-solid px-4 py-3 shadow-[0_1px_3px_rgba(28,42,72,0.07),inset_0_1px_0_rgba(255,255,255,0.06)]">
      {!expanded && (
        <button
          className="mb-2 block cursor-pointer text-[12px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
          onClick={() => setExpanded(true)}
          type="button"
        >
          展开完整内容（{Math.round(text.length / 1000)}KB）
        </button>
      )}
      {expanded ? (
        <LazyMarkdown>{text}</LazyMarkdown>
      ) : (
        <p className="m-0 line-clamp-4 whitespace-pre-wrap text-[13px] leading-[1.82] text-ink">
          {text.slice(0, 800)}
        </p>
      )}
    </div>
  );
}

/** 内嵌决策卡：Guard 授权 / AskUser 问答，出现在产生它的上下文旁边。
 * guard 带 suggestion 时展示三按钮（按建议执行/拒绝/批准原操作），
 * 对齐 suna Guard 的 modify 决策语义（设计 §7.4）。 */
export function DecisionCard({
  ask,
  guard,
  controlsDisabled,
  onAskReply,
  onGuardReply,
}: {
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  controlsDisabled: boolean;
  onAskReply?: (id: string, answer: string) => Promise<void>;
  onGuardReply?: (
    id: string,
    decision: "approve" | "reject" | "modify",
  ) => Promise<void>;
}) {
  if (!ask && !guard) return null;
  return (
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
      {guard?.suggestion && (
        <p className="mt-1.5 rounded-lg border border-amber/25 bg-amber/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
          <span className="font-extrabold text-ink">建议改为：</span>
          <code className="font-mono">{guard.suggestion}</code>
        </p>
      )}
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
          {guard.suggestion ? (
            // 有修改建议：三按钮（按建议执行 = modify / 拒绝 / 批准原操作）
            <button
              className="flex-1 cursor-pointer rounded-lg bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] px-3 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_6px_16px_var(--color-blue-glow)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!guard.can_reply || controlsDisabled}
              onClick={() => void onGuardReply?.(guard.id, "modify")}
              type="button"
            >
              按建议执行
            </button>
          ) : (
            <button
              className="flex-1 cursor-pointer rounded-lg bg-blue px-3 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!guard.can_reply || controlsDisabled}
              onClick={() => void onGuardReply?.(guard.id, "approve")}
              type="button"
            >
              批准
            </button>
          )}
          <button
            className="flex-1 cursor-pointer rounded-lg border border-line bg-surface-solid px-3 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!guard.can_reply || controlsDisabled}
            onClick={() => void onGuardReply?.(guard.id, "reject")}
            type="button"
          >
            拒绝
          </button>
          {guard.suggestion && (
            <button
              className="flex-1 cursor-pointer rounded-lg border border-line bg-surface-solid px-3 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!guard.can_reply || controlsDisabled}
              onClick={() => void onGuardReply?.(guard.id, "approve")}
              type="button"
            >
              批准原操作
            </button>
          )}
        </div>
      )}
    </section>
  );
}
