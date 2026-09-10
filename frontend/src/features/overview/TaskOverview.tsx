import { useEffect, useReducer } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { SessionInfo } from "../../lib/runtimeBridge";

type TaskOverviewProps = {
  sessions: SessionInfo[];
  connected: boolean;
  selectedId?: string;
  pendingId?: string;
  /** 是否已配置模型（false 时显示引导卡）。 */
  hasModels: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onReconnect: () => void;
  onOpenSettings: () => void;
};

const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "session.status.idle",
  running: "session.status.running",
  waiting: "session.status.waiting",
  compacting: "session.status.compacting",
};

function relativeTime(
  value: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return t("time.justNow");
  if (seconds < 3600) {
    return t("time.minutesAgo", { m: Math.floor(seconds / 60) });
  }
  if (seconds < 86400) {
    return t("time.hoursAgo", { h: Math.floor(seconds / 3600) });
  }
  return new Date(value).toLocaleDateString();
}

function SessionRow({
  session,
  selected,
  pending,
  index,
  onClick,
}: {
  session: SessionInfo;
  selected: boolean;
  pending: boolean;
  /** 组内序号：首行不画分隔线（容器已带圆角裁切）。 */
  index: number;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      aria-label={`${session.title || t("sidebar.untitled")}，${pending ? t("sidebar.opening") : t(statusLabels[session.status])}`}
      className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-surface-subtle active:bg-surface-muted disabled:cursor-wait disabled:opacity-60 ${index > 0 ? "border-t border-line" : ""} ${selected ? "bg-blue-soft/50" : ""}`}
      disabled={pending}
      onClick={onClick}
      type="button"
    >
      <span className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${session.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue" : session.status === "waiting" ? "bg-amber" : session.status === "compacting" ? "animate-[breathe_1.8s_ease-in-out_infinite] bg-blue" : "bg-ink-muted"}`}
          />
          <strong className="truncate text-[13px] font-bold text-ink">
            {session.title || t("sidebar.untitled")}
          </strong>
        </span>
        <span className="truncate pl-[15px] text-[11px] text-ink-muted">
          {session.cwd}
        </span>
      </span>
      <span className="grid shrink-0 justify-items-end gap-0.5">
        <time className="text-[10.5px] text-ink-muted">
          {t(relativeTime(session.updated_at, t))}
        </time>
        <span
          className={`text-[10.5px] font-bold ${session.status === "running" ? "text-blue-strong" : session.status === "waiting" ? "text-amber" : "text-ink-muted"}`}
        >
          {pending ? t("sidebar.opening") : t(statusLabels[session.status])}
        </span>
      </span>
    </button>
  );
}

/**
 * 任务总览：移动端首页 / 桌面端无选中会话时的默认视图。
 *
 * 利用 Suna 多会话并行的全局视角，把“需要你处理”放在最前——
 * 这正是本地 Agent Runtime 的 Web 客户端相对单会话聊天产品
 * 最有价值的入口。数据完全来自全局 session.updated 广播。
 */
export function TaskOverview({
  sessions,
  connected,
  selectedId,
  pendingId,
  hasModels,
  onSelect,
  onCreate,
  onReconnect,
  onOpenSettings,
}: TaskOverviewProps) {
  const t = useT();
  // 每分钟刷新相对时间（"刚刚/分钟前"不长期停留在旧值）。
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const waiting = sessions.filter((session) => session.status === "waiting");
  const running = sessions.filter(
    (session) =>
      session.status === "running" || session.status === "compacting",
  );
  const rest = sessions.filter(
    (session) =>
      session.status !== "waiting" &&
      session.status !== "running" &&
      session.status !== "compacting",
  );

  const section = (
    title: string,
    count: number,
    tone: string,
    items: SessionInfo[],
    delay: number,
  ) => (
    <section
      className={`animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] ${delay > 0 ? `[animation-delay:${delay}ms]` : ""}`}
    >
      <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
        <span className={`h-[7px] w-[7px] rounded-full ${tone}`} />
        {t(title)}
        {count > 0 && (
          <span className="rounded-full bg-surface-subtle px-1.5 py-px text-[10px] font-bold text-ink-soft">
            {count}
          </span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="px-1 text-[12px] text-ink-muted">
          {t(
            title === "overview.needsYou"
              ? "overview.empty.needsYou"
              : "overview.empty",
          )}
        </p>
      ) : (
        /* 分组卡片容器：一个边框 + 行间分隔线（Linear/Things 风格，
           比“每行一张卡”更安静，也比裸列表更有结构感）。 */
        <div className="overflow-hidden rounded-xl border border-line bg-surface-solid shadow-xs">
          {items.map((session, index) => (
            <SessionRow
              index={index}
              key={session.id}
              onClick={() => onSelect(session.id)}
              pending={pendingId === session.id}
              selected={selectedId === session.id}
              session={session}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-[680px] flex-col overflow-y-auto px-6 pt-5 pb-8 max-[720px]:px-4 max-[720px]:pt-4">
      {/* 顶部操作行：连接状态一句话 + 新建任务主按钮。
          页面标题只出现在工作区 header（ZCode：标题全局唯一，
          正文不再重复大图标 + 大标题区）。 */}
      <div className="mb-5 flex shrink-0 items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-ink-muted">
          <span
            aria-hidden="true"
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${connected ? "bg-green" : "bg-ink-muted"}`}
          />
          <span className="truncate">
            {connected
              ? t("overview.subtitle.connected")
              : t("overview.subtitle.disconnected")}
          </span>
        </p>
        <button
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-blue px-3 text-[12px] font-bold text-white transition-[background-color,transform] duration-150 hover:bg-blue-strong active:scale-[0.97]"
          onClick={onCreate}
          type="button"
        >
          <Icon name="plus" size={14} />
          {t("overview.new")}
        </button>
      </div>
      {!connected && (
        <button
          className="mb-5 flex w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface-solid px-4 py-2.5 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle"
          onClick={onReconnect}
          type="button"
        >
          <span className="h-2 w-2 rounded-full bg-[#8a8f9d]" />
          {t("overview.reconnect")}
        </button>
      )}

      {connected && !hasModels && (
        <section className="mb-6 animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-2xl border border-blue/25 bg-blue-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue text-white">
              <Icon name="sparkle" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block text-[13px] font-extrabold text-ink">
                {t("overview.onboarding.title")}
              </strong>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {t("overview.onboarding.desc")}
              </p>
              <button
                className="mt-2.5 cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white transition-colors duration-150 hover:bg-blue-strong active:scale-[0.98]"
                onClick={onOpenSettings}
                type="button"
              >
                {t("overview.onboarding.cta")}
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="space-y-5">
        {section("overview.needsYou", waiting.length, "bg-amber", waiting, 60)}
        {section("overview.running", running.length, "bg-blue", running, 120)}
        {section("overview.recent", rest.length, "bg-ink-muted", rest, 180)}
      </div>
    </div>
  );
}
