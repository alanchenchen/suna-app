import type { ReactNode, Ref } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  MessageSquare,
  Moon,
  PanelRight,
  Pause,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  TriangleAlert,
  Users,
  Wrench,
  X,
  type LucideProps,
} from "lucide-react";

export type IconName =
  | "arrow-up"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "ellipsis"
  | "folder"
  | "message"
  | "moon"
  | "panel"
  | "pause"
  | "plus"
  | "search"
  | "settings"
  | "sparkle"
  | "sun"
  | "tool"
  | "users"
  | "warning";

const icons: Record<IconName, React.ComponentType<LucideProps>> = {
  "arrow-up": ArrowUp,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  close: X,
  ellipsis: Ellipsis,
  folder: Folder,
  message: MessageSquare,
  moon: Moon,
  panel: PanelRight,
  pause: Pause,
  plus: Plus,
  search: Search,
  settings: Settings,
  sparkle: Sparkles,
  sun: Sun,
  tool: Wrench,
  users: Users,
  warning: TriangleAlert,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const LucideIcon = icons[name];
  return <LucideIcon aria-hidden="true" size={size} strokeWidth={1.8} />;
}

export function IconButton({
  label,
  children,
  onClick,
  className = "",
  ariaExpanded,
  ariaControls,
  buttonRef,
  disabled,
  ref,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  /** React 19 ref-as-prop：供 Radix Trigger asChild 注入 ref。 */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-label={label}
      className={`icon-button ${className}`}
      disabled={disabled}
      onClick={onClick}
      ref={ref ?? buttonRef}
      type="button"
    >
      {children}
    </button>
  );
}
