import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { MobileTab } from "../appShell/useAppShell";

type MobileTabbarProps = {
  mobileTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  onOpenSettings: () => void;
};

/**
 * 移动端底部导航：总览 / 任务 / 设置（设计 §12.4）。
 * 仅窄屏显示；桌面由侧栏 + Header 承担同等功能。
 * 总览用网格图标、任务用对话图标，避免两个 tab 视觉混淆。
 */
export function MobileTabbar({
  mobileTab,
  onTabChange,
  onOpenSettings,
}: MobileTabbarProps) {
  const t = useT();
  return (
    <nav aria-label={t("common.mainNav")} className="mobile-tabbar">
      <button
        aria-current={mobileTab === "overview" ? "page" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
        onClick={() => onTabChange("overview")}
        type="button"
      >
        <Icon
          className={
            mobileTab === "overview" ? "text-blue-strong" : "text-ink-muted"
          }
          name="grid"
          size={17}
        />
        {t("nav.overview")}
      </button>
      <button
        aria-current={mobileTab === "session" ? "page" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
        onClick={() => onTabChange("session")}
        type="button"
      >
        <Icon
          className={
            mobileTab === "session" ? "text-blue-strong" : "text-ink-muted"
          }
          name="message"
          size={17}
        />
        {t("nav.task")}
      </button>
      <button
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
        onClick={onOpenSettings}
        type="button"
      >
        <Icon className="text-ink-muted" name="settings" size={17} />
        {t("nav.settings")}
      </button>
    </nav>
  );
}
