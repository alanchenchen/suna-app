import { useT } from "../../lib/i18n";
import type { AgentUsageEvent } from "../../lib/runtimeBridge";

/**
 * 会话用量条：贴在输入区上方的轻量状态行（替代原右侧详情抽屉）。
 * 只展示运行中真正关心的四个数字：输入/输出、缓存命中、上下文余量。
 * 数字全部紧凑格式化，空间不够时按优先级折叠（先藏缓存，再藏输入输出）。
 */

function compact(value?: number) {
  return value
    ? Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : "—";
}

export function UsageBar({ usage }: { usage?: AgentUsageEvent }) {
  const t = useT();
  if (!usage) return null;
  const context = usage.context_tokens ?? usage.estimated_context_tokens;
  const contextPercent =
    context && usage.context_window
      ? Math.min(100, (context / usage.context_window) * 100)
      : 0;
  // 上下文余量色阶：健康绿 → 过半琥珀 → 临近上限玫瑰。
  const contextTone =
    contextPercent >= 85
      ? "text-rose"
      : contextPercent >= 60
        ? "text-amber"
        : "text-ink-muted";
  const cachePercent =
    usage.cache_read_tokens && usage.input_tokens
      ? Math.min(100, (usage.cache_read_tokens / usage.input_tokens) * 100)
      : undefined;
  return (
    <div className="mx-auto mb-1.5 flex w-[min(720px,100%)] items-center gap-3 px-1 text-[10.5px] font-semibold text-ink-muted max-[720px]:gap-2 max-[720px]:px-0.5">
      <span className="flex items-center gap-1 whitespace-nowrap">
        {t("usage.inOut", {
          input: compact(usage.input_tokens),
          output: compact(usage.output_tokens),
        })}
      </span>
      {cachePercent !== undefined && (
        <span className="hidden items-center gap-1 whitespace-nowrap sm:flex">
          <span className="text-green">{cachePercent.toFixed(0)}%</span>
          {t("usage.cache")}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
        <span className="relative h-[3px] w-10 overflow-hidden rounded-full bg-surface-subtle max-[720px]:w-7">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${contextPercent >= 85 ? "bg-rose" : contextPercent >= 60 ? "bg-amber" : "bg-blue"}`}
            style={{ width: `${Math.max(2, contextPercent)}%` }}
          />
        </span>
        <span className={`tabular-nums ${contextTone}`}>
          {contextPercent.toFixed(0)}%
        </span>
        <span className="hidden sm:inline">{t("usage.context")}</span>
      </span>
    </div>
  );
}
