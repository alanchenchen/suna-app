import { Icon } from "../../components/Icon";
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
  return (
    <>
      {observer && (
        <div
          aria-live="polite"
          className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-rose/25 bg-[linear-gradient(180deg,rgba(244,63,94,0.09),rgba(244,63,94,0.04))] px-7 py-2.5 text-[12.5px] text-ink backdrop-blur-md max-[720px]:px-3.5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="relative grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[9px] bg-rose/12 text-rose">
              <Icon name="eye" size={14} />
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 h-2 w-2 animate-[breathe_2.4s_ease-in-out_infinite] rounded-full bg-blue shadow-[0_0_0_3px_var(--color-surface-solid)]"
              />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-[12.5px] font-extrabold text-ink">
                {handoffRole === "guest"
                  ? "正在观察运行中的会话"
                  : "会话正在其他客户端运行"}
              </strong>
              <span className="block truncate text-[11px] text-ink-muted">
                {handoffRole === "guest"
                  ? "任务结束后可接管输入"
                  : "当前窗口仅可查看，任务由另一个客户端控制"}
              </span>
            </span>
          </span>
          {selected && selected.client_count > 1 && (
            <span className="shrink-0 rounded-full border border-line bg-surface-solid/80 px-2.5 py-1 text-[10.5px] font-extrabold text-ink-soft">
              {selected.client_count} 个客户端
            </span>
          )}
        </div>
      )}
      {error && (
        <div
          className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-rose/25 bg-[linear-gradient(180deg,rgba(244,63,94,0.09),rgba(244,63,94,0.04))] px-7 py-2.5 text-[12.5px] text-ink backdrop-blur-md max-[720px]:px-3.5"
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
            关闭
          </button>
        </div>
      )}
    </>
  );
}
