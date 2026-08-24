import { useEffect, useRef } from "react";
import { Dialog } from "./Dialog";
import { useT } from "../../lib/i18n";

/**
 * 应用内确认弹窗：替代 window.confirm（浏览器原生弹窗在 PWA/桌面场景
 * 突兀且样式不一致）。自管打开/关闭动画，危险操作红色确认按钮。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** 危险操作（删除等）用红色确认按钮。 */
  danger?: boolean;
  /** 确认进行中（禁用按钮防连点）。 */
  busy?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  // 打开时聚焦确认按钮（危险操作需明确聚焦到确认，减少误触）。
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Dialog
      description={description}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
          disabled={busy}
          onClick={() => onOpenChange(false)}
          type="button"
        >
          {cancelLabel ?? t("common.cancel")}
        </button>
        <button
          className={`cursor-pointer rounded-lg px-3.5 py-2 text-[12px] font-bold text-white transition-[transform,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${
            danger
              ? "bg-rose shadow-[0_4px_10px_rgba(244,63,94,0.25)] hover:bg-rose/90"
              : "bg-blue shadow-[0_4px_10px_var(--color-blue-glow)] hover:bg-blue-strong"
          }`}
          disabled={busy}
          onClick={onConfirm}
          ref={confirmRef}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
