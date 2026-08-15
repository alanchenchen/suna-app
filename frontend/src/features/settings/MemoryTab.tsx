import type { MemoryItem } from "../../lib/runtimeBridge";
import type { SettingsTabProps } from "./RuntimeSettings";

/** 记忆 Tab：列表 + 删除 + 清空（原设置面板内容，独立成 Tab）。 */
export function MemoryTab({
  cap,
  items,
  onChanged,
  rpc,
}: SettingsTabProps & { items: MemoryItem[]; onChanged: () => void }) {
  if (!cap("memory")) return null;
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">记忆</h3>
        {items.length > 0 && (
          <button
            className="cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
            onClick={() => {
              if (window.confirm("清除所有记忆？此操作无法撤销。"))
                void rpc("memory.clear", {}).then(onChanged);
            }}
            type="button"
          >
            清空全部
          </button>
        )}
      </div>
      {items.length ? (
        items.map((item) => (
          <div
            className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
            key={item.id}
          >
            <span className="min-w-0">
              <strong className="block truncate text-ink">
                {item.content}
              </strong>
              <small className="mt-0.5 block text-[11px] font-normal text-ink-muted">
                {item.kind} · 优先级 {item.priority}
              </small>
            </span>
            <button
              className="shrink-0 cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
              onClick={() => {
                if (window.confirm("删除这条记忆？"))
                  void rpc("memory.delete", { id: item.id }).then(onChanged);
              }}
              type="button"
            >
              删除
            </button>
          </div>
        ))
      ) : (
        <p className="text-[13px] text-ink-muted">没有可用记忆。</p>
      )}
    </div>
  );
}
