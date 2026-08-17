import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import type { SessionInfo } from "../../lib/runtimeBridge";

const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "空闲",
  running: "正在运行",
  waiting: "等待你的回答",
  compacting: "正在压缩上下文",
};

/** 组折叠记忆：localStorage 按项目路径记录折叠状态。 */
const COLLAPSED_KEY = "suna-app:collapsed-projects";
/** 会话置顶记忆：localStorage 记录手动置顶的会话 id。 */
const PINNED_KEY = "suna-app:pinned-sessions";

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

/** 项目名：路径 basename；根路径等无 basename 时回退为原路径。 */
export function projectName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return base || cwd;
}

const waitingRank: Record<SessionInfo["status"], number> = {
  waiting: 0,
  running: 1,
  compacting: 2,
  idle: 3,
};

function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return new Date(value).toLocaleDateString();
}

type SessionSidebarProps = {
  sessions: SessionInfo[];
  selectedId?: string;
  open?: boolean;
  connected: boolean;
  /** Runtime 版本号（连接后展示在底部状态行）。 */
  runtimeVersion?: string;
  /** Session currently being attached by the application shell. */
  pendingId?: string;
  /** Prevent session-changing controls while the application shell is busy. */
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  /** 打开新建任务对话框（项目选择器在 Dialog 中）。 */
  onRequestCreate: () => void;
  /** 未连接时点击重新连接；已连接时该按钮仅为状态展示。 */
  onReconnect: () => void;
  onJoinActive: (id: string) => void;
  onDetach?: () => void;
  onDelete?: (id: string) => void;
  onRename?: () => void;
  onClose?: () => void;
};

