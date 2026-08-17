import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";

type CreateSessionFormProps = {
  onCancel: () => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  /** 会话历史中的工作目录（去重），作为候选来源之一。 */
  knownCwds?: string[];
};

/** localStorage 键：最近使用的项目（最多 5 个，最新的在前）。 */
const RECENT_KEY = "suna-app:recent-projects";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/** 记录一次成功创建的项目：去重 + 最新在前 + 截断到上限。 */
export function rememberRecentCwd(cwd: string) {
  try {
    const next = [cwd, ...loadRecent().filter((value) => value !== cwd)].slice(
      0,
      RECENT_MAX,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默失败，不影响创建流程。
  }
}

function projectName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return base || cwd;
}

/** 展开项目（cwd）列表：手输关键词时同时过滤最近与历史。 */
function useProjectCandidates(knownCwds: string[]) {
  const [query, setQuery] = useState("");
  const recent = useMemo(loadRecent, []);
  // 合并候选：最近优先，其余按历史顺序；去重保留首次出现。
  const all = useMemo(
    () =>
      [...recent, ...knownCwds].filter(
        (value, index, list) => list.indexOf(value) === index,
      ),
    [recent, knownCwds],
  );
  const filtered = useMemo(() => {
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((cwd) => {
      const full = cwd.toLowerCase();
      return full.includes(q) || projectName(cwd).toLowerCase().includes(q);
    });
  }, [all, query]);
  return { query, setQuery, filtered };
}

/** 新建会话表单：项目选择器（必选但零输入）。
 * 候选 = localStorage 最近使用 + 会话历史去重；默认选中第一项回车即创建；
 * 手动输入保留（新项目场景）。 */
export function CreateSessionForm({
  onCancel,
  onCreate,
  knownCwds = [],
}: CreateSessionFormProps) {
  const { query, setQuery, filtered } = useProjectCandidates(knownCwds);
  const [selected, setSelected] = useState<string>(() => filtered[0] ?? "");
  const [manual, setManual] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  // 生效 cwd：手动输入 > 点选候选 > 搜索无候选时直接用输入值
  // （有候选时必须点选，避免把部分输入当成路径）；
  // 例外：输入恰好等于某候选的完整路径时自动选中（回车即创建）。
  const exactMatch = filtered.find((cwd) => cwd === query.trim());
  const effectiveCwd = manualOpen
    ? manual.trim()
    : selected || exactMatch || (filtered.length === 0 ? query.trim() : "");
  const t = useT();

  async function submit() {
    if (!effectiveCwd) {
      setError(t("create.error.required"));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onCreate(effectiveCwd, title.trim() || undefined);
      rememberRecentCwd(effectiveCwd);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("create.error.failed"),
      );
      setSubmitting(false);
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        {t("create.project")}
        <span className="grid gap-1.5">
          <span className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-ink-muted">
              <Icon name="search" size={13} />
            </span>
            <input
              className="w-full rounded-lg border border-line bg-surface-raised py-2 pr-2.5 pl-8 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              disabled={submitting}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected("");
              }}
              placeholder={t("create.searchPlaceholder")}
              value={query}
            />
          </span>
          {filtered.length > 0 && (
            <span className="grid max-h-[180px] gap-0.5 overflow-auto">
              {filtered.map((cwd) => (
                <button
                  className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors duration-100 ${
                    selected === cwd
                      ? "border-blue/40 bg-blue-soft/70"
                      : "border-transparent hover:bg-surface-subtle"
                  }`}
                  key={cwd}
                  onClick={() => {
                    setSelected(cwd);
                    setManualOpen(false);
                    setManual("");
                  }}
                  type="button"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-subtle text-ink-muted">
                    <Icon name="folder" size={13} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-[12px] font-extrabold text-ink">
                      {projectName(cwd)}
                    </strong>
                    <small className="block truncate font-mono text-[10px] text-ink-muted">
                      {cwd}
                    </small>
                  </span>
                  {selected === cwd && (
                    <Icon
                      className="ml-auto shrink-0 text-blue-strong"
                      name="check"
                      size={13}
                    />
                  )}
                </button>
              ))}
            </span>
          )}
        </span>
      </label>
      {!manualOpen ? (
        <button
          className="w-fit cursor-pointer text-[12px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
          onClick={() => {
            setManualOpen(true);
            setSelected("");
          }}
          type="button"
        >
          {t("create.manualPath")}
        </button>
      ) : (
        <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
          {t("create.newPath")}
          <input
            autoFocus
            className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 font-mono text-[12px] text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
            disabled={submitting}
            onChange={(event) => setManual(event.target.value)}
            placeholder="/Users/me/new-project"
            value={manual}
          />
        </label>
      )}
      <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        {t("create.titleOptional")}
        <input
          className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("create.titlePlaceholder")}
          value={title}
        />
      </label>
      {error && (
        <small className="text-[12px] font-semibold text-rose">{error}</small>
      )}
      <div className="mt-1 flex justify-end gap-2.5">
        <button
          className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
          disabled={submitting}
          onClick={onCancel}
          type="button"
        >
          {t("create.cancel")}
        </button>
        <button
          className="cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting || !effectiveCwd}
          type="submit"
        >
          {submitting ? t("create.creating") : t("create.create")}
        </button>
      </div>
    </form>
  );
}
