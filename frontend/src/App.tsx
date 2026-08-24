import { useEffect, useRef, useState } from "react";
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
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { useAppShell } from "./features/appShell/useAppShell";
import { LocaleProvider, useT } from "./lib/i18n";
import "./styles/tailwind.css";

/** 应用壳：语言由 LocaleProvider 提供，UI 状态在 useAppShell，会话状态在 useRuntimeSession。 */
export function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}

function AppShell() {
  const t = useT();
  const shell = useAppShell();
  const {
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
  } = shell;

  // 空状态建议卡 → 输入框填充草稿的桥。
  const composerRef = useRef<ComposerHandle>(null);
  // 会话删除确认：侧栏删除先弹 ConfirmDialog，确认后才调 remove。
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
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
  // 明确“未安装 Runtime”时自动进入引导安装（错误码来自 gateway 的
  // runtime_not_installed；其他 unavailable（如 daemon 启动失败）保持手动入口）。
  useEffect(() => {
    if (bridgeError?.code === "runtime_not_installed") {
      setShowInstall(true);
    }
  }, [bridgeError, setShowInstall]);
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
  const visibleWaiting = otherWaiting.filter(
    (session) => !dismissedWaiting.has(session.id),
  );
  // 操作类错误自动消失：8 秒后清除（连接错误走 bridgeError，不在此列）。
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [error, setError]);
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
        onDelete={cap("session") ? (id) => setPendingDeleteId(id) : undefined}
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
              hasModels={Boolean(config && config.models.length > 0)}
              onOpenSettings={() => {
                setSettingsInitialTab("models");
                setSettingsOpen(true);
              }}
            />
            <Composer
              canAttachImageUrl={Boolean(hello?.content_sources.image_url)}
              canSteer={canSteer}
              disabled={sessionActionsFrozen || observer}
              hasModels={Boolean(config && config.models.length > 0)}
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
          aria-current={mobileTab === "session" ? "page" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
          onClick={() => setMobileTab("session")}
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
          onClick={() => {
            // 设置是 Dialog 而非 tab 内容：点击直接打开面板（移动端入口）。
            setSettingsOpen(true);
          }}
          type="button"
        >
          <Icon className="text-ink-muted" name="settings" size={17} />
          {t("nav.settings")}
        </button>
      </nav>
      <RunDetails
        ask={active.ask}
        canConfigure={canConfig}
        compact={active.compact}
        config={config}
        controlsDisabled={syncing || (running && !canControl)}
        guard={active.guard}
        modelRef={selected?.model_ref}
        onClose={() => setDetailsOpen(false)}
        onCompact={() =>
          queueSessionOperation(() => rpc("session.compact", {})).then(
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
        onUpdateModel={(model) => updateModel(model)}
        open={detailsOpen}
        phase={active.run?.phase ?? current?.phase}
        run={active.run}
        status={selected?.status}
        toolSummary={active.toolSummary}
        totals={usage}
        usage={active.usage}
      />
      <CommandPalette
        canCompact={Boolean(selected && !syncing)}
        onClose={() => setCommandOpen(false)}
        onCompact={() =>
          void queueSessionOperation(() => rpc("session.compact", {}))
        }
        onCreateTask={() => {
          setCommandOpen(false);
          setCreateOpen(true);
        }}
        onOpenSettings={() => {
          setCommandOpen(false);
          setSettingsOpen(true);
        }}
        onSelectSession={(id) => {
          setCommandOpen(false);
          void attach(id);
        }}
        onStopTask={() => {
          setCommandOpen(false);
          void queueSessionOperation(() => rpc("agent.cancel", {}));
        }}
        onToggleDetails={() => {
          setCommandOpen(false);
          setDetailsOpen((value) => !value);
        }}
        onToggleTheme={() => {
          setCommandOpen(false);
          toggleTheme();
        }}
        open={commandOpen}
        running={running}
        selectedId={selectedId}
        sessions={sessions}
      />
      <ConfirmDialog
        busy={syncing}
        confirmLabel={t("action.deleteConfirmButton")}
        danger
        description={t("action.deleteDescription")}
        onConfirm={() => {
          if (pendingDeleteId) void remove(pendingDeleteId);
          setPendingDeleteId(undefined);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(undefined);
        }}
        open={Boolean(pendingDeleteId)}
        title={t("action.deleteConfirm")}
      />
    </main>
  );
}
