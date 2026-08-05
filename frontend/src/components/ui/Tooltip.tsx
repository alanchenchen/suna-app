import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * 轻量 Tooltip：给图标按钮等无文字控件补充说明。
 * 提供 Provider 以便页面根部一次包裹。
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] z-40 rounded-lg border border-line bg-surface-solid px-2.5 py-1.5 text-[11px] font-semibold text-ink shadow-md"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-surface-solid" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
