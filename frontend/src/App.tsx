import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconButton } from "./components/Icon";
import { ChatTimeline } from "./features/chat/ChatTimeline";
import { Composer } from "./features/chat/Composer";
import { RunDetails } from "./features/run/RunDetails";
import { RuntimeStatusBadge } from "./features/runtime/RuntimeStatusPanel";
import { useRuntimeBridge } from "./features/runtime/useRuntimeBridge";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import type { Theme } from "./lib/models";
import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
  GuardConfirmEvent,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
  SessionSnapshot,
  ToolSummary,
  ToolStartEvent,
  UsagePeriod,
  MessagePart,
  MemoryItem,
  MCPServerInfo,
  SkillInfo,
} from "./lib/runtimeBridge";
import "./styles/app.css";

type PendingUserMessage = { id: string; content: string };
type ActiveData = {
  snapshot?: SessionSnapshot;
  assistant: string;
  reasoning: string;
  usage?: AgentUsageEvent;
  run?: AgentRunEvent;
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  toolSummary?: ToolSummary;
  activeTool?: ToolStartEvent & { status?: "running" | "guard" | "failed" };
  pendingUsers: PendingUserMessage[];
};
const blankActive = (): ActiveData => ({
  assistant: "",
  reasoning: "",
  pendingUsers: [],
});

