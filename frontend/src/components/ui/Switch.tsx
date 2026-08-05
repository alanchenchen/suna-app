import * as SwitchPrimitive from "@radix-ui/react-switch";

/**
 * 设置项开关：Radix Switch 提供键盘与无障碍语义，视觉用 Tailwind 定制。
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      checked={checked}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-subtle transition-colors duration-160 data-[state=checked]:border-transparent data-[state=checked]:bg-blue disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <SwitchPrimitive.Thumb className="block h-[16px] w-[16px] translate-x-[3px] rounded-full bg-ink-muted shadow-sm transition-transform duration-160 data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
}
