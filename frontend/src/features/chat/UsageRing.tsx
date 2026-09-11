import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";
import { useT } from "../../lib/i18n";
import type { AgentUsageEvent } from "../../lib/runtimeBridge";

/**
 * 上下文用量展示：嵌在输入区工具行内。
 * 桌面（>720px）宽输入区直接平铺五项指标（输入/输出/速度/缓存命中/上下文），
 * 缓存命中 hover 出读写明细；移动端收成单枚上下文芯片（icon+百分比+健康度色），
 * 点按/悬停弹出与桌面同语言的明细浮层——不再用圆环（26px 内塞数字+角标
 * 可读性差，且与桌面的 icon+数值语言不一致）。
 * 色阶表达余量健康度（健康蓝 → 过半琥珀 → 临近上限玫瑰）。
 */

function compact(value?: number) {
  return value
    ? Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : "—";
}

/** 明细行：左标签右数值。 */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-between gap-3 text-[10.5px]">
      <span className="font-semibold text-ink-muted">{label}</span>
      <span className="font-mono font-bold tabular-nums text-ink">{value}</span>
    </span>
  );
}

/** 上下文健康度配色（文字 tone 共用阈值）。 */
function contextToneClass(contextPercent: number) {
  return contextPercent >= 85
    ? "text-rose"
    : contextPercent >= 60
      ? "text-amber"
      : "text-ink-muted";
}

/** 明细浮层：上下文/输入/输出/缓存命中/读写明细，桌面与移动共用。 */
function UsageDetailPanel({
  usage,
  cacheHit,
  context,
}: {
  usage: AgentUsageEvent;
  cacheHit?: number;
  context?: number;
}) {
  const t = useT();
  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 grid w-[188px] animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] gap-1.5 rounded-xl border border-line bg-surface-solid p-2.5 shadow-md">
      <DetailRow
        label={t("usage.context")}
        value={`${compact(context)} / ${compact(usage.context_window)}`}
      />
      <DetailRow label={t("usage.input")} value={compact(usage.input_tokens)} />
      <DetailRow
        label={t("usage.output")}
        value={compact(usage.output_tokens)}
      />
      {cacheHit != null && (
        <DetailRow
          label={t("usage.cacheHit")}
          value={`${cacheHit.toFixed(2)}%`}
        />
      )}
      {usage.cache_read_tokens != null && (
        <DetailRow
          label={t("usage.cacheRead")}
          value={compact(usage.cache_read_tokens)}
        />
      )}
      {usage.cache_creation_tokens != null && (
        <DetailRow
          label={t("usage.cacheWrite")}
          value={compact(usage.cache_creation_tokens)}
        />
      )}
    </div>
  );
}

/** 移动端上下文芯片：layers 图标 + 百分比 + 健康度色，点按/悬停出明细。 */
export function UsageRing({ usage }: { usage?: AgentUsageEvent }) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  // 仅悬停设备启用 hover 打开；触屏设备用点按切换
  // （tap 会先触发 mouseenter，若同时响应会立即被 click 关掉）。
  const canHover = useMemo(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(hover: hover)")?.matches),
    [],
  );
  // 点按打开后：点击外部或 Escape 关闭。
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned]);

  if (!usage) return null;
  const context = usage.context_tokens ?? usage.estimated_context_tokens;
  const contextPercent =
    context && usage.context_window
      ? Math.min(100, (context / usage.context_window) * 100)
      : 0;
  // 缓存命中率：缓存读取量占输入总量的比例（input_tokens 含缓存读取）。
  const cacheHit =
    usage.input_tokens > 0 && usage.cache_read_tokens != null
      ? Math.min(100, (usage.cache_read_tokens / usage.input_tokens) * 100)
      : undefined;
  const tone = contextToneClass(contextPercent);
  const open = hovered || pinned;
  const ariaLabel = t("usage.contextAria", {
    used: compact(context),
    total: compact(usage.context_window),
  });
  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => canHover && setHovered(true)}
      onMouseLeave={() => canHover && setHovered(false)}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-[10px] px-1.5 transition-colors duration-150 hover:bg-surface-subtle max-[720px]:h-10"
        onClick={() => setPinned((value) => !value)}
        type="button"
      >
        <Icon className={`shrink-0 ${tone}`} name="layers" size={12} />
        <span
          className={`font-mono text-[11px] font-bold tabular-nums ${tone}`}
        >
          {contextPercent.toFixed(0)}%
        </span>
      </button>
      {open && (
        <UsageDetailPanel cacheHit={cacheHit} context={context} usage={usage} />
      )}
    </span>
  );
}

