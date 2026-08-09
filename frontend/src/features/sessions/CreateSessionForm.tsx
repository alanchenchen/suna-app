import { useState } from "react";

type CreateSessionFormProps = {
  onCancel: () => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
};

/** 新建会话表单：工作目录 + 可选标题，创建成功由父组件关闭弹窗。 */
export function CreateSessionForm({
  onCancel,
  onCreate,
}: CreateSessionFormProps) {
  const [cwd, setCwd] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!cwd.trim()) {
      setError("请输入工作目录。");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onCreate(cwd.trim(), title.trim() || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建会话。");
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
        工作目录
        <input
          autoFocus
          className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
          disabled={submitting}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/Users/me/project"
          value={cwd}
        />
      </label>
      <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        标题（可选）
        <input
          className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="新任务"
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
          取消
        </button>
        <button
          className="cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "正在创建…" : "创建会话"}
        </button>
      </div>
    </form>
  );
}
