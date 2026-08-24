import { useCallback, useEffect, useState } from "react";
import type { Theme } from "../../lib/models";

/**
 * AppShell 的纯 UI 状态：面板开关、表单草稿、主题、移动端布局与全局快捷键。
 * 与 Runtime 会话状态（useRuntimeSession）解耦，AppShell 只做组合。
 */

export type MobileTab = "overview" | "session";

export function useAppShell() {
  // Runtime 引导安装面板：连接失败（Runtime 未安装）时自动/手动进入。
  const [showInstall, setShowInstall] = useState(false);
  // 主题：默认跟随系统（system），用户手动切换后记住偏好（light/dark）。
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("suna-theme");
    return saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "system";
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  // 系统主题变化时，若用户处于 system 模式则实时跟随。
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
  // 主题切换：同步写入 data-theme 并更新偏好。支持 View Transition 的
  // 浏览器用过渡包裹（不支持的自动降级为直接切换）。
  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (doc.startViewTransition) {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  }, [resolvedTheme]);
  // 主题生效 + 浏览器 UI 色（地址栏/状态栏）跟随。
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#10141e" : "#f5f7fb",
      );
    }
    window.localStorage.setItem("suna-theme", theme);
  }, [resolvedTheme, theme]);

  // 纯 UI 状态：面板开关与表单草稿。
  // 桌面默认打开右栏；移动端详情是底部 Sheet，默认关闭避免打开即弹层，
  // 缩小到移动端时也自动关闭（避免残留弹出）。
  const [detailsOpen, setDetailsOpen] = useState(
    () => !window.matchMedia("(max-width: 720px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => {
      if (media.matches) setDetailsOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  /** 移动端底部导航：总览 / 任务（工作台）/ 设置。 */
  const [mobileTab, setMobileTab] = useState<MobileTab>(() =>
    window.matchMedia("(max-width: 720px)").matches
      ? window.location.hash.includes("/session/")
        ? "session"
        : "overview"
      : "session",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 设置关闭动画进行中：先播退出动画再卸载，避免瞬消。 */
  const [settingsClosing, setSettingsClosing] = useState(false);
  const closeSettings = useCallback(() => {
    if (!settingsOpen) return;
    setSettingsClosing(true);
    window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 190);
  }, [settingsOpen]);
  /** 设置打开来源："models"（Onboarding 引导）时默认进模型 Tab。 */
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    "connection" | "models"
  >("connection");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  /** 已忽略的等待通知会话（本地记忆，避免重复打扰）。 */
  const [dismissedWaiting, setDismissedWaiting] = useState<Set<string>>(
    () => new Set(),
  );

  // 全局快捷键：Cmd/Ctrl+K 命令面板、Cmd/Ctrl+N 新建任务、Cmd/Ctrl+, 设置。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
        return;
      }
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }
      if (mod && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    showInstall,
    setShowInstall,
    theme,
    setTheme,
    resolvedTheme,
    toggleTheme,
    detailsOpen,
    setDetailsOpen,
    mobileMenuOpen,
    setMobileMenuOpen,
    mobileTab,
    setMobileTab,
    createOpen,
    setCreateOpen,
    settingsOpen,
    setSettingsOpen,
    settingsClosing,
    closeSettings,
    settingsInitialTab,
    setSettingsInitialTab,
    editingTitle,
    setEditingTitle,
    titleDraft,
    setTitleDraft,
    commandOpen,
    setCommandOpen,
    dismissedWaiting,
    setDismissedWaiting,
  };
}
