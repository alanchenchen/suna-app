import type { ReactNode, Ref } from "react";

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
  | "sparkle"
  | "sun"
  | "warning";

const icons: Record<IconName, string> = {
  "arrow-up": "M12 19V5m-6 6 6-6 6 6",
  check: "m5 12 4 4L19 6",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  close: "M18 6 6 18M6 6l12 12",
  ellipsis: "M5 12h.01M12 12h.01M19 12h.01",
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  message:
    "M21 11.5a8.2 8.2 0 0 1-9 8.2 8.5 8.5 0 0 1-3.7-.9L3 20l1.3-4a8.2 8.2 0 1 1 16.7-4.5Z",
  moon: "M20.7 15.1A8.6 8.6 0 0 1 8.9 3.3 8.8 8.8 0 1 0 20.7 15Z",
  panel:
    "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm11-2v18",
  pause: "M7 5v14M17 5v14",
  plus: "M12 5v14M5 12h14",
  search: "m21 21-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  sparkle:
    "m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3ZM5 16l-.7 2.3L2 19l2.3.7L5 22l.7-2.3L8 19l-2.3-.7L5 16Z",
  sun: "M12 3v1m0 16v1M3 12h1m16 0h1m-2.6-6.4.7-.7M5.6 18.4l.7-.7m12.1.7-.7-.7M5.6 5.6l.7.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  warning:
    "M12 9v4m0 4h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d={icons[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
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
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
}) {
  return (
    <button
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-label={label}
      className={`icon-button ${className}`}
      disabled={disabled}
      onClick={onClick}
      ref={buttonRef}
      type="button"
    >
      {children}
    </button>
  );
}
