import { useEffect, useRef, useState } from "react";
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
  /** 未连接时点击重新连接；已连接时该按钮仅为状态展示。 */
  onReconnect: () => void;
  onJoinActive: (id: string) => void;
  onDetach?: () => void;
  onDelete?: (id: string) => void;
  onRename?: () => void;
  onClose?: () => void;
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
  onReconnect,
  onJoinActive,
  onDetach,
  onDelete,
  onRename,
  onClose,
}: SessionSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [menuFor, setMenuFor] = useState<string>();
  const menuRef = useRef<HTMLDivElement>(null);

  // 移动端（≤720px）侧栏是抽屉：未打开时对屏幕阅读器和 Tab 聚焦隐藏，
  // 避免读屏读到屏幕外的会话列表、键盘焦点落到不可见元素上。
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const hidden = isMobile && !open;

  // 点击会话菜单外部时关闭菜单，避免菜单残留。
  useEffect(() => {
    if (!menuFor) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        setMenuFor(undefined);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuFor]);

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
      aria-hidden={hidden || undefined}
      aria-label="会话"
      className={`session-sidebar ${open ? "is-open" : ""}`}
      inert={hidden || undefined}
    >
      <div className="mb-1 flex min-h-[42px] items-center justify-between px-1 pl-2">
        <button
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[17px] font-extrabold tracking-tight text-ink transition-colors duration-150 hover:bg-surface-subtle"
          type="button"
        >
          <span className="grid h-[27px] w-[27px] place-items-center rounded-[9px] bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-white shadow-[0_4px_11px_rgba(91,103,241,0.26)]">
            <Icon name="sparkle" size={17} />
          </span>
          <span>Suna</span>
        </button>
        <div className="flex items-center gap-1">
          <IconButton
            disabled={disabled}
            label="新建会话"
            onClick={() => setCreating((value) => !value)}
          >
            <Icon name="plus" />
          </IconButton>
          {/* 移动端抽屉内的关闭按钮。 */}
          {onClose && (
            <IconButton
              className="hidden max-[720px]:inline-grid"
              label="关闭会话列表"
              onClick={onClose}
            >
              <Icon name="close" />
            </IconButton>
          )}
        </div>
      </div>
      {creating && (
        <form
          className="grid gap-2 px-3.5 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="grid gap-1 text-[11px] font-bold tracking-wide text-ink-muted">
            工作目录
            <input
              autoFocus
              className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              disabled={disabled || submitting}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/Users/me/project"
              value={cwd}
            />
          </label>
          <label className="grid gap-1 text-[11px] font-bold tracking-wide text-ink-muted">
            标题（可选）
            <input
              className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              disabled={disabled || submitting}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="新任务"
              value={title}
            />
          </label>
          {error && (
            <small className="text-[12px] font-semibold text-rose">
              {error}
            </small>
          )}
          <div className="flex gap-2">
            <button
              className="flex-1 cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || submitting}
              onClick={() => {
                setCreating(false);
                setCwd("");
                setTitle("");
                setError(undefined);
              }}
              type="button"
            >
              取消
            </button>
            <button
              className="flex-1 cursor-pointer rounded-lg bg-blue px-3 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || submitting}
              type="submit"
            >
              {submitting ? "正在创建…" : "创建会话"}
            </button>
          </div>
        </form>
      )}
      <nav aria-label="最近会话" className="session-list">
        <p className="px-2 pb-2 text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
          最近会话
        </p>
        {sessions.length === 0 && (
          <p className="p-4 text-center text-[13px] text-ink-muted">
            还没有会话。创建一个工作目录开始吧。
          </p>
        )}
        {sessions.map((session) => {
          const selected = session.id === selectedId;
          const joining = session.id === pendingId;
          const canJoin =
            session.status === "running" && !selected && !disabled && !joining;
          return (
            <div
              className={`group relative my-0.5 ${selected ? "rounded-xl border border-line bg-surface-solid shadow-sm" : ""} ${joining ? "opacity-60" : ""}`}
              key={session.id}
            >
              {/* 选中态左侧品牌色指示条：现代导航的经典做法 */}
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-0 h-[60%] w-[3px] -translate-y-1/2 rounded-r-full bg-blue shadow-[0_0_8px_var(--color-blue-glow)]"
                />
              )}
              <button
                aria-current={selected ? "page" : undefined}
                aria-label={`${session.title || "未命名会话"}，${joining ? "正在打开" : statusLabels[session.status]}`}
                className={`grid w-full cursor-pointer grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-2 rounded-xl px-2 py-2.5 text-left transition-[background,border-color,transform,opacity] duration-180 ${selected ? "text-ink" : "text-ink-soft"} hover:bg-surface-subtle active:scale-[0.985] disabled:cursor-wait disabled:opacity-60`}
                disabled={disabled || joining}
                onClick={() => onSelect(session.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-[7px] w-[7px] rounded-full ${session.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]" : session.status === "waiting" ? "bg-amber" : session.status === "compacting" ? "animate-[breathe_1.8s_ease-in-out_infinite] bg-blue shadow-[0_0_0_3px_var(--color-blue-soft)]" : "bg-ink-muted"}`}
                />
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-[12px] font-extrabold text-ink">
                    {session.title || "未命名会话"}
                  </strong>
                  <small className="truncate text-[10px] text-ink-muted">
                    {session.cwd}
                  </small>
                  <span
                    className={`text-[10px] font-bold ${session.status === "running" ? "text-blue-strong" : session.status === "waiting" ? "text-amber" : "text-ink-muted"}`}
                  >
                    {joining ? "正在打开…" : statusLabels[session.status]}
                  </span>
                </span>
                <time className="text-[10px] text-ink-muted">
                  {relativeTime(session.updated_at)}
                </time>
              </button>
              {canJoin && (
                <button
                  aria-label={`加入正在运行的会话：${session.title || "未命名会话"}`}
                  className="absolute top-1.5 right-2 cursor-pointer rounded-md bg-blue px-2 py-1 text-[10px] font-bold text-white shadow-sm transition-colors duration-150 hover:bg-blue-strong"
                  onClick={() => onJoinActive(session.id)}
                  type="button"
                >
                  加入
                </button>
              )}
              {selected && (onDetach || onDelete || onRename) && (
                <div className="absolute top-1 right-1.5" ref={menuRef}>
                  <button
                    aria-expanded={menuFor === session.id}
                    aria-label={`会话操作：${session.title || "未命名会话"}`}
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink-muted opacity-0 transition-[opacity,background] duration-150 hover:bg-surface-subtle hover:text-ink focus:opacity-100 group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuFor(
                        menuFor === session.id ? undefined : session.id,
                      );
                    }}
                    type="button"
                  >
                    <Icon name="ellipsis" size={15} />
                  </button>
                  {menuFor === session.id && (
                    <div className="absolute top-8 right-0 z-10 w-36 animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-xl border border-line bg-surface-solid py-1 shadow-lg">
                      {onRename && (
                        <button
                          className="block w-full cursor-pointer px-3 py-2 text-left text-[12px] font-semibold text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuFor(undefined);
                            onRename();
                          }}
                          type="button"
                        >
                          重命名会话
                        </button>
                      )}
                      {onDetach && (
                        <button
                          className="block w-full cursor-pointer px-3 py-2 text-left text-[12px] font-semibold text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuFor(undefined);
                            onDetach();
                          }}
                          type="button"
                        >
                          分离会话
                        </button>
                      )}
                      {onDelete && (
                        <button
                          className="block w-full cursor-pointer px-3 py-2 text-left text-[12px] font-semibold text-rose transition-colors duration-100 hover:bg-rose/10"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuFor(undefined);
                            onDelete(session.id);
                          }}
                          type="button"
                        >
                          删除会话
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-line pt-3">
        <button
          aria-label={
            connected ? "Runtime 已连接" : "Runtime 未连接，点击重新连接"
          }
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-bold transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent"
          disabled={connected || disabled}
          onClick={onReconnect}
          type="button"
        >
          <span
            className={`h-[7px] w-[7px] rounded-full ${connected ? "bg-green" : "bg-[#8a8f9d]"}`}
          />
          {connected ? "Runtime 已连接" : "Runtime 未连接，点击重连"}
        </button>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-[11px] font-extrabold text-white">
            SU
          </span>
          <span className="text-[12px] font-semibold text-ink-soft">
            Runtime workspace
          </span>
        </div>
      </div>
    </aside>
  );
}
