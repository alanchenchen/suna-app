import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconButton } from "./components/Icon";
import { Dialog } from "./components/ui/Dialog";
import { Select } from "./components/ui/Select";
import { Switch } from "./components/ui/Switch";
import { useToast } from "./components/ui/Toast";
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
import "./styles/tailwind.css";

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
  const { toast } = useToast();
  // 主题：默认跟随系统（system），用户手动切换后记住偏好（light/dark）。
  // 显式选过 system 也会记住，之后继续跟随系统变化。
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
  const [composerFocus, setComposerFocus] = useState(0);
  // handoffRole：当前会话中我是 host（创建/拥有）还是 guest（加入别人的）。
  // 对应 TUI 的 handoffRole；idle 会话无法从 Runtime 得知 owner，因此用
  // 前端记忆：本会话创建过/恢复过则视为 host，否则 attach 即视为 guest。
  const [handoffRole, setHandoffRole] = useState<"host" | "guest">("host");
  const hostSessionIdsRef = useRef<Set<string>>(new Set());
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
      if (syncingRef.current || !scope) return;
      // Runtime may omit run_id for notifications on an attached session. The
      // bridge is session-scoped, so bind those events to the current attach;
      // when a run_id is present, still reject events from an older run.
      if (runId && scope.runId && scope.runId !== runId) return;
      if (runId && !scope.runId) scopeRef.current = { ...scope, runId };
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
    return Boolean(
      !syncingRef.current &&
      scope &&
      (!runId || !scope.runId || scope.runId === runId),
    );
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
        // Commit any delta queued in the current animation frame before the
        // terminal run event, otherwise the last chunk can appear twice.
        if (event.params.state === "done") flushDeltas();
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
            ? event.params.error
              ? {
                  ...value,
                  activeTool: { ...value.activeTool, status: "failed" },
                }
              : { ...value, activeTool: undefined }
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
        const text = event.params.parts
          ?.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const content =
          text ||
          (event.params.parts?.some((part) => part.type === "image")
            ? "[图片]"
            : undefined);
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
                  messages: (value.snapshot.messages ?? []).some(
                    (message) =>
                      message.role === "user" && message.content === content,
                  )
                    ? value.snapshot.messages
                    : [
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
    [acceptsRun, acceptsSession, flushDeltas, mergeSession, queueDelta],
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
  const { connect, rpc, connected, hello, status, error: bridgeError } = bridge;
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
        // 判断当前会话中我的身份：我创建过的会话是 host，否则视为 guest。
        setHandoffRole(hostSessionIdsRef.current.has(id) ? "host" : "guest");
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
  // Runtime 的 session.updated 只广播给 attach 了该 session 的连接；
  // Web 未 attach 的 session（例如 TUI 正在运行的）收不到状态变更，
  // 因此需要定时刷新列表，让 running/waiting 状态和 Join Active 入口保持最新。
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      void loadSessions().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connected, loadSessions]);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    // 同步浏览器 UI 色（地址栏/状态栏），跟随当前主题。
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#10141e" : "#f5f7fb",
      );
    }
    window.localStorage.setItem("suna-theme", theme);
  }, [resolvedTheme, theme]);
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
  // 主题切换：同步写入 data-theme 并更新偏好，不依赖 View Transition 等
  // 浏览器 API 的兼容性，保证在任何浏览器下都立即生效。
  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }, [resolvedTheme]);

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
  const canDelete = cap("session");
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
        hostSessionIdsRef.current.add(snapshot.session.id);
        setHandoffRole("host");
        setActive({
          snapshot,
          assistant: "",
          reasoning: "",
          toolSummary: snapshot.tool_summary,
          pendingUsers: [],
        });
        mergeSession(snapshot.session);
        toast("success", "会话已创建");
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
            messages: snapshot.messages ?? value.snapshot?.messages,
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
    toast("success", `已切换模型：${model_ref}`);
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
      toast("success", "会话标题已更新");
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
        toast("info", "已离开当前会话");
      });
    } catch (reason) {
      if (intent === attachIntentRef.current)
        setError(reason instanceof Error ? reason.message : "无法分离会话。");
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }
  async function remove(id: string) {
    if (syncing || !canDelete) return;
    if (!window.confirm("删除此会话？此操作无法撤销。")) return;
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
        toast("success", "会话已删除");
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
            className="mt-6 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue text-[12px] font-extrabold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[background,transform] duration-150 hover:bg-blue-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
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
        onReconnect={() =>
          void initialize().catch((reason) =>
            setError(
              reason instanceof Error
                ? reason.message
                : "无法重新连接 Runtime。",
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
        onDetach={selectedId ? () => void detach() : undefined}
        onDelete={canDelete ? (id) => void remove(id) : undefined}
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
        <header className="flex min-h-[74px] items-center justify-between gap-4 border-b border-line px-7 py-3.5 max-[720px]:min-h-[65px] max-[720px]:gap-2.5 max-[720px]:px-3.5 max-[720px]:pt-[max(10px,env(safe-area-inset-top))] max-[720px]:pb-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <IconButton
              className="hidden max-[720px]:inline-grid"
              label="打开会话列表"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Icon name="message" />
            </IconButton>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="m-0 max-w-[54vw] overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-extrabold tracking-tight text-ink max-[720px]:max-w-[min(47vw,230px)] max-[720px]:text-[13px]">
                  {selected?.title || "选择或创建一个会话"}
                </h1>
                {selected && cap("session") && (
                  <button
                    className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-bold text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={sessionActionsFrozen || observer}
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
                  <span
                    aria-live="polite"
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-ink-soft max-[390px]:text-[0]"
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
                      className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-bold text-blue-strong"
                    >
                      <Icon name="users" size={11} />
                      {handoffRole === "guest" ? "已加入" : "共享中"}
                      {selected.client_count > 1 &&
                        ` · ${selected.client_count}`}
                    </span>
                  )}
                <RuntimeStatusBadge
                  protocolVersion={hello?.protocol_version ?? "—"}
                />
              </div>
              <p className="m-0 max-[720px]:hidden">
                {selected?.cwd || "你的本地 Runtime 工作空间"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 max-[720px]:gap-px">
            <IconButton
              label={
                resolvedTheme === "dark" ? "切换为浅色主题" : "切换为深色主题"
              }
              onClick={toggleTheme}
            >
              <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} />
            </IconButton>
            <IconButton
              label="Runtime 设置"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Icon name="ellipsis" />
            </IconButton>
            {running && canControl && !syncing && (
              <button
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-rose/10 px-2.5 text-[11px] font-bold text-rose transition-colors duration-150 hover:bg-rose/15 active:scale-95 max-[720px]:h-8 max-[720px]:px-2"
                onClick={() =>
                  void queueSessionOperation(() => rpc("agent.cancel", {}))
                }
                type="button"
              >
                <Icon name="pause" size={15} />
                <span className="max-[390px]:hidden">停止</span>
              </button>
            )}
            <IconButton
              ariaControls="run-details"
              ariaExpanded={detailsOpen}
              className="aria-expanded:false:bg-blue-soft aria-expanded:false:text-blue-strong"
              label={detailsOpen ? "关闭任务详情" : "打开任务详情"}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              <Icon name="panel" />
            </IconButton>
          </div>
        </header>
        <Dialog
          open={editingTitle}
          onOpenChange={setEditingTitle}
          title="重命名会话"
          description="留空可恢复为未命名会话。"
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
              会话标题
              <input
                autoFocus
                className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
                onChange={(event) => setTitleDraft(event.target.value)}
                value={titleDraft}
              />
            </label>
            <div className="mt-1 flex justify-end gap-2.5">
              <button
                className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
                onClick={() => setEditingTitle(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
                type="submit"
              >
                保存
              </button>
            </div>
          </form>
        </Dialog>
        {observer && (
          <div
            aria-live="polite"
            className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-rose/35 bg-rose/10 px-5 py-2 text-[13px] text-ink"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 animate-[breathe_2.4s_ease-in-out_infinite] rounded-full bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]"
              />
              {handoffRole === "guest"
                ? "已加入其他客户端的会话，任务运行中仅可查看。"
                : "另一个客户端正在运行此会话，当前仅可查看。"}
            </span>
            {selected && selected.client_count > 1 && (
              <span className="shrink-0 text-[11px] font-bold text-ink-soft">
                {selected.client_count} 个客户端
              </span>
            )}
          </div>
        )}
        {error && (
          <div
            className="animate-[slide-down_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex items-center justify-between gap-3 border-b border-rose/35 bg-rose/10 px-5 py-2 text-[13px] text-ink"
            role="alert"
          >
            {error}
            <button
              className="cursor-pointer rounded-md bg-rose/15 px-2 py-0.5 text-[11px] font-bold text-rose transition-colors duration-150 hover:bg-rose/25"
              onClick={() => setError(undefined)}
              type="button"
            >
              关闭
            </button>
          </div>
        )}
        {settingsOpen && (
          <RuntimeSettings
            cap={cap}
            config={config}
            onClose={() => setSettingsOpen(false)}
            onConfig={setConfig}
            onThemeChange={setTheme}
            rpc={rpc}
            theme={theme}
          />
        )}
        <ChatTimeline
          activeTool={active.activeTool}
          assistantBuffer={active.assistant}
          loading={syncing}
          messages={messages}
          pending={active.pendingUsers.length > 0}
          phase={active.run?.phase ?? current?.phase}
          reasoningBuffer={active.reasoning}
          running={running}
          sessionId={active.snapshot?.session.id}
        />
        <Composer
          canAttachImageUrl={Boolean(hello?.content_sources.url)}
          disabled={sessionActionsFrozen || observer}
          focusTrigger={composerFocus}
          onSubmit={send}
          observer={observer}
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
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};
function RuntimeSettings({
  cap,
  config,
  onConfig,
  onClose,
  rpc,
  theme,
  onThemeChange,
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
    <section
      aria-label="Runtime 设置"
      className="animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] runtime-settings overflow-auto rounded-2xl border border-line bg-surface p-4 shadow-lg"
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
            能力设置
          </p>
          <h2 className="mt-1 text-[16px] font-extrabold text-ink">
            Runtime 设置
          </h2>
        </div>
        <IconButton label="关闭设置" onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </div>
      {error && <p className="text-[12px] font-semibold text-rose">{error}</p>}
      <div className="mt-3.5 border-t border-line pt-3">
        <label className="grid gap-1.5 text-[11px] font-bold tracking-wide text-ink-soft">
          主题
          <div className="flex gap-1.5">
            {(
              [
                ["system", "跟随系统"],
                ["light", "浅色"],
                ["dark", "深色"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-colors duration-150 ${
                  theme === value
                    ? "border-blue/60 bg-blue-soft text-blue-strong"
                    : "border-line bg-surface-raised text-ink-soft hover:bg-surface-subtle"
                }`}
                key={value}
                onClick={() => {
                  const next = value as Theme;
                  document.documentElement.dataset.theme =
                    next === "system"
                      ? window.matchMedia("(prefers-color-scheme: dark)")
                          .matches
                        ? "dark"
                        : "light"
                      : next;
                  onThemeChange(next);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </label>
      </div>
      {cap("config") && config && (
        <div className="border-t border-line pt-3 mt-3.5">
          <label className="grid gap-1.5 text-[11px] font-bold tracking-wide text-ink-soft">
            默认模型
            <Select
              ariaLabel="默认模型"
              onValueChange={(value) =>
                void rpc("config.set", {
                  action: "activate_model",
                  active_model: value,
                }).then(onConfig)
              }
              options={config.models.map((model) => {
                const ref = `${model.provider}/${model.model}`;
                return { value: ref, label: ref };
              })}
              value={config.active_model}
            />
          </label>
        </div>
      )}
      {cap("memory") && (
        <div className="border-t border-line pt-3 mt-3.5">
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-[13px] font-bold text-ink">记忆</h3>
            {memory.length > 0 && (
              <button
                className="cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
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
              <div
                className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
                key={item.id}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-ink">
                    {item.content}
                  </strong>
                  <small className="mt-0.5 block text-[11px] font-normal text-ink-muted">
                    {item.kind} · 优先级 {item.priority}
                  </small>
                </span>
                <button
                  className="shrink-0 cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
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
            <p className="text-[13px] text-ink-muted">没有可用记忆。</p>
          )}
        </div>
      )}
      {cap("skill") && (
        <div className="border-t border-line pt-3 mt-3.5">
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">技能</h3>
          {skills.map((skill) => (
            <div
              className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
              key={skill.name}
            >
              <span className="min-w-0">
                <strong className="block truncate text-ink">
                  {skill.name}
                </strong>
                <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
                  {skill.description}
                </small>
              </span>
              <Switch
                checked={skill.enabled}
                label={`启用技能 ${skill.name}`}
                onCheckedChange={(enabled) =>
                  void rpc("skill.set", {
                    name: skill.name,
                    enabled,
                  }).then(() => load())
                }
              />
            </div>
          ))}
        </div>
      )}
      {cap("mcp") && (
        <div className="border-t border-line pt-3 mt-3.5">
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">MCP 服务</h3>
          {mcp.map((server) => (
            <div
              className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
              key={server.name}
            >
              <span className="min-w-0">
                <strong className="block truncate text-ink">
                  {server.name}
                </strong>
                <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
                  {server.transport ? `${server.transport} · ` : ""}
                  {server.tool_count} 个工具
                </small>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  className="cursor-pointer text-[11px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
                  onClick={() =>
                    void rpc("mcp.reload", { name: server.name }).then(() =>
                      load(),
                    )
                  }
                  type="button"
                >
                  重载
                </button>
                <Switch
                  checked={server.active}
                  label={`启用 MCP 服务 ${server.name}`}
                  onCheckedChange={(active) =>
                    void rpc("mcp.toggle", {
                      name: server.name,
                      active,
                    }).then(() => load())
                  }
                />
              </span>
            </div>
          ))}
        </div>
      )}
      {!loaded && (
        <p className="text-[13px] text-ink-muted">正在加载可用设置…</p>
      )}
    </section>
  );
}
