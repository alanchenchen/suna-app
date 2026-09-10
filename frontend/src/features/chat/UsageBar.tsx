import { useT } from "../../lib/i18n";
import type { AgentUsageEvent } from "../../lib/runtimeBridge";

/**
 * 上下文用量 badge：嵌在输入区工具行内（替代独立用量条）。
 * 形态：迷你进度条 + 百分比，色阶表达余量健康度
 * （健康蓝 → 过半琥珀 → 临近上限玫瑰）。悬停显示完整数字。
 */

function compact(value?: number) {
  return value
    ? Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : "—";
}

export function UsageBadge({ usage }: { usage?: AgentUsageEvent }) {
  const t = useT();
  if (!usage) return null;
  const context = usage.context_tokens ?? usage.estimated_context_tokens;
  const contextPercent =
    context && usage.context_window
      ? Math.min(100, (context / usage.context_window) * 100)
      : 0;
  const tone =
    contextPercent >= 85
      ? "bg-rose"
      : contextPercent >= 60
        ? "bg-amber"
        : "bg-blue";
  const textTone =
    contextPercent >= 85
      ? "text-rose"
      : contextPercent >= 60
        ? "text-amber"
        : "text-ink-muted";
  return (
    <span
      aria-label={t("usage.contextAria", {
        used: compact(context),
        total: compact(usage.context_window),
      })}
      className="ml-0.5 flex min-w-0 items-center gap-1.5"
      title={t("usage.contextAria", {
        used: compact(context),
        total: compact(usage.context_window),
      })}
    >
      <span className="relative h-[3px] w-9 shrink-0 overflow-hidden rounded-full bg-surface-subtle">
        <span
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${tone}`}
          style={{ width: `${Math.max(3, contextPercent)}%` }}
        />
      </span>
      <span
        className={`shrink-0 text-[10.5px] font-semibold tabular-nums ${textTone}`}
      >
        {contextPercent.toFixed(0)}%
      </span>
    </span>
  );
}
