import { useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import type { SessionInfo } from "../../lib/runtimeBridge";

const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "空闲",
  running: "正在运行",
  waiting: "等待你的回答",
  compacting: "正在压缩上下文",
};

type SessionSidebarProps = {
  sessions: SessionInfo[];
  selectedId?: string;
  open?: boolean;
  connected: boolean;
  /** Session currently being attached by the application shell. */
  pendingId?: string;
  /** Prevent session-changing controls while the application shell is busy. */
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  onDisconnect: () => void;
  onJoinActive: (id: string) => void;
};

function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return new Date(value).toLocaleDateString();
}

export function SessionSidebar({
  sessions,
  selectedId,
  open = false,
  connected,
  pendingId,
  disabled = false,
  onSelect,
  onCreate,
  onDisconnect,
  onJoinActive,
}: SessionSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    if (!cwd.trim()) {
      setError("请输入工作目录。");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onCreate(cwd.trim(), title.trim() || undefined);
      setCwd("");
      setTitle("");
      setCreating(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建会话。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside
      aria-label="会话"
      className={`session-sidebar ${open ? "is-open" : ""}`}
    >
      <div className="sidebar-top">
        <button className="brand" type="button">
          <span className="brand-mark">
            <Icon name="sparkle" size={17} />
          </span>
          <span>Suna</span>
        </button>
        <IconButton
          disabled={disabled}
          label="新建会话"
          onClick={() => setCreating((value) => !value)}
        >
          <Icon name="plus" />
        </IconButton>
      </div>
      {creating && (
        <form
          className="session-create"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            工作目录
            <input
              autoFocus
              disabled={disabled || submitting}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/Users/me/project"
              value={cwd}
            />
          </label>
          <label>
            标题（可选）
            <input
              disabled={disabled || submitting}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="新任务"
              value={title}
            />
          </label>
          {error && <small className="form-error">{error}</small>}
          <button
            className="runtime-retry"
            disabled={disabled || submitting}
            type="submit"
          >
            {submitting ? "正在创建…" : "创建会话"}
          </button>
        </form>
      )}
      <nav aria-label="最近会话" className="session-list">
        <p className="section-label">最近会话</p>
        {sessions.length === 0 && (
          <p className="empty-state">还没有会话。创建一个工作目录开始吧。</p>
        )}
        {sessions.map((session) => {
          const selected = session.id === selectedId;
          const joining = session.id === pendingId;
          const canJoin =
            session.status === "running" && !selected && !disabled && !joining;
          return (
            <div
              className={`session-item ${selected ? "selected" : ""} ${joining ? "is-pending" : ""} ${canJoin ? "has-join" : ""}`}
              key={session.id}
            >
              <button
                aria-current={selected ? "page" : undefined}
                aria-label={`${session.title || "未命名会话"}，${joining ? "正在打开" : statusLabels[session.status]}`}
                className="session-row"
                disabled={disabled || joining}
                onClick={() => onSelect(session.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`session-dot ${session.status === "running" ? "active" : session.status === "waiting" ? "waiting" : session.status === "compacting" ? "compacting" : "idle"}`}
                />
                <span className="session-copy">
                  <strong>{session.title || "未命名会话"}</strong>
                  <small>{session.cwd}</small>
                  <em className={`session-status ${session.status}`}>
                    {joining ? "正在打开…" : statusLabels[session.status]}
                  </em>
                </span>
                <time>{relativeTime(session.updated_at)}</time>
              </button>
              {canJoin && (
                <button
                  aria-label={`加入正在运行的会话：${session.title || "未命名会话"}`}
                  className="join-session"
                  onClick={() => onJoinActive(session.id)}
                  type="button"
                >
                  加入
                </button>
              )}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <button
          className="connection-status"
          disabled={disabled}
          onClick={onDisconnect}
          type="button"
        >
          <span className={connected ? "online-dot" : "offline-dot"} />
          {connected ? "Runtime 已连接" : "Runtime 未连接"}
        </button>
        <div className="profile">
          <span className="avatar">SU</span>
          <span>Runtime workspace</span>
        </div>
      </div>
    </aside>
  );
}
