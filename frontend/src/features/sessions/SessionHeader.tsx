import { Icon, IconButton } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";
import type { SessionInfo } from "../../lib/runtimeBridge";

type SessionHeaderProps = {
  selected?: SessionInfo;
  handoffRole: "host" | "guest";
  resolvedTheme: "light" | "dark";
  detailsOpen: boolean;
  running: boolean;
  canControl: boolean;
  syncing: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onStop: () => void;
  onToggleDetails: () => void;
  onOpenMobileMenu: () => void;
};

/** 工作区顶部栏：会话标题、状态徽章与高频操作（主题/设置/停止/详情）。 */
export function SessionHeader({
  selected,
  handoffRole,
  resolvedTheme,
  detailsOpen,
  running,
  canControl,
  syncing,
  onToggleTheme,
  onOpenSettings,
  onStop,
  onToggleDetails,
  onOpenMobileMenu,
}: SessionHeaderProps) {
  return (
    <header className="flex min-h-[74px] items-center justify-between gap-4 border-b border-line px-7 py-3.5 max-[720px]:min-h-[65px] max-[720px]:gap-2.5 max-[720px]:px-3.5 max-[720px]:pt-[max(10px,env(safe-area-inset-top))] max-[720px]:pb-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButton
          className="hidden max-[720px]:inline-grid"
          label="打开会话列表"
          onClick={onOpenMobileMenu}
        >
          <Icon name="message" />
        </IconButton>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="m-0 min-w-0 basis-auto flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-extrabold tracking-tight text-ink max-[720px]:max-w-none max-[720px]:text-[13px]">
              {selected?.title || "任务总览"}
            </h1>
            {selected && (
              <span
                aria-live="polite"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-ink-soft max-[390px]:hidden"
              >
                <span
                  className={`h-[6px] w-[6px] rounded-full ${selected.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]" : selected.status === "waiting" ? "bg-amber" : "bg-ink-muted"}`}
                />
                {selected.status === "running"
                  ? "运行中"
                  : selected.status === "waiting"
                    ? "等待回答"
                    : "空闲"}
              </span>
            )}
            {selected &&
              (handoffRole === "guest" || selected.client_count > 1) && (
                <span
                  aria-label={
                    handoffRole === "guest"
                      ? `已加入会话，共 ${selected.client_count} 个客户端`
                      : `会话共享中，共 ${selected.client_count} 个客户端`
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-blue-strong"
                >
                  <Icon name="users" size={11} />
                  <span className="max-[720px]:hidden">
                    {handoffRole === "guest" ? "已加入" : "共享中"}
                  </span>
                  {selected.client_count > 1 && `· ${selected.client_count}`}
                </span>
              )}
          </div>
          <p className="m-0 max-[720px]:hidden">
            {selected?.cwd || "你的本地 Runtime 工作空间"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 max-[720px]:gap-px">
        <Tooltip label="切换主题">
          <IconButton
            label={
              resolvedTheme === "dark" ? "切换为浅色主题" : "切换为深色主题"
            }
            onClick={onToggleTheme}
          >
            <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Runtime 设置">
          <IconButton label="Runtime 设置" onClick={onOpenSettings}>
            <Icon name="settings" />
          </IconButton>
        </Tooltip>
        {running && canControl && !syncing && (
          <button
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-rose/10 px-2.5 text-[11px] font-bold text-rose transition-colors duration-150 hover:bg-rose/15 active:scale-95 max-[720px]:h-8 max-[720px]:px-2"
            onClick={onStop}
            type="button"
          >
            <Icon name="pause" size={15} />
            <span className="max-[390px]:hidden">停止</span>
          </button>
        )}
        <Tooltip label={detailsOpen ? "关闭任务详情" : "打开任务详情"}>
          <IconButton
            ariaControls="run-details"
            ariaExpanded={detailsOpen}
            className="aria-expanded:false:bg-blue-soft aria-expanded:false:text-blue-strong"
            label={detailsOpen ? "关闭任务详情" : "打开任务详情"}
            onClick={onToggleDetails}
          >
            <Icon name="panel" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
