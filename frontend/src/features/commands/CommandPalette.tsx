import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { SessionInfo } from "../../lib/runtimeBridge";

type CommandPaletteProps = {
  open: boolean;
  sessions: SessionInfo[];
  selectedId?: string;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onCreateTask: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onToggleDetails: () => void;
};

type Command = {
  id: string;
  label: string;
  detail?: string;
  icon: "message" | "plus" | "settings" | "sun" | "panel";
  kind: "session" | "action";
  run: () => void;
};

/** Cmd/Ctrl+K 全局命令面板：搜索任务 + 快捷动作（设计 §阶段 3）。 */
export function CommandPalette({
  open,
  sessions,
  selectedId,
  onClose,
  onSelectSession,
  onCreateTask,
  onOpenSettings,
  onToggleTheme,
  onToggleDetails,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦 + 清空查询。
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sessionCommands: Command[] = sessions
      .filter((session) => {
        if (!q) return true;
        return (
          (session.title ?? "").toLowerCase().includes(q) ||
          session.cwd.toLowerCase().includes(q)
        );
      })
      .slice(0, 8)
      .map((session) => ({
        id: `session-${session.id}`,
        label: session.title || "未命名任务",
        detail: session.cwd,
        icon: "message" as const,
        kind: "session" as const,
        run: () => onSelectSession(session.id),
      }));
    const actions: Command[] = [
      {
        id: "create",
        label: "新建任务…",
        icon: "plus" as const,
        kind: "action" as const,
        run: onCreateTask,
      },
      {
        id: "settings",
        label: "打开设置",
        icon: "settings" as const,
        kind: "action" as const,
        run: onOpenSettings,
      },
      {
        id: "theme",
        label: "切换主题",
        icon: "sun" as const,
        kind: "action" as const,
        run: onToggleTheme,
      },
      {
        id: "details",
        label: "切换状态面板",
        icon: "panel" as const,
        kind: "action" as const,
        run: onToggleDetails,
      },
    ].filter((action) => {
      if (!q) return true;
      return action.label.toLowerCase().includes(q);
    });
    return [...sessionCommands, ...actions];
  }, [
    onCreateTask,
    onOpenSettings,
    onSelectSession,
    onToggleDetails,
    onToggleTheme,
    query,
    sessions,
  ]);

  // 打开时重置高亮；命令列表变化时夹紧高亮。
  useEffect(() => {
    setHighlight(0);
  }, [open, query]);
  useEffect(() => {
    setHighlight((value) => Math.min(value, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  // 键盘导航：上下移动高亮，回车执行。
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((value) => Math.min(value + 1, commands.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[highlight];
      if (command) {
        command.run();
        onClose();
      }
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-start justify-items-center p-4 pt-[12vh]">
      {/* 遮罩 */}
      <button
        aria-label="关闭命令面板"
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-[rgb(15_18_28_/_0.4)] animate-[scrim-in_160ms_ease_both]"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div className="relative w-[min(100%,560px)] animate-[panel-pop_200ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-xl">
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          <Icon className="shrink-0 text-ink-muted" name="search" size={15} />
          <input
            aria-label="搜索任务或命令"
            className="min-w-0 flex-1 bg-transparent py-3 text-[13px] text-ink outline-none placeholder:text-ink-muted"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索任务或输入命令…"
            ref={inputRef}
            value={query}
          />
          <kbd className="shrink-0 rounded-md border border-line bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">
            Esc
          </kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {commands.length === 0 && (
            <p className="p-3 text-center text-[12px] text-ink-muted">
              没有匹配的结果
            </p>
          )}
          {commands.map((command, index) => {
            const active = index === highlight;
            return (
              <button
                aria-selected={active}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-80 ${
                  active ? "bg-blue-soft/70" : "hover:bg-surface-subtle"
                }`}
                key={command.id}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => {
                  command.run();
                  onClose();
                }}
                type="button"
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                    active
                      ? "bg-blue text-white"
                      : "bg-surface-subtle text-ink-muted"
                  }`}
                >
                  <Icon name={command.icon} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-bold text-ink">
                    {command.label}
                  </strong>
                  {command.detail && (
                    <small className="block truncate font-mono text-[10px] text-ink-muted">
                      {command.detail}
                    </small>
                  )}
                </span>
                {command.kind === "session" &&
                  command.id === `session-${selectedId}` && (
                    <span className="shrink-0 text-[10px] font-bold text-blue-strong">
                      当前
                    </span>
                  )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