function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("suna-theme");
    return saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  });
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [active, setActive] = useState<ActiveData>(blankActive);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<UsagePeriod>();
  const [config, setConfig] = useState<RuntimeConfig>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const selectedIdRef = useRef<string | undefined>(undefined);
  const restoreRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const attachIntentRef = useRef(0);
  const restoreIntentRef = useRef(0);
  const listIntentRef = useRef(0);
  const sessionsRevisionRef = useRef(0);
  const attachQueueRef = useRef(Promise.resolve());
  const syncingRef = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const scopeRef = useRef<
    { attach: number; sessionId: string; runId?: string } | undefined
  >(undefined);
  const deltaRef = useRef({
    assistant: "",
    reasoning: "",
    scope: undefined as
      { attach: number; sessionId: string; runId?: string } | undefined,
  });
  const deltaFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const setSyncBoundary = useCallback((value: boolean) => {
    syncingRef.current = value;
    setSyncing(value);
  }, []);
  const resetQueuedDeltas = useCallback(() => {
    if (deltaFrameRef.current !== undefined)
      cancelAnimationFrame(deltaFrameRef.current);
    deltaFrameRef.current = undefined;
    deltaRef.current = { assistant: "", reasoning: "", scope: undefined };
  }, []);
  const flushDeltas = useCallback(() => {
    deltaFrameRef.current = undefined;
    const pending = deltaRef.current;
    deltaRef.current = { assistant: "", reasoning: "", scope: undefined };
    const scope = scopeRef.current;
    if (
      (!pending.assistant && !pending.reasoning) ||
      syncingRef.current ||
      !scope ||
      !pending.scope ||
      scope.attach !== pending.scope.attach ||
      scope.sessionId !== pending.scope.sessionId ||
      scope.runId !== pending.scope.runId
    )
      return;
    setActive((value) => ({
      ...value,
      assistant: value.assistant + pending.assistant,
      reasoning: value.reasoning + pending.reasoning,
    }));
  }, []);
  const queueDelta = useCallback(
    (kind: "assistant" | "reasoning", content: string, runId?: string) => {
      const scope = scopeRef.current;
      // agent.delta has no session ID. A bridge is attached to only one Runtime
      // session, so the first run ID after a send can establish its active scope.
      // Subsequent deltas must still match that authoritative scope.
      if (syncingRef.current || !scope || !runId) return;
      if (scope.runId && scope.runId !== runId) return;
      if (!scope.runId) scopeRef.current = { ...scope, runId };
      if (
        deltaRef.current.scope &&
        deltaRef.current.scope.attach !== scope.attach
      )
        resetQueuedDeltas();
      deltaRef.current.scope = { ...scope };
      deltaRef.current[kind] += content;
      if (deltaFrameRef.current === undefined)
        deltaFrameRef.current = requestAnimationFrame(flushDeltas);
    },
    [flushDeltas, resetQueuedDeltas],
  );
  useEffect(
    () => () => {
      resetQueuedDeltas();
    },
    [resetQueuedDeltas],
  );

  const mergeSession = useCallback((session: SessionInfo) => {
    sessionsRevisionRef.current++;
    setSessions((list) => {
      const found = list.some((item) => item.id === session.id);
      return (
        found
          ? list.map((item) => (item.id === session.id ? session : item))
          : [session, ...list]
      ).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    });
  }, []);
  const acceptsSession = useCallback((sessionId?: string) => {
    const scope = scopeRef.current;
    return Boolean(
      !syncingRef.current && sessionId && scope?.sessionId === sessionId,
    );
  }, []);
  const acceptsRun = useCallback((runId?: string) => {
    const scope = scopeRef.current;
    return Boolean(!syncingRef.current && runId && scope?.runId === runId);
  }, []);
  const onNotification = useCallback(
    (event: RuntimeNotification) => {
      if (event.method === "session.updated") {
        mergeSession(event.params.session);
        if (acceptsSession(event.params.session.id))
          setActive((value) =>
            value.snapshot?.session.id === event.params.session.id
              ? {
                  ...value,
                  snapshot: {
                    ...value.snapshot,
                    session: event.params.session,
                  },
                }
              : value,
          );
        return;
      }
      if (event.method === "config.state") {
        setConfig(event.params);
        return;
      }
      if (event.method === "agent.delta") {
        queueDelta(
          event.params.kind,
          event.params.content,
          event.params.run_id,
        );
        return;
      }
      if (event.method === "agent.run") {
        if (!acceptsRun(event.params.run_id)) return;
        setActive((value) => {
          const next: ActiveData = {
            ...value,
            run: event.params,
            snapshot: value.snapshot
              ? {
                  ...value.snapshot,
                  current_run: {
                    run_id: event.params.run_id,
                    status:
                      event.params.state === "done" ||
                      event.params.state === "cancelled" ||
                      event.params.state === "failed"
                        ? "idle"
                        : event.params.state === "retrying"
                          ? "running"
                          : "running",
                    phase: event.params.phase,
                    can_control: event.params.can_control,
                  },
                }
              : value.snapshot,
          };
          // The protocol does not emit a separate completed-assistant message.
          // Keep the streamed result visible until the next authoritative attach.
          if (
            event.params.state === "done" &&
            value.assistant &&
            value.snapshot
          ) {
            next.snapshot = {
              ...next.snapshot!,
              messages: [
                ...(value.snapshot.messages ?? []),
                { role: "assistant", content: value.assistant },
              ],
            };
            next.assistant = "";
            next.reasoning = "";
          }
          return next;
        });
        return;
      }
      if (event.method === "agent.usage") {
        if (!acceptsRun(event.params.run_id)) return;
        setActive((value) => ({ ...value, usage: event.params }));
        return;
      }
      if (event.method === "agent.tool_start") {
        const scope = scopeRef.current;
        if (
          syncingRef.current ||
          !scope ||
          scope.sessionId !== selectedIdRef.current
        )
          return;
        setActive((value) => ({
          ...value,
          activeTool: { ...event.params, status: "running" },
        }));
        return;
      }
      if (event.method === "agent.tool_guard") {
        setActive((value) =>
          value.activeTool?.id === event.params.tool_call_id
            ? { ...value, activeTool: { ...value.activeTool, status: "guard" } }
            : value,
        );
        return;
      }
      if (event.method === "agent.tool_end") {
        setActive((value) =>
          value.activeTool?.id === event.params.id
            ? {
                ...value,
                activeTool: {
                  ...value.activeTool,
                  status: event.params.error ? "failed" : undefined,
                },
              }
            : value,
        );
        return;
      }
      if (event.method === "agent.ask_user") {
        if (!acceptsSession(event.params.session_id)) return;
        setActive((value) => ({ ...value, ask: event.params }));
        return;
      }
      if (event.method === "agent.guard_confirm") {
        if (!acceptsSession(event.params.session_id)) return;
        setActive((value) => ({ ...value, guard: event.params }));
        return;
      }
      if (event.method === "agent.interaction_resolved") {
        if (!acceptsSession(event.params.session_id)) return;
        setActive((value) => ({
          ...value,
          ask: value.ask?.id === event.params.id ? undefined : value.ask,
          guard: value.guard?.id === event.params.id ? undefined : value.guard,
          activeTool:
            value.activeTool?.id === event.params.id
              ? { ...value.activeTool, status: undefined }
              : value.activeTool,
        }));
        return;
      }
      if (event.method === "session.user_message") {
        if (!acceptsSession(event.params.session_id)) return;
        const content = event.params.parts
          ?.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        if (!content) return;
        setActive((value) => {
          const pendingIndex = value.pendingUsers.findIndex(
            (item) => item.content === content,
          );
          return {
            ...value,
            pendingUsers:
              pendingIndex < 0
                ? value.pendingUsers
                : value.pendingUsers.filter(
                    (_, index) => index !== pendingIndex,
                  ),
            snapshot: value.snapshot
              ? {
                  ...value.snapshot,
                  messages: [
                    ...(value.snapshot.messages ?? []),
                    { role: "user", content },
                  ],
                }
              : value.snapshot,
          };
        });
        return;
      }
    },
    [acceptsRun, acceptsSession, mergeSession, queueDelta],
  );
  const onEventError = useCallback(
    (reason: Error) => setError(reason.message),
    [],
  );
  const onReconnected = useCallback(
    () => restoreRef.current?.() ?? Promise.resolve(),
    [],
  );
  const bridge = useRuntimeBridge({
    onNotification,
    onEventError,
    onReconnected,
  });
  const {
    connect,
    disconnect,
    rpc,
    connected,
    hello,
    status,
    error: bridgeError,
  } = bridge;
  const cap = useCallback(
    (name: string) =>
      Boolean(
        hello?.capabilities[name] ||
        hello?.capabilities[`${name}.get`] ||
        hello?.capabilities[`${name}.list`],
      ),
    [hello],
  );
  const queueSessionOperation = useCallback(
    <T,>(operation: () => Promise<T>) => {
      const work = attachQueueRef.current.then(operation);
      // A rejected operation must never break the per-bridge serialization chain.
      attachQueueRef.current = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
    [],
  );
  const activeScopeMatches = useCallback(
    (scope: NonNullable<typeof scopeRef.current>) => {
      const currentScope = scopeRef.current;
      return Boolean(
        !syncingRef.current &&
        currentScope &&
        currentScope.attach === scope.attach &&
        currentScope.sessionId === scope.sessionId &&
        currentScope.runId === scope.runId,
      );
    },
    [],
  );
  const loadSessions = useCallback(async () => {
    const request = ++listIntentRef.current;
    const revision = sessionsRevisionRef.current;
    const result = await rpc("session.list", {});
    const sorted = [...result.sessions].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    // A point-in-time list must not erase newer session.updated/create state.
    if (
      request === listIntentRef.current &&
      revision === sessionsRevisionRef.current
    )
      setSessions(sorted);
    return sorted;
  }, [rpc]);
  const attach = useCallback(
    (id: string, requireActive = false) => {
      const intent = ++attachIntentRef.current;
      resetQueuedDeltas();
      scopeRef.current = undefined;
      setSyncBoundary(true);
      setError(undefined);
      setSelectedId(id);
      setActive(blankActive());
      const work = queueSessionOperation(async () => {
        if (intent !== attachIntentRef.current) return;
        const snapshot = await rpc("session.attach", {
          session_id: id,
          ...(requireActive ? { require_active: true } : {}),
        });
        // A stale attach changed Runtime's current attachment. Put the last
        // requested session back before releasing the serialized queue.
        if (intent !== attachIntentRef.current) return;
        scopeRef.current = {
          attach: intent,
          sessionId: id,
          runId: snapshot.current_run?.run_id,
        };
        setSelectedId(id);
        setActive({
          snapshot,
          assistant: snapshot.current_run?.assistant_buffer ?? "",
          reasoning: snapshot.current_run?.reasoning_buffer ?? "",
          toolSummary: snapshot.tool_summary,
          pendingUsers: [],
        });
        mergeSession(snapshot.session);
      });
      return work
        .catch((reason) => {
          if (intent === attachIntentRef.current) {
            // Never leave a selected-looking session without an authoritative
            // Runtime attachment. The user can choose it again after the error.
            scopeRef.current = undefined;
            setSelectedId(undefined);
            setActive(blankActive());
            setError(
              reason instanceof Error ? reason.message : "无法附加会话。",
            );
          }
          throw reason;
        })
        .finally(() => {
          if (intent === attachIntentRef.current) setSyncBoundary(false);
        });
    },
    [
      mergeSession,
      queueSessionOperation,
      resetQueuedDeltas,
      rpc,
      setSyncBoundary,
    ],
  );
  const restore = useCallback(async () => {
    const restoreIntent = ++restoreIntentRef.current;
    const attachIntent = attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      const list = await loadSessions();
      if (
        restoreIntent !== restoreIntentRef.current ||
        attachIntent !== attachIntentRef.current
      )
        return;
      // A reconnected bridge has no attachment. Restore only an authoritative
      // Runtime snapshot; local state is never replayed.
      const target =
        selectedIdRef.current &&
        list.some((item) => item.id === selectedIdRef.current)
          ? selectedIdRef.current
          : list[0]?.id;
      if (target) await attach(target);
      else {
        setSelectedId(undefined);
        setActive(blankActive());
      }
    } finally {
      if (
        restoreIntent === restoreIntentRef.current &&
        attachIntent === attachIntentRef.current
      )
        setSyncBoundary(false);
    }
  }, [attach, loadSessions, resetQueuedDeltas, setSyncBoundary]);
  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);
  const initialize = useCallback(async () => {
    try {
      setError(undefined);
      await connect();
      await restore();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法连接 Runtime。");
    }
  }, [connect, restore]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!connected) return;
    void rpc("session.usage", {})
      .then((value) => setUsage(value.today))
      .catch(() => undefined);
    if (cap("config"))
      void rpc("config.get", {})
        .then(setConfig)
        .catch(() => undefined);
  }, [cap, connected, rpc]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("suna-theme", theme);
  }, [theme]);

  const selected = useMemo(
    () =>
      sessions.find((item) => item.id === selectedId) ??
      active.snapshot?.session,
    [active.snapshot, selectedId, sessions],
  );
  const messages = useMemo(
    () => [
      ...(active.snapshot?.messages ?? []),
      ...active.pendingUsers.map(({ content }) => ({ role: "user", content })),
    ],
    [active.pendingUsers, active.snapshot?.messages],
  );
  const canDelete = cap("session.delete");
  const canConfig = cap("config");
  const current = active.snapshot?.current_run;
  const running =
    active.run?.state === "running" ||
    active.run?.state === "retrying" ||
    current?.status === "running" ||
    selected?.status === "running";
  const canControl = Boolean(active.run?.can_control ?? current?.can_control);
  // can_control is meaningful only while a run is active. Idle attached clients
  // can start turns and edit/detach; Runtime remains the busy-operation arbiter.
  const observer = Boolean(running && !syncing && !canControl);
  const sessionActionsFrozen = syncing || !selectedId || !scopeRef.current;

  async function create(cwd: string, title?: string) {
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        const snapshot = await rpc("session.create", { cwd, title });
        if (intent !== attachIntentRef.current) return;
        scopeRef.current = {
          attach: intent,
          sessionId: snapshot.session.id,
          runId: snapshot.current_run?.run_id,
        };
        setSelectedId(snapshot.session.id);
        setActive({
          snapshot,
          assistant: "",
          reasoning: "",
          toolSummary: snapshot.tool_summary,
          pendingUsers: [],
        });
        mergeSession(snapshot.session);
      });
    } catch (reason) {
      if (intent === attachIntentRef.current)
        setError(reason instanceof Error ? reason.message : "无法创建会话。");
      throw reason;
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }
  async function send(parts: MessagePart[]) {
    if (sessionActionsFrozen) return;
    const scope = scopeRef.current;
    if (!scope || scope.sessionId !== selectedId) return;
    const id = messageId();
    const content =
      parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") || "[图片]";
    setActive((value) => ({
      ...value,
      assistant: "",
      reasoning: "",
      pendingUsers: [...value.pendingUsers, { id, content }],
    }));
    try {
      await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope)) throw new Error("会话已切换。");
        await rpc("agent.sendMessage", { client_msg_id: id, parts });
        // Idle attachments have no run_id. Reattach immediately after accepted
        // send so subsequent run-only events have an authoritative scope.
        const snapshot = await rpc("session.attach", {
          session_id: scope.sessionId,
        });
        if (!activeScopeMatches(scope)) return;
        scopeRef.current = {
          ...scope,
          runId: snapshot.current_run?.run_id,
        };
        setActive((value) => ({
          ...value,
          snapshot: {
            ...snapshot,
            messages: value.snapshot?.messages ?? snapshot.messages,
          },
          assistant: snapshot.current_run?.assistant_buffer ?? "",
          reasoning: snapshot.current_run?.reasoning_buffer ?? "",
          // The preceding run belongs to the pre-send snapshot. Let the new
          // authoritative current_run (and subsequent agent.run) decide control.
          run: undefined,
          toolSummary: snapshot.tool_summary ?? value.toolSummary,
        }));
        mergeSession(snapshot.session);
      });
    } catch (reason) {
      setActive((value) => ({
        ...value,
        pendingUsers: value.pendingUsers.filter((item) => item.id !== id),
      }));
      throw reason;
    }
  }
  async function updateModel(model_ref: string) {
    const scope = scopeRef.current;
    if (!scope || sessionActionsFrozen) return;
    const snapshot = await queueSessionOperation(async () => {
      if (!activeScopeMatches(scope)) throw new Error("会话已切换。");
      return rpc("session.update", { session_id: scope.sessionId, model_ref });
    });
    if (!activeScopeMatches(scope)) return;
    setActive((value) => ({
      ...value,
      snapshot: {
        ...snapshot,
        messages: value.snapshot?.messages ?? snapshot.messages,
      },
      toolSummary: snapshot.tool_summary ?? value.toolSummary,
    }));
    mergeSession(snapshot.session);
    await loadSessions();
  }
  async function rename() {
    const scope = scopeRef.current;
    if (!scope || sessionActionsFrozen) return;
    try {
      const snapshot = await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope)) throw new Error("会话已切换。");
        return rpc("session.update", {
          session_id: scope.sessionId,
          title: titleDraft.trim() || null,
        });
      });
      // A session.update response is only valid for the exact attachment that
      // issued it; a later handoff must never repaint its snapshot.
      if (!activeScopeMatches(scope)) return;
      setActive((value) => ({ ...value, snapshot }));
      mergeSession(snapshot.session);
      await loadSessions();
      setEditingTitle(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法更新会话标题。");
    }
  }
  async function detach() {
    if (syncing) return;
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        await rpc("session.detach", {});
        if (intent !== attachIntentRef.current) return;
        setSelectedId(undefined);
        setActive(blankActive());
      });
    } catch (reason) {
      if (intent === attachIntentRef.current)
        setError(reason instanceof Error ? reason.message : "无法分离会话。");
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }
  async function remove() {
    if (syncing || !selectedId || !canDelete) return;
    if (!window.confirm("删除此会话？此操作无法撤销。")) return;
    const id = selectedId;
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        // Runtime rejects deletion of its current attachment. Detach first in
        // the same queue, then delete; a later attach intent remains queued.
        await rpc("session.detach", {});
        await rpc("session.delete", { session_id: id });
        if (intent !== attachIntentRef.current) return;
        setSelectedId(undefined);
        setActive(blankActive());
        const list = await loadSessions();
        if (intent !== attachIntentRef.current) return;
        if (list[0]) {
          const snapshot = await rpc("session.attach", {
            session_id: list[0].id,
          });
          if (intent !== attachIntentRef.current) return;
          scopeRef.current = {
            attach: intent,
            sessionId: snapshot.session.id,
            runId: snapshot.current_run?.run_id,
          };
          setSelectedId(snapshot.session.id);
          setActive({
            snapshot,
            assistant: snapshot.current_run?.assistant_buffer ?? "",
            reasoning: snapshot.current_run?.reasoning_buffer ?? "",
            toolSummary: snapshot.tool_summary,
            pendingUsers: [],
          });
          mergeSession(snapshot.session);
        }
      });
    } catch (reason) {
      if (intent === attachIntentRef.current)
        setError(reason instanceof Error ? reason.message : "无法删除会话。");
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }

  if (!connected)
    return (
      <main className="runtime-gate">
        <section aria-live="polite" className="runtime-card runtime-error">
          <span className="runtime-warning">
            <Icon name="warning" size={22} />
          </span>
          <p className="eyebrow">Suna App</p>
          <h1>
            {status === "connecting" ? "正在连接你的工作空间" : "连接 Runtime"}
          </h1>
          <p>
            {error ||
              bridgeError?.message ||
              "通过本地 Gateway 连接 Suna Runtime。"}
          </p>
          <button
            className="runtime-retry"
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
    <main className={`app-shell ${detailsOpen ? "" : "details-closed"}`}>
      <SessionSidebar
        connected={connected}
        onCreate={create}
        onDisconnect={() =>
          void disconnect().catch((reason) =>
            setError(
              reason instanceof Error ? reason.message : "无法断开 Runtime。",
            ),
          )
        }
        onSelect={(id) =>
          void attach(id)
            .then(() => setMobileMenuOpen(false))
            .catch((reason) =>
              setError(
                reason instanceof Error ? reason.message : "无法附加会话。",
              ),
            )
        }
        onJoinActive={(id) =>
          void attach(id, true)
            .then(() => setMobileMenuOpen(false))
            .catch((reason) =>
              setError(
                reason instanceof Error ? reason.message : "无法附加会话。",
              ),
            )
        }
        open={mobileMenuOpen}
        pendingId={syncing ? selectedId : undefined}
        disabled={syncing}
        selectedId={selectedId}
        sessions={sessions}
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
        <header className="topbar">
          <div className="title-group">
            <IconButton
              className="mobile-only"
              label="打开会话列表"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Icon name="message" />
            </IconButton>
            <div>
              <div className="title-line">
                <h1>{selected?.title || "选择或创建一个会话"}</h1>
                {selected && cap("session.update") && (
                  <button
                    className="title-edit"
                    disabled={sessionActionsFrozen}
                    onClick={() => {
                      setTitleDraft(selected.title ?? "");
                      setEditingTitle(true);
                    }}
                    type="button"
                  >
                    重命名
                  </button>
                )}
                {selected && (
                  <span aria-live="polite" className="live-label">
                    <span />
                    {selected.status === "running"
                      ? "运行中"
                      : selected.status === "waiting"
                        ? "等待回答"
                        : "空闲"}
                  </span>
                )}
                <RuntimeStatusBadge
                  protocolVersion={hello?.protocol_version ?? "—"}
                />
              </div>
              <p>{selected?.cwd || "你的本地 Runtime 工作空间"}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <IconButton
              label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </IconButton>
            <IconButton
              label="Runtime 设置"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Icon name="ellipsis" />
            </IconButton>
            {selectedId && cap("session.detach") && (
              <button
                className="icon-button"
                disabled={sessionActionsFrozen}
                onClick={() => void detach()}
                type="button"
              >
                分离
              </button>
            )}
            {canDelete && selectedId && (
              <button
                className="icon-button"
                disabled={sessionActionsFrozen}
                onClick={() => void remove()}
                type="button"
              >
                删除
              </button>
            )}
            {running && canControl && !syncing && (
              <button
                className="stop-button"
                onClick={() =>
                  void queueSessionOperation(() => rpc("agent.cancel", {}))
                }
                type="button"
              >
                <Icon name="pause" size={15} />
                停止
              </button>
            )}
            <IconButton
              ariaControls="run-details"
              ariaExpanded={detailsOpen}
              className="desktop-hide details-toggle"
              label={detailsOpen ? "关闭任务详情" : "打开任务详情"}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              <Icon name="panel" />
            </IconButton>
          </div>
        </header>
        {editingTitle && (
          <div
            aria-labelledby="rename-session-title"
            aria-modal="true"
            className="dialog-scrim"
            role="dialog"
          >
            <form
              className="runtime-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <h2 id="rename-session-title">重命名会话</h2>
              <label>
                会话标题
                <input
                  autoFocus
                  onChange={(event) => setTitleDraft(event.target.value)}
                  value={titleDraft}
                />
              </label>
              <p>留空可恢复为未命名会话。</p>
              <div className="dialog-actions">
                <button onClick={() => setEditingTitle(false)} type="button">
                  取消
                </button>
                <button className="runtime-retry" type="submit">
                  保存
                </button>
              </div>
            </form>
          </div>
        )}
        {syncing && (
          <div aria-live="polite" className="bridge-sync">
            正在切换会话，等待 Runtime 确认…
          </div>
        )}
        {observer && (
          <div aria-live="polite" className="bridge-error">
            当前会话仅查看；控制权由其他客户端持有。
          </div>
        )}
        {error && (
          <div className="bridge-error" role="alert">
            {error}
            <button onClick={() => setError(undefined)} type="button">
              关闭
            </button>
          </div>
        )}
        {settingsOpen && (
          <RuntimeSettings
            cap={cap}
            config={config}
            rpc={rpc}
            onClose={() => setSettingsOpen(false)}
            onConfig={setConfig}
          />
        )}
        <ChatTimeline
          activeTool={active.activeTool}
          assistantBuffer={active.assistant}
          messages={messages}
          pending={active.pendingUsers.length > 0}
          phase={active.run?.phase ?? current?.phase}
          reasoningBuffer={active.reasoning}
          running={running}
          sessionId={active.snapshot?.session.id}
        />
        <Composer
          disabled={sessionActionsFrozen}
          canAttachImageUrl={Boolean(hello?.content_sources.url)}
          onSubmit={send}
          waiting={selected?.status === "waiting"}
        />
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
        toolSummary={active.toolSummary}
        totals={usage}
        usage={active.usage}
      />
    </main>
  );
}