function SessionRow({
  disabled,
  joining,
  onDelete,
  onDetach,
  onJoinActive,
  onRename,
  onSelect,
  onTogglePin,
  pinned,
  selected,
  session,
}: {
  disabled: boolean;
  joining: boolean;
  onDelete?: (id: string) => void;
  onDetach?: () => void;
  onJoinActive: (id: string) => void;
  onRename?: () => void;
  onSelect: (id: string) => void;
  onTogglePin?: () => void;
  pinned?: boolean;
  selected: boolean;
  session: SessionInfo;
}) {
  const [menuFor, setMenuFor] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const canJoin =
    session.status === "running" && !selected && !disabled && !joining;

  // 点击会话菜单外部时关闭菜单，避免菜单残留。
  useEffect(() => {
    if (!menuFor) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        setMenuFor(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuFor]);

  return (
    <div
      className={`group relative my-0.5 ${selected ? "rounded-xl border border-line bg-surface-solid shadow-sm" : ""} ${joining ? "opacity-60" : ""}`}
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
      {selected && (onDetach || onDelete || onRename || onTogglePin) && (
        <div className="absolute top-1 right-1.5" ref={menuRef}>
          <button
            aria-expanded={menuFor}
            aria-label={`会话操作：${session.title || "未命名会话"}`}
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink-muted opacity-0 transition-[opacity,background] duration-150 hover:bg-surface-subtle hover:text-ink focus:opacity-100 group-hover:opacity-100 max-[720px]:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              setMenuFor((value) => !value);
            }}
            type="button"
          >
            <Icon name="ellipsis" size={15} />
          </button>
          {menuFor && (
            <div className="absolute top-8 right-0 z-10 w-36 animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-xl border border-line bg-surface-solid py-1 shadow-lg">
              {onTogglePin && (
                <button
                  className="block w-full cursor-pointer px-3 py-2 text-left text-[12px] font-semibold text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuFor(false);
                    onTogglePin();
                  }}
                  type="button"
                >
                  {pinned ? "取消置顶" : "置顶会话"}
                </button>
              )}
              {onRename && (
                <button
                  className="block w-full cursor-pointer px-3 py-2 text-left text-[12px] font-semibold text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuFor(false);
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
                    setMenuFor(false);
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
                    setMenuFor(false);
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
}

/** 侧栏：搜索 + 按项目分组 + waiting 置顶。
 * 分组状态存 localStorage；搜索时临时平铺（设计 §6.2）。 */
export function SessionSidebar({
  sessions,
  selectedId,
  open = false,
  connected,
  runtimeVersion,
  pendingId,
  disabled = false,
  onSelect,
  // onCreate 由 Dialog 承担（onRequestCreate）；prop 保留仅为类型兼容，
  // 不在此处解构使用（避免 no-unused-vars）。
  onRequestCreate,
  onReconnect,
  onJoinActive,
  onDetach,
  onDelete,
  onRename,
  onClose,
}: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [pinned, setPinned] = useState<Set<string>>(loadPinned);
  // 每分钟刷新相对时间（"刚刚/5m 前"不会一直停留在旧值）。
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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

  function toggleCollapsed(cwd: string) {
    setCollapsed((value) => {
      const next = new Set(value);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage 不可用时仅内存生效。
      }
      return next;
    });
  }

  function togglePin(id: string) {
    setPinned((value) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage 不可用时仅内存生效。
      }
      return next;
    });
  }

  /** 删除会话时同步清理置顶记忆，避免残留失效 id。 */
  function handleDelete(id: string) {
    setPinned((value) => {
      const next = new Set(value);
      next.delete(id);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage 不可用时仅内存生效。
      }
      return next;
    });
    onDelete?.(id);
  }

  // 排序：手动置顶 > waiting 置顶（设计 §6.2）> 其余按更新时间倒序。
  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const pa = pinned.has(a.id) ? 0 : 1;
        const pb = pinned.has(b.id) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const rank = waitingRank[a.status] - waitingRank[b.status];
        if (rank !== 0) return rank;
        return (
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      }),
    [pinned, sessions],
  );

  // 搜索：过滤标题 + 路径，搜索时平铺（临时取消分组）。
  const filtered = useMemo(() => {
    if (!query.trim()) return sorted;
    const q = query.trim().toLowerCase();
    return sorted.filter(
      (session) =>
        (session.title ?? "").toLowerCase().includes(q) ||
        session.cwd.toLowerCase().includes(q) ||
        projectName(session.cwd).toLowerCase().includes(q),
    );
  }, [sorted, query]);

  // 分组：按 cwd 聚合，组内保持 waiting 优先 + 时间倒序。
  const groups = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const session of filtered) {
      const list = map.get(session.cwd) ?? [];
      list.push(session);
      map.set(session.cwd, list);
    }
    return [...map.entries()].map(([cwd, list]) => ({
      cwd,
      name: projectName(cwd),
      list,
      hasWaiting: list.some((session) => session.status === "waiting"),
    }));
  }, [filtered]);
  const searching = Boolean(query.trim());
  const groupsWithWaiting = groups.filter((group) => group.hasWaiting);
  const groupsRest = groups.filter((group) => !group.hasWaiting);

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
            label="新建任务"
            onClick={onRequestCreate}
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
      <div className="px-2 pb-2">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-ink-muted">
            <Icon name="search" size={13} />
          </span>
          <input
            aria-label="搜索任务"
            className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pr-2.5 pl-8 text-[12px] text-ink placeholder:text-ink-muted focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务…"
            value={query}
          />
        </div>
      </div>
      <nav aria-label="最近会话" className="session-list">
        {filtered.length === 0 && (
          <p className="p-4 text-center text-[13px] text-ink-muted">
            {searching
              ? "没有匹配的任务。"
              : "还没有任务。创建一个任务开始吧。"}
          </p>
        )}
        {/* 搜索时平铺：不分组，保持 waiting 优先顺序 */}
        {searching
          ? filtered.map((session) => (
              <SessionRow
                disabled={disabled}
                joining={session.id === pendingId}
                key={session.id}
                onDelete={handleDelete}
                onDetach={onDetach}
                onJoinActive={onJoinActive}
                onRename={onRename}
                onSelect={onSelect}
                onTogglePin={() => togglePin(session.id)}
                pinned={pinned.has(session.id)}
                selected={session.id === selectedId}
                session={session}
              />
            ))
          : [...groupsWithWaiting, ...groupsRest].map((group) => {
              const isCollapsed = collapsed.has(group.cwd);
              return (
                <div className="mb-1" key={group.cwd}>
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-subtle"
                    onClick={() => toggleCollapsed(group.cwd)}
                    type="button"
                  >
                    <Icon
                      className={`shrink-0 text-ink-muted transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                      name="chevron-right"
                      size={12}
                    />
                    <Icon
                      className="shrink-0 text-ink-muted"
                      name="folder"
                      size={13}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-extrabold text-ink">
                      {group.name}
                    </span>
                    {group.hasWaiting && (
                      <span
                        aria-label="有待处理任务"
                        className="h-[7px] w-[7px] shrink-0 rounded-full bg-amber"
                      />
                    )}
                    <span className="shrink-0 text-[10px] font-bold text-ink-muted">
                      {group.list.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="pl-1">
                      {group.list.map((session) => (
                        <SessionRow
                          disabled={disabled}
                          joining={session.id === pendingId}
                          key={session.id}
                          onDelete={handleDelete}
                          onDetach={onDetach}
                          onJoinActive={onJoinActive}
                          onRename={onRename}
                          onSelect={onSelect}
                          onTogglePin={() => togglePin(session.id)}
                          pinned={pinned.has(session.id)}
                          selected={session.id === selectedId}
                          session={session}
                        />
                      ))}
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
          {connected && runtimeVersion && (
            <span className="ml-auto text-[10px] font-semibold text-ink-muted">
              v{runtimeVersion.replace(/^v/, "")}
            </span>
          )}
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
