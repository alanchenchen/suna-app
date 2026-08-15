import { Dialog } from "../../components/ui/Dialog";
import { CreateSessionForm } from "./CreateSessionForm";

type SessionDialogsProps = {
  editingTitle: boolean;
  onEditingTitleChange: (open: boolean) => void;
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onRename: () => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  /** 会话历史工作目录（去重），作为项目选择器候选。 */
  knownCwds?: string[];
};

/** 会话级对话框：重命名与新建会话。 */
export function SessionDialogs({
  editingTitle,
  onEditingTitleChange,
  titleDraft,
  onTitleDraftChange,
  onRename,
  createOpen,
  onCreateOpenChange,
  onCreate,
  knownCwds = [],
}: SessionDialogsProps) {
  return (
    <>
      <Dialog
        open={editingTitle}
        onOpenChange={onEditingTitleChange}
        title="重命名会话"
        description="留空可恢复为未命名会话。"
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onRename();
          }}
        >
          <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
            会话标题
            <input
              autoFocus
              className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              onChange={(event) => onTitleDraftChange(event.target.value)}
              value={titleDraft}
            />
          </label>
          <div className="mt-1 flex justify-end gap-2.5">
            <button
              className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
              onClick={() => onEditingTitleChange(false)}
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
      <Dialog
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        title="新建任务"
        description="选择项目目录，Suna 将在此目录内执行任务。"
      >
        <CreateSessionForm
          knownCwds={knownCwds}
          onCancel={() => onCreateOpenChange(false)}
          onCreate={onCreate}
        />
      </Dialog>
    </>
  );
}