type SettingsProps = {
  cap: (name: string) => boolean;
  config?: RuntimeConfig;
  onConfig: (config: RuntimeConfig) => void;
  onClose: () => void;
  rpc: ReturnType<typeof useRuntimeBridge>["rpc"];
};
function RuntimeSettings({
  cap,
  config,
  onConfig,
  onClose,
  rpc,
}: SettingsProps) {
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcp, setMcp] = useState<MCPServerInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      if (cap("memory")) setMemory((await rpc("memory.list", {})).memories);
      if (cap("skill")) setSkills((await rpc("skill.list", {})).skills);
      if (cap("mcp")) setMcp((await rpc("mcp.list", {})).servers);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载设置。");
    }
  }, [cap, rpc]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section aria-label="Runtime 设置" className="runtime-settings">
      <div className="details-header">
        <div>
          <p className="eyebrow">能力设置</p>
          <h2>Runtime 设置</h2>
        </div>
        <IconButton label="关闭设置" onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </div>
      {error && <p className="form-error">{error}</p>}
      {cap("config") && config && (
        <label>
          默认模型
          <select
            onChange={(event) =>
              void rpc("config.set", {
                action: "activate_model",
                active_model: event.target.value,
              }).then(onConfig)
            }
            value={config.active_model}
          >
            {config.models.map((model) => {
              const ref = `${model.provider}/${model.model}`;
              return (
                <option key={ref} value={ref}>
                  {ref}
                </option>
              );
            })}
          </select>
        </label>
      )}
      {cap("memory") && (
        <div>
          <div className="section-heading">
            <h3>记忆</h3>
            {memory.length > 0 && (
              <button
                className="text-action danger"
                onClick={() => {
                  if (window.confirm("清除所有记忆？此操作无法撤销。"))
                    void rpc("memory.clear", {}).then(() => load());
                }}
                type="button"
              >
                清空全部
              </button>
            )}
          </div>
          {memory.length ? (
            memory.map((item) => (
              <div className="setting-item" key={item.id}>
                <span>
                  <strong>{item.content}</strong>
                  <small>
                    {item.kind} · 优先级 {item.priority}
                  </small>
                </span>
                <button
                  className="text-action danger"
                  onClick={() => {
                    if (window.confirm("删除这条记忆？"))
                      void rpc("memory.delete", { id: item.id }).then(() =>
                        load(),
                      );
                  }}
                  type="button"
                >
                  删除
                </button>
              </div>
            ))
          ) : (
            <p>没有可用记忆。</p>
          )}
        </div>
      )}
      {cap("skill") && (
        <div>
          <h3>技能</h3>
          {skills.map((skill) => (
            <label className="setting-item" key={skill.name}>
              <span>
                {skill.name}
                <small>{skill.description}</small>
              </span>
              <input
                checked={skill.enabled}
                onChange={(event) =>
                  void rpc("skill.set", {
                    name: skill.name,
                    enabled: event.target.checked,
                  }).then(() => load())
                }
                type="checkbox"
              />
            </label>
          ))}
        </div>
      )}
      {cap("mcp") && (
        <div>
          <h3>MCP 服务</h3>
          {mcp.map((server) => (
            <div className="setting-item" key={server.name}>
              <span>
                <strong>{server.name}</strong>
                <small>
                  {server.transport ? `${server.transport} · ` : ""}
                  {server.tool_count} 个工具
                </small>
              </span>
              <span className="row-actions">
                <button
                  className="text-action"
                  onClick={() =>
                    void rpc("mcp.reload", { name: server.name }).then(() =>
                      load(),
                    )
                  }
                  type="button"
                >
                  重载
                </button>
                <input
                  checked={server.active}
                  onChange={(event) =>
                    void rpc("mcp.toggle", {
                      name: server.name,
                      active: event.target.checked,
                    }).then(() => load())
                  }
                  type="checkbox"
                />
              </span>
            </div>
          ))}
        </div>
      )}
      {!loaded && <p>正在加载可用设置…</p>}
    </section>
  );
}
