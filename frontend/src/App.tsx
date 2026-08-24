import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { ChatTimeline } from "./features/chat/ChatTimeline";
import { Composer, type ComposerHandle } from "./features/chat/Composer";
import { RunDetails } from "./features/run/RunDetails";
import { CommandPalette } from "./features/commands/CommandPalette";
import { useRuntimeSession } from "./features/runtime/useRuntimeSession";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { SessionHeader } from "./features/sessions/SessionHeader";
import { SessionStatusBars } from "./features/sessions/SessionStatusBars";
import { SessionDialogs } from "./features/sessions/SessionDialogs";
import { TaskOverview } from "./features/overview/TaskOverview";
import { RuntimeSettings } from "./features/settings/RuntimeSettings";
import { RuntimeInstallPanel } from "./features/settings/RuntimeInstallPanel";
import type { Theme } from "./lib/models";
import { LocaleProvider, useT } from "./lib/i18n";
import "./styles/tailwind.css";

/** 应用壳：语言由 LocaleProvider 提供，主题与 UI 状态留在 AppShell。 */
export function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}

function AppShell() {
  const t = useT();
  // Runtime 引导安装面板：连接失败（Runtime 未安装）时用户主动触发。
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
  const [mobileTab, setMobileTab] = useState<
    "overview" | "session" | "settings"
  >(() =>
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
  const closeSettings = () => {
    if (!settingsOpen) return;
    setSettingsClosing(true);
    window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 190);
  };
  /** 设置打开来源："models"（Onboarding 引导）时默认进模型 Tab。 */
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    "connection" | "models"
  >("connection");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
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

  // 空状态建议卡 → 输入框填充草稿的桥。
  const composerRef = useRef<ComposerHandle>(null);
  const session = useRuntimeSession();
  const {
    sessions,
    selectedId,
    selected,
    active,
    messages,
    usage,
    config,
    setConfig,
    syncing,
    error,
    setError,
    observer,
    running,
    canControl,
    canConfig,
    handoffRole,
    rpc,
    connected,
    hello,
    status,
    bridgeError,
    cap,
    queueSessionOperation,
    attach,
    initialize,
    create,
    send,
    updateModel,
    rename,
    detach,
    remove,
    steer,
    removeSteering,
    steering,
    canSteer,
    maxSteering,
    mcpServers,
    refreshMcp,
  } = session;
  const sessionActionsFrozen = syncing || !selectedId;
  const current = active.snapshot?.current_run;

  // 路由（hash 深链 #/session/:id）：
  // - 刷新页面 / 新标签页 / 手机扫码直达时恢复会话（不需要重新点选）
  // - 切换会话时同步更新 hash（replaceState 避免历史堆叠）
  // - 协议 attach 语义不变，hash 只是视图层入口
  useEffect(() => {
    const applyHash = () => {
      if (!connected) return;
      const match = window.location.hash.match(/^#\/session\/(.+)$/);
      const target = match ? decodeURIComponent(match[1]) : undefined;
      if (target && target !== selectedId) void attach(target);
    };
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [attach, connected, selectedId]);
  // 连接建立后（含刷新恢复）应用一次当前 hash。
  useEffect(() => {
    if (!connected) return;
    const match = window.location.hash.match(/^#\/session\/(.+)$/);
    const target = match ? decodeURIComponent(match[1]) : undefined;
    if (target && target !== selectedId) void attach(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);
  // 选中会话变化 → 同步 hash；无选中 → 回到根 hash。
  useEffect(() => {
    const target = selectedId
      ? `#/session/${encodeURIComponent(selectedId)}`
      : "#/";
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [selectedId]);

  // 多任务通知：其他会话处于 waiting（等待用户）时，文档标题加计数徽标，
  // 工作台顶部显示通知条（设计 §5.2/§7.1）。侧栏已有 waiting 置顶 + 琥珀点。
  const otherWaiting = sessions.filter(
    (session) => session.status === "waiting" && session.id !== selectedId,
  );
  const [dismissedWaiting, setDismissedWaiting] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleWaiting = otherWaiting.filter(
    (session) => !dismissedWaiting.has(session.id),
  );
  useEffect(() => {
    document.title = visibleWaiting.length
      ? `(${visibleWaiting.length}) Suna App`
      : "Suna App";
    return () => {
      document.title = "Suna App";
    };
  }, [visibleWaiting.length]);

  if (!connected)
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        {showInstall ? (
          <RuntimeInstallPanel
            onDone={() => {
              setShowInstall(false);
              void initialize();
            }}
            onCancel={() => setShowInstall(false)}
          />
        ) : (
          <section
            aria-live="polite"
            className="animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] w-[min(100%,456px)] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
          >
            <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-soft text-amber">
              <Icon name="warning" size={22} />
            </span>
            <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
              Suna App
            </p>
            <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
              {status === "connecting"
                ? t("connect.connecting")
                : t("connect.title")}
            </h1>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {error || bridgeError?.message || t("connect.desc")}
            </p>
            <button
              className="mt-6 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-[12px] font-extrabold text-white shadow-[0_4px_12px_var(--color-blue-glow)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_7px_18px_var(--color-blue-glow)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={status === "connecting" || status === "disconnecting"}
              onClick={() => void initialize()}
              type="button"
            >
              {status === "connecting"
                ? t("connect.connectingBtn")
                : t("connect.button")}
            </button>
            <button
              className="mt-2.5 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line text-[12px] font-extrabold text-ink transition-colors duration-150 hover:bg-surface-raised"
              onClick={() => setShowInstall(true)}
              type="button"
            >
              <Icon name="download" size={14} />
              {t("install.title")}
            </button>
          </section>
        )}
      </main>
    );

  return (
    <main
      className={`animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] app-shell ${detailsOpen ? "" : "details-closed"}`}
    >
      <SessionSidebar
        connected={connected}
        onCreate={create}
        onRequestCreate={() => setCreateOpen(true)}
        onReconnect={() => void initialize()}
        runtimeVersion={hello?.runtime_version}
        onSelect={(id) => void attach(id).then(() => setMobileMenuOpen(false))}
        onJoinActive={(id) =>
          void attach(id, true).then(() => setMobileMenuOpen(false))
        }
        open={mobileMenuOpen}
        pendingId={syncing ? selectedId : undefined}
        disabled={syncing}
        selectedId={selectedId}
        sessions={sessions}
        onDetach={selectedId ? () => void detach() : undefined}
        onDelete={cap("session") ? (id) => void remove(id) : undefined}
        onRename={
          selected && cap("session") && !sessionActionsFrozen && !observer
            ? () => {
                setTitleDraft(selected.title ?? "");
                setEditingTitle(true);
              }
            : undefined
        }
        onClose={() => setMobileMenuOpen(false)}
      />
      {/* 移动端抽屉遮罩：常驻 DOM，is-visible 控制淡入淡出（CSS 过渡）。 */}
      <button
        aria-label={t("common.closeSidebar")}
        className={`mobile-scrim ${mobileMenuOpen ? "is-visible" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        tabIndex={mobileMenuOpen ? 0 : -1}
        type="button"
      />{" "}
      <section className="workspace">
        <SessionHeader
          canControl={canControl}
          detailsOpen={detailsOpen}
          handoffRole={handoffRole}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSettings={() => setSettingsOpen((value) => !value)}
          onStop={() =>
            void queueSessionOperation(() => rpc("agent.cancel", {}))
          }
          onToggleDetails={() => setDetailsOpen(!detailsOpen)}
          onToggleTheme={toggleTheme}
          resolvedTheme={resolvedTheme}
          running={running}
          selected={selected}
          syncing={syncing}
        />
        <SessionDialogs
          createOpen={createOpen}
          editingTitle={editingTitle}
          knownCwds={sessions.map((session) => session.cwd)}
          onCreate={(cwd, title) =>
            create(cwd, title).then(() => setCreateOpen(false))
          }
          onCreateOpenChange={setCreateOpen}
          onEditingTitleChange={setEditingTitle}
          onRename={() => void rename(titleDraft)}
          onTitleDraftChange={setTitleDraft}
          titleDraft={titleDraft}
        />
        <SessionStatusBars
          error={error}
          handoffRole={handoffRole}
          observer={observer}
          onCloseError={() => setError(undefined)}
          selected={selected}
        />
        {visibleWaiting.length > 0 && (
          <div className="relative z-30 flex items-center gap-2 border-b border-amber/25 bg-amber-soft/70 px-3 py-2">
            <Icon className="shrink-0 text-amber" name="warning" size={14} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink">
              {t("waiting.notice", { count: visibleWaiting.length })}
            </span>
            <button
              className="shrink-0 cursor-pointer rounded-md bg-surface-solid px-2 py-1 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:text-ink disabled:opacity-45"
              disabled={syncing}
              onClick={() => {
                const first = visibleWaiting[0];
                if (first) void attach(first.id);
              }}
              type="button"
            >
              {t("waiting.go")}
            </button>
            <button
              aria-label={t("waiting.dismiss")}
              className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
              onClick={() =>
                setDismissedWaiting((value) => {
                  const next = new Set(value);
                  for (const session of visibleWaiting) next.add(session.id);
                  return next;
                })
              }
              type="button"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        {settingsOpen && (
          <>
            <button
              aria-label={t("common.closeSettings")}
              className="settings-scrim"
              onClick={closeSettings}
              type="button"
            />
            <RuntimeSettings
              cap={cap}
              closing={settingsClosing}
              config={config}
              connected={connected}
              hello={hello}
              initialTab={settingsInitialTab}
              mcpServers={mcpServers}
              onClose={closeSettings}
              onConfig={setConfig}
              onReconnect={() => void initialize()}
              onThemeChange={setTheme}
              refreshMcp={() => void refreshMcp()}
              rpc={rpc}
              theme={theme}
            />
          </>
        )}
        {!selected || mobileTab === "overview" ? (
          <TaskOverview
            connected={connected}
            hasModels={Boolean(config && config.models.length > 0)}
            onCreate={() => setCreateOpen(true)}
            onOpenSettings={() => {
              setSettingsInitialTab("models");
              setSettingsOpen(true);
            }}
            onReconnect={() => void initialize()}
            onSelect={(id) => {
              setMobileTab("session");
              void attach(id);
            }}
            pendingId={syncing ? selectedId : undefined}
            selectedId={selectedId}
            sessions={sessions}
          />
        ) : (
          <>
            <ChatTimeline
              activeTool={active.activeTool}
              ask={active.ask}
              controlsDisabled={syncing || (running && !canControl)}
              guard={active.guard}
              loading={syncing}
              messages={messages}
              onAskReply={(id, answer) =>
                queueSessionOperation(() =>
                  rpc("agent.askReply", { id, answer }),
                ).then(() => undefined)
              }
              onGuardReply={(id, decision) =>
                queueSessionOperation(() =>
                  rpc("agent.guardReply", { id, decision }),
                ).then(() => undefined)
              }
              onSuggestion={
                // 只读模式（observer）下不引导输入：建议卡隐藏，避免填入后无法发送。
                observer
                  ? undefined
                  : (text) => composerRef.current?.fillDraft(text)
              }
              pending={
                active.pendingUsers.length > 0 || Boolean(active.awaitingRun)
              }
              phase={active.run?.phase ?? current?.phase}
              flow={active.flow}
              running={running}
              sessionId={active.snapshot?.session.id}
              toolSummary={active.toolSummary}
            />
            <Composer
              canAttachImageUrl={Boolean(hello?.content_sources.image_url)}
              canSteer={canSteer}
              disabled={sessionActionsFrozen || observer}
              maxSteering={maxSteering}
              onRemoveSteering={removeSteering}
              onSubmit={send}
              onSteer={steer}
              observer={observer}
              ref={composerRef}
              steering={steering}
              waiting={selected?.status === "waiting"}
            />
          </>
        )}
      </section>
      {/* 移动端底部导航：总览 / 任务 / 设置（设计 §12.2）。
          仅窄屏显示；桌面由侧栏 + Header 承担同等功能。 */}
      <nav aria-label={t("common.mainNav")} className="mobile-tabbar">
        <button
          aria-current={mobileTab === "overview" ? "page" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
          onClick={() => setMobileTab("overview")}
          type="button"
        >
          <Icon
            className={
              mobileTab === "overview" ? "text-blue-strong" : "text-ink-muted"
            }
            name="message"
            size={17}
          />
          {t("nav.overview")}
        </button>
        <button
          aria-current={
            mobileTab === "session" && selected ? "page" : undefined
          }
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
          disabled={!selected}
          onClick={() => setMobileTab("session")}
          type="button"
        >
          <Icon
            className={
              mobileTab === "session" && selected
                ? "text-blue-strong"
                : "text-ink-muted"
            }
            name="sparkle"
            size={17}
          />
          {t("nav.task")}
        </button>
        <button
          aria-current={mobileTab === "settings" ? "page" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150"
          onClick={() => {
            setMobileTab("settings");
            setSettingsOpen(true);
          }}
          type="button"
        >
          <Icon
            className={
              mobileTab === "settings" ? "text-blue-strong" : "text-ink-muted"
            }
            name="settings"
            size={17}
          />
          {t("nav.settings")}
        </button>
      </nav>
      <RunDetails
        ask={active.ask}
        canConfigure={canConfig && !sessionActionsFrozen}
        compact={active.compact}
        controlsDisabled={syncing || (running && !canControl)}
        config={config}
        guard={active.guard}
        modelRef={
          selected?.model_ref ??
          active.snapshot?.session.model_ref ??
          config?.active_model
        }
        onClose={() => setDetailsOpen(false)}
        onCompact={() =>
          sessionActionsFrozen
            ? Promise.resolve()
            : queueSessionOperation(() => rpc("session.compact", {})).then(
                () => undefined,
              )
        }
        onResume={
          active.run?.resume_available && canControl && !sessionActionsFrozen
            ? () =>
                queueSessionOperation(() => rpc("agent.resumeRun", {})).then(
                  () => undefined,
                )
            : undefined
        }
        onUpdateModel={updateModel}
        open={detailsOpen}
        phase={active.run?.phase ?? current?.phase}
        run={active.run}
        status={current?.status ?? selected?.status}
        totals={usage}
        usage={active.usage}
      />
      <CommandPalette
        canCompact={
          Boolean(selected) &&
          !sessionActionsFrozen &&
          !running &&
          selected?.status !== "compacting"
        }
        onClose={() => setCommandOpen(false)}
        onCompact={() =>
          queueSessionOperation(() => rpc("session.compact", {})).then(
            () => undefined,
          )
        }
        onCreateTask={() => {
          setCreateOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectSession={(id) => {
          setMobileTab("session");
          void attach(id);
        }}
        onStopTask={() =>
          queueSessionOperation(() => rpc("agent.cancel", {})).then(
            () => undefined,
          )
        }
        onToggleDetails={() => setDetailsOpen((value) => !value)}
        onToggleTheme={toggleTheme}
        open={commandOpen}
        running={running}
        selectedId={selectedId}
        sessions={sessions}
      />
    </main>
  );
}
