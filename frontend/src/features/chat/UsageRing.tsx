import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import type { AgentUsageEvent } from "../../lib/runtimeBridge";

/**
 * 上下文用量环：嵌在输入区工具行内（替代进度条形态）。
 * 形态：SVG 圆环 + 环内百分比，色阶表达余量健康度
 * （健康蓝 → 过半琥珀 → 临近上限玫瑰）。
 * 交互：桌面 hover / 触屏点按打开明细浮层（上下文 / 输入 / 输出 / 缓存命中）。
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
  const tone =
    contextPercent >= 85
      ? "stroke-rose"
      : contextPercent >= 60
        ? "stroke-amber"
        : "stroke-blue";
  const textTone =
    contextPercent >= 85
      ? "text-rose"
      : contextPercent >= 60
        ? "text-amber"
        : "text-ink-muted";
  const open = hovered || pinned;
  const ariaLabel = t("usage.contextAria", {
    used: compact(context),
    total: compact(usage.context_window),
  });
  // 圆环几何：半径 10.5，周长 2πr ≈ 65.97。
  const radius = 10.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      className="relative ml-0.5 inline-flex shrink-0"
      onMouseEnter={() => canHover && setHovered(true)}
      onMouseLeave={() => canHover && setHovered(false)}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="grid h-8 w-8 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-surface-subtle max-[720px]:h-10 max-[720px]:w-10"
        onClick={() => setPinned((value) => !value)}
        type="button"
      >
        <span className="relative grid h-[26px] w-[26px] place-items-center">
          <svg
            aria-hidden="true"
            className="h-[26px] w-[26px] -rotate-90"
            viewBox="0 0 26 26"
          >
            <circle
              className="stroke-surface-subtle"
              cx="13"
              cy="13"
              fill="none"
              r={radius}
              strokeWidth="3"
            />
            <circle
              className={`${tone} transition-[stroke-dasharray] duration-500`}
              cx="13"
              cy="13"
              fill="none"
              r={radius}
              strokeDasharray={`${(contextPercent / 100) * circumference} ${circumference}`}
              strokeLinecap="round"
              strokeWidth="3"
            />
          </svg>
          <span
            className={`absolute text-[8.5px] font-bold tabular-nums ${textTone}`}
          >
            {contextPercent.toFixed(0)}
          </span>
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 grid w-[188px] animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] gap-1.5 rounded-xl border border-line bg-surface-solid p-2.5 shadow-md">
          <DetailRow
            label={t("usage.context")}
            value={`${compact(context)} / ${compact(usage.context_window)}`}
          />
          <DetailRow
            label={t("usage.input")}
            value={compact(usage.input_tokens)}
          />
          <DetailRow
            label={t("usage.output")}
            value={compact(usage.output_tokens)}
          />
          {cacheHit != null && (
            <DetailRow
              label={t("usage.cacheHit")}
              value={`${cacheHit.toFixed(0)}%`}
            />
          )}
        </div>
      )}
    </span>
  );
}
