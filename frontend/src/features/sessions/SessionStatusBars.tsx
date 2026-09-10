import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { SessionInfo } from "../../lib/runtimeBridge";

type SessionStatusBarsProps = {
  observer: boolean;
  handoffRole: "host" | "guest";
  selected?: SessionInfo;
  error?: string;
  onCloseError: () => void;
};

/**
 * 工作区状态条：观察者提示（加入他人运行中的会话）与错误提示。
 * 作为 workspace 的独立 grid 行渲染，滚动内容不会与其重叠。
 */
export function SessionStatusBars({
  observer,
  handoffRole,
  selected,
  error,
  onCloseError,
}: SessionStatusBarsProps) {
  const t = useT();
  // 无论是否有提示都渲染占位 div：workspace 是 4 行 grid
  // （header / 状态条 / 时间线 / 输入区），若状态条缺位，时间线会落到
  // auto 行、输入区落到 1fr 行被拉伸/压扁，长会话下输入框会消失。
  return (
    <div className={!observer && !error ? "min-h-0" : undefined}>
      {observer && (
        <div
          aria-live="polite"
          className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-line bg-surface px-7 py-2 text-[12.5px] text-ink max-[720px]:px-3.5"
        >
          {/* 观察态是信息而非告警：用中性细边框条 + 蓝色呼吸点表达，
              不与真正的错误（rose）争夺视觉权重（ZCode：状态用小点+文字）。 */}
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-[7px] w-[7px] shrink-0 animate-[breathe_2.4s_ease-in-out_infinite] rounded-full bg-blue"
            />
            <span className="min-w-0 truncate">
              <span className="font-bold text-ink">
                {handoffRole === "guest"
                  ? t("statusbar.observing")
                  : t("statusbar.otherClient")}
              </span>
              <span className="text-[11px] text-ink-muted">
                {" \u00b7 "}
                {handoffRole === "guest"
                  ? t("statusbar.canTakeOver")
                  : t("statusbar.viewOnly")}
              </span>
            </span>
          </span>
          {selected && selected.client_count > 1 && (
            <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[10.5px] font-bold text-ink-soft">
              {t("statusbar.clients", { count: selected.client_count })}
            </span>
          )}
        </div>
      )}
      {error && (
        <div
          className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-rose/25 bg-rose/5 px-7 py-2.5 text-[12.5px] text-ink max-[720px]:px-3.5"
          role="alert"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[9px] bg-rose/12 text-rose">
              <Icon name="warning" size={14} />
            </span>
            <span className="min-w-0 truncate">{error}</span>
          </span>
          <button
            className="shrink-0 cursor-pointer rounded-lg border border-rose/25 bg-surface-solid/80 px-2.5 py-1 text-[11px] font-bold text-rose transition-colors duration-150 hover:bg-rose/15"
            onClick={onCloseError}
            type="button"
          >
            {t("statusbar.close")}
          </button>
        </div>
      )}
    </div>
  );
}
