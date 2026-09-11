import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useT, type Translate } from "../../lib/i18n";
import { LazyMarkdown } from "./LazyMarkdown";

function activityCopy(
  t: Translate,
  phase?: string,
  pending?: boolean,
  activeTool?: { tool: string; intent?: string; status?: string },
  streaming?: "thinking" | "replying",
) {
  if (phase === "ask") {
    return {
      label: t("activity.ask"),
      detail: t("activity.askDetail"),
      tone: "ask",
    };
  }
  if (activeTool?.status === "failed") {
    return {
      label: t("activity.toolFailed"),
      detail: activeTool.intent || activeTool.tool,
      tone: "failed",
    };
  }
  if (activeTool?.status === "guard" || phase === "guard") {
    return {
      label: t("activity.guard"),
      detail:
        activeTool?.intent || activeTool?.tool || t("activity.guardDetail"),
      tone: "guard",
    };
  }
  if (phase === "compact" || phase === "compacting") {
    return {
      label: t("activity.compact"),
      detail: t("activity.compactDetail"),
      tone: "compact",
    };
  }
  if (phase === "skill") {
    return {
      label: t("activity.skill"),
      detail: t("activity.skillDetail"),
      tone: "skill",
    };
  }
  if (activeTool || phase === "tool") {
    return {
      label: activeTool?.tool
        ? t("activity.toolRunningDetail", { tool: activeTool.tool })
        : t("activity.toolRunning"),
      detail: activeTool?.intent || t("activity.toolDetail"),
      tone: "tool",
    };
  }
  // 流式输出阶段比 phase=model 更精确：reasoning 流=思考中、
  // assistant 流=正在回复（协议 agent.delta kind 可推导）。
  if (streaming === "thinking") {
    return {
      label: t("chat.thinking"),
      detail: t("activity.thinkingDetail"),
      tone: "model",
    };
  }
  if (streaming === "replying") {
    return {
      label: t("activity.replying"),
      detail: t("activity.replyingDetail"),
      tone: "model",
    };
  }
  if (pending) {
    return {
      label: t("activity.pending"),
      detail: t("activity.pendingDetail"),
      tone: "pending",
    };
  }
  if (phase === "model") {
    return {
      label: t("activity.model"),
      detail: t("activity.modelDetail"),
      tone: "model",
    };
  }
  return {
    label: t("activity.processing"),
    detail: t("activity.nextStep"),
    tone: "model",
  };
}

export { activityCopy };

/**
 * 运行活动条：位于输入框上方（loading 跟随输入焦点）。
 * 状态细分（协议可推导）：等待模型（无 delta）/ 思考中（reasoning 流）/
 * 正在回复（assistant 流）/ 工具执行（含工具名）/ 待确认 / 提问 / 压缩 / 技能。
 * run 开始/结束各一次出现/消失，非逐帧位移。
 */
export function ActivityStrip({
  phase,
  pending,
  activeTool,
  streaming,
}: {
  phase?: string;
  pending?: boolean;
  activeTool?: { tool: string; intent?: string; status?: string };
  /** 流式输出阶段：thinking=reasoning 流，replying=assistant 流。 */
  streaming?: "thinking" | "replying";
}) {
  const t = useT();
  const activity = activityCopy(t, phase, pending, activeTool, streaming);
  const toneClass = toneClasses[activity.tone] ?? toneClasses.default;
  return (
    /* 极简文本行：呼吸点 + 状态词 + 次要 detail。无边框无底色，
       与时间线的安静气质一致（胶囊底色反而显得笨重）。 */
    <div
      aria-atomic="true"
      aria-live="polite"
      className={`flex min-w-0 items-center gap-1.5 py-0.5 pl-0.5 text-[10.5px] ${toneClass}`}
      role="status"
    >
      <ActivityDots />
      <span className="shrink-0 font-semibold">{activity.label}</span>
      {activity.detail && (
        <span
          className="min-w-0 truncate font-mono text-[10px] text-ink-muted"
          title={activity.detail}
        >
          {activity.detail}
        </span>
      )}
    </div>
  );
}

export function ActivityDots() {
  return (
    <span
      aria-hidden="true"
      className="activity-dots inline-flex items-center gap-[3px]"
    >
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
  /** label 可为空：只显示呼吸点（按钮文案已表达状态时不重复）。 */
  label?: string;
  detail?: string;
}) {
  return (
    <span className="ml-0.5 inline-flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-blue-strong">
      <ActivityDots />
      {label ? <span role="status">{label}</span> : null}
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
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  // 空思考段不渲染：恢复/收尾瞬间可能出现空文本（无内容却显示“思考中”）。
  if (!text.trim()) return null;
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
        <span className="ml-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber">
          <Icon
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            name="chevron-down"
            size={12}
          />
          {done
            ? expanded
              ? t("chat.collapseThinking")
              : t("chat.viewThinking")
            : t("chat.thinking")}
        </span>
        {running && !done && <StreamActivity label="" />}
      </button>
      {expanded && (
        <div className="markdown-body min-w-0 max-w-[650px] animate-[panel-pop_180ms_cubic-bezier(0.2,0.8,0.2,1)_both] border-l-2 border-amber/50 py-1 pl-3 text-[13px] leading-[1.82] text-ink-soft [overflow-wrap:anywhere]">
          <LazyMarkdown>{text}</LazyMarkdown>
        </div>
      )}
    </article>
  );
}

export const toneClasses: Record<string, string> = {
  guard: "text-amber [&_.activity-dots]:text-amber",
  failed: "text-rose [&_.activity-dots]:text-rose",
  ask: "text-blue-strong [&_.activity-dots]:text-blue",
  default: "text-ink-soft [&_.activity-dots]:text-blue",
};
