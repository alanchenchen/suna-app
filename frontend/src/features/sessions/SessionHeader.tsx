import { Icon, IconButton } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { Tooltip } from "../../components/ui/Tooltip";
import type { SessionInfo } from "../../lib/runtimeBridge";

type SessionHeaderProps = {
  selected?: SessionInfo;
  handoffRole: "host" | "guest";
  resolvedTheme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenMobileMenu: () => void;
};

/** 工作区顶部栏：会话标题、状态徽章与主题/设置操作。
 * 停止操作只保留输入框内的蓝色圆停止钮（单一入口，避免双停止钮）。 */
export function SessionHeader({
  selected,
  handoffRole,
  resolvedTheme,
  onToggleTheme,
  onOpenSettings,
  onOpenMobileMenu,
}: SessionHeaderProps) {
  const t = useT();
  return (
    <header className="relative flex min-h-[60px] items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3 max-[720px]:min-h-[56px] max-[720px]:gap-2.5 max-[720px]:px-3.5 max-[720px]:pt-[max(10px,env(safe-area-inset-top))] max-[720px]:pb-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButton
          className="hidden max-[720px]:inline-grid"
          label={t("header.openSidebar")}
          onClick={onOpenMobileMenu}
        >
          <Icon name="message" />
        </IconButton>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="m-0 min-w-0 basis-auto flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-extrabold tracking-tight text-ink max-[720px]:max-w-none max-[720px]:text-[13px]">
              {selected?.title || t("header.overview")}
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
                  ? t("header.running")
                  : selected.status === "waiting"
                    ? t("header.waiting")
                    : t("header.idle")}
              </span>
            )}
            {/* 多客户端共享：只显示客户端数量（“已加入/共享中”与状态点
                语义重复，数量才是真正缺的信息）。 */}
            {selected &&
              (handoffRole === "guest" || selected.client_count > 1) && (
                <span
                  aria-label={t("header.clients", {
                    count: selected.client_count,
                  })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-blue-strong"
                >
                  <Icon name="users" size={11} />
                  {t("header.clients", { count: selected.client_count })}
                </span>
              )}
          </div>
          <p
            className="m-0 max-w-[420px] truncate text-[11px] font-medium text-ink-muted max-[720px]:hidden"
            title={selected?.cwd}
          >
            {selected?.cwd || t("header.workspace")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 max-[720px]:gap-px">
        <Tooltip label={t("header.toggleTheme")}>
          <IconButton
            label={
              resolvedTheme === "dark"
                ? t("header.lightMode")
                : t("header.darkMode")
            }
            onClick={onToggleTheme}
          >
            <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t("header.openSettings")}>
          <IconButton label={t("header.openSettings")} onClick={onOpenSettings}>
            <Icon name="settings" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
