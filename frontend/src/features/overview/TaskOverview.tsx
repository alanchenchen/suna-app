import { Icon } from "../../components/Icon";
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
  /** 界面语言（zh/en），用于双语文案。 */
  locale: string;
};

const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "空闲",
  running: "正在运行",
  waiting: "等待你的回答",
  compacting: "正在压缩上下文",
};

function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(value).toLocaleDateString();
}

/** 中文区块标题 → 英文（总览页三区块）。 */
function titleEn(title: string) {
  if (title === "需要你处理") return "Needs you";
  if (title === "运行中") return "Running";
  if (title === "最近任务") return "Recent";
  return title;
}

function SessionRow({
  session,
  selected,
  pending,
  onClick,
}: {
  session: SessionInfo;
  selected: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`${session.title || "未命名会话"}，${pending ? "正在打开" : statusLabels[session.status]}`}
      className={`grid w-full cursor-pointer grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-[background,transform] duration-180 hover:bg-surface-subtle active:scale-[0.985] disabled:cursor-wait disabled:opacity-60 ${selected ? "bg-surface-solid shadow-sm" : ""}`}
      disabled={pending}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`h-[8px] w-[8px] rounded-full ${session.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue shadow-[0_0_0_5px_var(--color-blue-soft)]" : session.status === "waiting" ? "bg-amber shadow-[0_0_0_5px_var(--color-amber-soft)]" : session.status === "compacting" ? "animate-[breathe_1.8s_ease-in-out_infinite] bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]" : "bg-ink-muted"}`}
      />
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-[13px] font-extrabold text-ink">
          {session.title || "未命名会话"}
        </strong>
        <small className="truncate text-[11px] text-ink-muted">
          {session.cwd}
        </small>
      </span>
      <span className="grid justify-items-end gap-0.5">
        <time className="text-[10px] text-ink-muted">
          {relativeTime(session.updated_at)}
        </time>
        <span
          className={`text-[10px] font-bold ${session.status === "running" ? "text-blue-strong" : session.status === "waiting" ? "text-amber" : "text-ink-muted"}`}
        >
          {pending ? "正在打开…" : statusLabels[session.status]}
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
  locale = "zh",
}: TaskOverviewProps) {
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
      <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
        <span className={`h-2 w-2 rounded-full ${tone}`} />
        {locale === "zh" ? title : titleEn(title)}
        {count > 0 && (
          <span className="rounded-full bg-surface-subtle px-1.5 py-px text-[10px] text-ink-soft">
            {count}
          </span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="px-1 pb-2 text-[12px] text-ink-muted">
          {locale === "zh"
            ? title === "需要你处理"
              ? "没有待处理的事项"
              : "暂无"
            : title === "需要你处理"
              ? "Nothing needs you"
              : "None"}
        </p>
      ) : (
        <div className="space-y-1">
          {items.map((session) => (
            <SessionRow
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
    <div className="mx-auto flex h-full w-full max-w-[560px] flex-col overflow-y-auto px-5 pt-7 pb-8">
      <header className="mb-6 animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-white shadow-[0_8px_24px_rgba(91,103,241,0.32)]">
            <Icon name="sparkle" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-extrabold tracking-tight text-ink">
              {locale === "zh" ? "任务总览" : "Tasks"}
            </h1>
            <p className="text-[12px] text-ink-muted">
              {connected
                ? locale === "zh"
                  ? "Suna Runtime 已连接，随时可接管任务"
                  : "Runtime connected — take over any task"
                : locale === "zh"
                  ? "Suna Runtime 未连接"
                  : "Runtime disconnected"}
            </p>
          </div>
          <button
            aria-label={locale === "zh" ? "新建任务" : "New task"}
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl bg-blue text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[transform,background] duration-150 hover:bg-blue-strong active:scale-90"
            onClick={onCreate}
            type="button"
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
        {!connected && (
          <button
            className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface-solid px-4 py-2.5 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle"
            onClick={onReconnect}
            type="button"
          >
            <span className="h-2 w-2 rounded-full bg-[#8a8f9d]" />
            {locale === "zh" ? "重新连接 Runtime" : "Reconnect Runtime"}
          </button>
        )}
      </header>

      {connected && !hasModels && (
        <section className="mb-6 animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-2xl border border-blue/25 bg-blue-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue text-white shadow-[0_4px_10px_var(--color-blue-glow)]">
              <Icon name="sparkle" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block text-[13px] font-extrabold text-ink">
                {locale === "zh"
                  ? "配置一个模型开始使用"
                  : "Configure a model to get started"}
              </strong>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {locale === "zh"
                  ? "Suna 还没有可用的模型。添加模型（如 DeepSeek）后即可新建任务。"
                  : "No model configured yet. Add one (e.g. DeepSeek) to start new tasks."}
              </p>
              <button
                className="mt-2.5 cursor-pointer rounded-lg bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_6px_16px_var(--color-blue-glow)] active:scale-[0.98]"
                onClick={onOpenSettings}
                type="button"
              >
                {locale === "zh" ? "去配置模型" : "Configure model"}
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="space-y-6">
        {section("需要你处理", waiting.length, "bg-amber", waiting, 60)}
        {section("运行中", running.length, "bg-blue", running, 120)}
        {section("最近会话", rest.length, "bg-ink-muted", rest, 180)}
      </div>
    </div>
  );
}