/** 用量项：icon + 数值，tooltip 出完整语义与明细（宽输入区的紧凑平铺）。
 * tooltip 只放 detail（不含 label，避免“输入 · 输入 tokens…”重复）；
 * 无 detail 时 tooltip 省略（icon+数值本身已是信息）。 */
function UsageStat({
  icon,
  value,
  label,
  detail,
  tone,
}: {
  icon: IconName;
  value: string;
  label: string;
  detail?: string;
  tone?: string;
}) {
  const stat = (
    <span
      aria-label={`${label} ${value}`}
      className="inline-flex cursor-help items-center gap-1"
    >
      <Icon
        className={`shrink-0 ${tone ?? "text-ink-muted"}`}
        name={icon}
        size={11}
      />
      <span
        className={`font-mono font-bold tabular-nums ${tone ?? "text-ink"}`}
      >
        {value}
      </span>
    </span>
  );
  return detail ? <Tooltip label={detail}>{stat}</Tooltip> : stat;
}

/** 桌面平铺用量：宽输入区直接展示（icon+数值，hover 出完整语义与明细）。
 * 移动端隐藏，回落到 UsageRing 上下文芯片。同一组件内 CSS 响应式切换，
 * 无 matchMedia。 */
export function UsageMeter({ usage }: { usage?: AgentUsageEvent }) {
  const t = useT();
  if (!usage) return null;
  const context = usage.context_tokens ?? usage.estimated_context_tokens;
  const contextPercent =
    context && usage.context_window
      ? Math.min(100, (context / usage.context_window) * 100)
      : 0;
  const cacheHit =
    usage.input_tokens > 0 && usage.cache_read_tokens != null
      ? Math.min(100, (usage.cache_read_tokens / usage.input_tokens) * 100)
      : undefined;
  const contextColor =
    contextPercent >= 85
      ? "text-rose"
      : contextPercent >= 60
        ? "text-amber"
        : undefined;
  const tps =
    usage.tokens_per_sec && usage.tokens_per_sec > 0
      ? usage.tokens_per_sec >= 100
        ? Math.round(usage.tokens_per_sec).toString()
        : usage.tokens_per_sec.toFixed(1)
      : undefined;
  return (
    <>
      {/* 桌面平铺（>720px）：icon+数值紧凑排布，hover 出语义与明细。 */}
      <span className="hidden min-w-0 items-center gap-2.5 text-[10.5px] whitespace-nowrap min-[721px]:inline-flex">
        <UsageStat
          detail={
            usage.cache_read_tokens != null
              ? t("usage.inputDetail", {
                  cache: compact(usage.cache_read_tokens),
                })
              : undefined
          }
          icon="arrow-up"
          label={t("usage.input")}
          value={compact(usage.input_tokens)}
        />
        <UsageStat
          icon="arrow-down"
          label={t("usage.output")}
          value={compact(usage.output_tokens)}
        />
        {tps && (
          <UsageStat
            detail={t("usage.tpsHint")}
            icon="zap"
            label={t("usage.speed")}
            value={`${tps}tok/s`}
          />
        )}
        {cacheHit != null && (
          <UsageStat
            detail={
              [
                usage.cache_read_tokens != null
                  ? `${t("usage.cacheRead")} ${compact(usage.cache_read_tokens)}`
                  : undefined,
                // 缓存写入为 0/缺失时不展示（纯命中场景无写入是常态）。
                usage.cache_creation_tokens
                  ? `${t("usage.cacheWrite")} ${compact(usage.cache_creation_tokens)}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            icon="database"
            label={t("usage.cacheHit")}
            value={`${cacheHit.toFixed(2)}%`}
          />
        )}
        <UsageStat
          detail={t("usage.contextAria", {
            used: compact(context),
            total: compact(usage.context_window),
          })}
          icon="layers"
          label={t("usage.context")}
          tone={contextColor}
          value={`${compact(context)}/${compact(usage.context_window)}`}
        />
      </span>
      {/* 移动端上下文芯片（点按出完整明细）。 */}
      <span className="inline-flex min-[721px]:hidden">
        <UsageRing usage={usage} />
      </span>
    </>
  );
}
