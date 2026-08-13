import { useCallback, useEffect, useState } from "react";
import { Icon } from "./components/Icon";
import { ChatTimeline } from "./features/chat/ChatTimeline";
import { Composer } from "./features/chat/Composer";
import { RunDetails } from "./features/run/RunDetails";
import { useRuntimeSession } from "./features/runtime/useRuntimeSession";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { SessionHeader } from "./features/sessions/SessionHeader";
import { SessionStatusBars } from "./features/sessions/SessionStatusBars";
import { SessionDialogs } from "./features/sessions/SessionDialogs";
import { TaskOverview } from "./features/overview/TaskOverview";
import { RuntimeSettings } from "./features/settings/RuntimeSettings";
import type { Theme } from "./lib/models";
import "./styles/tailwind.css";

/** 应用壳：主题与 UI 状态 + 会话工作区组合。 */
export function App() {
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
  // 主题切换：同步写入 data-theme 并更新偏好，不依赖 View Transition 等
  // 浏览器 API 的兼容性，保证在任何浏览器下都立即生效。
  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
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
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [composerFocus, setComposerFocus] = useState(0);
  // Cmd/Ctrl+K 聚焦输入框：桌面快速开始输入。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setComposerFocus((value) => value + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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
    mcpServers,
    refreshMcp,
  } = session;
  const sessionActionsFrozen = syncing || !selectedId;
  const current = active.snapshot?.current_run;

  if (!connected)
    return (
      <main className="grid min-h-dvh place-items-center p-6">
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
            {status === "connecting" ? "正在连接你的工作空间" : "连接 Runtime"}
          </h1>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {error ||
              bridgeError?.message ||
              "通过本地 Gateway 连接 Suna Runtime。"}
          </p>
          <button
            className="mt-6 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-[12px] font-extrabold text-white shadow-[0_4px_12px_var(--color-blue-glow)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_7px_18px_var(--color-blue-glow)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status === "connecting" || status === "disconnecting"}
            onClick={() => void initialize()}
            type="button"
          >
            {status === "connecting" ? "正在连接…" : "连接 Runtime"}
          </button>
        </section>
      </main>
    );

  return (
    <main
      className={`animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] app-shell ${detailsOpen ? "" : "details-closed"}`}
    >
      <SessionSidebar
        connected={connected}
        onCreate={create}
        onReconnect={() => void initialize()}
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
      {mobileMenuOpen && (
        <button
          aria-label="关闭会话列表"
          className="mobile-scrim"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      )}
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
        {settingsOpen && (
          <>
            <button
              aria-label="关闭设置"
              className="settings-scrim"
              onClick={() => setSettingsOpen(false)}
              type="button"
            />
            <RuntimeSettings
              cap={cap}
              config={config}
              mcpServers={mcpServers}
              onClose={() => setSettingsOpen(false)}
              onConfig={setConfig}
              onThemeChange={setTheme}
              refreshMcp={() => void refreshMcp()}
              rpc={rpc}
              theme={theme}
            />
          </>
        )}
        {!selected ? (
          <TaskOverview
            connected={connected}
            onCreate={() => setCreateOpen(true)}
            onReconnect={() => void initialize()}
            onSelect={(id) => void attach(id)}
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
              pending={active.pendingUsers.length > 0}
              phase={active.run?.phase ?? current?.phase}
              flow={active.flow}
              running={running}
              sessionId={active.snapshot?.session.id}
              toolSummary={active.toolSummary}
            />
            <Composer
              canAttachImageUrl={Boolean(hello?.content_sources.url)}
              disabled={sessionActionsFrozen || observer}
              focusTrigger={composerFocus}
              onSubmit={send}
              observer={observer}
              waiting={selected?.status === "waiting"}
            />
          </>
        )}
      </section>
      <RunDetails
        ask={active.ask}
        canConfigure={canConfig && !sessionActionsFrozen}
        controlsDisabled={syncing || (running && !canControl)}
        config={config}
        guard={active.guard}
        modelRef={
          selected?.model_ref ??
          active.snapshot?.session.model_ref ??
          config?.active_model
        }
        onAskReply={(id, answer) =>
          queueSessionOperation(() =>
            rpc("agent.askReply", { id, answer }),
          ).then(() => undefined)
        }
        onClose={() => setDetailsOpen(false)}
        onCompact={() =>
          sessionActionsFrozen
            ? Promise.resolve()
            : queueSessionOperation(() => rpc("session.compact", {})).then(
                () => undefined,
              )
        }
        onGuardReply={(id, decision) =>
          queueSessionOperation(() =>
            rpc("agent.guardReply", { id, decision }),
          ).then(() => undefined)
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
    </main>
  );
}
