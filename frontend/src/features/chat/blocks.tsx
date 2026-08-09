import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../../components/Icon";
import type {
  AskUserEvent,
  GuardConfirmEvent,
  ToolFlowItem,
} from "../../lib/runtimeBridge";

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

/** 思考段：未结束时显示"正在思考 + 呼吸点"，结束后折叠为可展开的过程记录。 */
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

export const toneClasses: Record<string, string> = {
  guard:
    "bg-amber-soft/70 border-amber/30 [&_.agent-activity-icon]:text-amber [&_.activity-dots]:text-amber",
  failed:
    "bg-rose/10 border-rose/25 [&_.agent-activity-icon]:text-rose [&_.activity-dots]:text-rose",
  default:
    "bg-blue-soft/60 border-blue/25 [&_.agent-activity-icon]:text-blue-strong [&_.activity-dots]:text-blue",
};

/** 工具卡：状态点 + 工具名 + 意图，点击展开参数与执行结果。 */
export function ToolCard({ item }: { item: ToolFlowItem }) {
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
    <div className="markdown-body rounded-[18px] bg-surface-subtle/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      ) : (
        <p className="m-0 line-clamp-4 whitespace-pre-wrap text-[13px] leading-[1.82] text-ink">
          {text.slice(0, 800)}
        </p>
      )}
    </div>
  );
}

/** 内嵌决策卡：Guard 授权 / AskUser 问答，出现在产生它的上下文旁边。 */
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
  onGuardReply?: (id: string, decision: "approve" | "reject") => Promise<void>;
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
  );
}
