import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * 轻量 Dialog 封装：焦点陷阱、Esc 关闭、遮罩点击关闭由 Radix 提供，
 * 视觉完全由 Tailwind 原子类控制。
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-[scrim-in_200ms_ease_both] fixed inset-0 z-30 bg-[rgb(15_18_28_/_0.55)]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] fixed top-1/2 left-1/2 z-30 grid w-[min(100%,440px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl border border-line bg-surface-solid p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-extrabold tracking-tight text-ink">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  {description}
                </p>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
