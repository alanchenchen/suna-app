import type { Dispatch, SetStateAction } from "react";
import type { MessagePart, SessionInfo } from "../../lib/runtimeBridge";
import type { useRuntimeBridge } from "./useRuntimeBridge";
import { flowFromSnapshot, messageId } from "./sessionState";
import type { ActiveData, Scope } from "./sessionState";

type Rpc = ReturnType<typeof useRuntimeBridge>["rpc"];

export type SessionActionDeps = {
  rpc: Rpc;
  queueSessionOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  activeScopeMatches: (scope: Scope) => boolean;
  resetQueuedDeltas: () => void;
  setActive: Dispatch<SetStateAction<ActiveData>>;
  setSyncBoundary: (value: boolean) => void;
  setError: (value: string | undefined) => void;
  setSelectedId: (id: string | undefined) => void;
  setHandoffRole: (role: "host" | "guest") => void;
  scopeRef: { current: Scope | undefined };
  attachIntentRef: { current: number };
  hostSessionIdsRef: { current: Set<string> };
  mergeSession: (session: SessionInfo) => void;
  loadSessions: () => Promise<{ id: string }[]>;
  toast: (kind: "success" | "info" | "error", message: string) => void;
  isSessionActionsFrozen: () => boolean;
  getSelectedId: () => string | undefined;
  isSyncing: () => boolean;
  canDelete: () => boolean;
};

/**
 * 构造会话操作集合（create / send / updateModel / rename / detach / remove）。
 * 所有操作都经过串行队列、作用域校验与意图序号校验，保证并发切换安全。
 */
export function createSessionActions({
  rpc,
  queueSessionOperation,
  activeScopeMatches,
  resetQueuedDeltas,
  setActive,
  setSyncBoundary,
  setError,
  setSelectedId,
  setHandoffRole,
  scopeRef,
  attachIntentRef,
  hostSessionIdsRef,
  mergeSession,
  loadSessions,
  toast,
  isSessionActionsFrozen,
  getSelectedId,
  isSyncing,
  canDelete,
}: SessionActionDeps) {
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
          flow: [],
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
    if (isSessionActionsFrozen()) return;
    const scope = scopeRef.current;
    if (!scope || scope.sessionId !== getSelectedId()) return;
    const id = messageId();
    const content =
      parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") || "[图片]";
    setActive((value) => ({
      ...value,
      pendingUsers: [...value.pendingUsers, { id, content }],
    }));
    try {
      await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope)) throw new Error("会话已切换。");
        await rpc("agent.sendMessage", { client_msg_id: id, parts });
        // idle 会话没有 run_id；发送成功后立即重新 attach，让后续
        // run-only 事件拥有权威作用域。
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
          // 新回合开始：清空上一轮的工具卡叙事（历史工具细节由
          // toolSummary 统计兜底，避免 flow 无限累积），只恢复
          // 权威 buffer（若 Runtime 已开始流式输出）。
          flow: flowFromSnapshot(snapshot),
          // 发送前的 run 属于旧快照；由新的权威 current_run 决定控制权。
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
    if (!scope || isSessionActionsFrozen()) return;
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

  async function rename(title: string) {
    const scope = scopeRef.current;
    if (!scope || isSessionActionsFrozen()) return;
    try {
      const snapshot = await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope)) throw new Error("会话已切换。");
        return rpc("session.update", {
          session_id: scope.sessionId,
          title: title.trim() || null,
        });
      });
      // session.update 的响应只对发起它的那次 attach 有效；
      // 之后的 handoff 绝不能用它重绘快照。
      if (!activeScopeMatches(scope)) return;
      setActive((value) => ({ ...value, snapshot }));
      mergeSession(snapshot.session);
      await loadSessions();
      toast("success", "会话标题已更新");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法更新会话标题。");
    }
  }

  async function detach() {
    if (isSyncing()) return;
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        await rpc("session.detach", {});
        if (intent !== attachIntentRef.current) return;
        setSelectedId(undefined);
        setActive({ flow: [], pendingUsers: [] });
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
    if (isSyncing() || !canDelete()) return;
    if (!window.confirm("删除此会话？此操作无法撤销。")) return;
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        // Runtime 拒绝删除当前 attach 的会话：在同一队列中先 detach 再
        // delete，之后的 attach 意图继续排队，不会插队。
        await rpc("session.detach", {});
        await rpc("session.delete", { session_id: id });
        if (intent !== attachIntentRef.current) return;
        setSelectedId(undefined);
        setActive({ flow: [], pendingUsers: [] });
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
            flow: flowFromSnapshot(snapshot),
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

  return { create, send, updateModel, rename, detach, remove };
}
