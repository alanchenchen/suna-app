import { useState } from "react";
import type { SettingsTabProps } from "./RuntimeSettings";

/** Guard 模式：面向用户的日常语言（设计 §10.3）。 */
const GUARD_MODES = [
  { value: "readonly", label: "只读（仅查看）", desc: "禁止一切修改操作" },
  { value: "ask", label: "每次确认", desc: "每次修改前都询问你" },
  { value: "auto", label: "自动放行", desc: "不询问，直接执行" },
  {
    value: "smart",
    label: "智能确认",
    desc: "低风险自动执行，高风险询问（推荐）",
  },
] as const;

/** 安全 Tab：Guard 确认模式 + 工作目录（设计 §10.3）。 */
export function SecurityTab({ config, onConfig, rpc }: SettingsTabProps) {
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState<string>();

  async function setMode(mode: string) {
    if (!config || saving) return;
    setSaving(mode);
    setError(undefined);
    try {
      const next = await rpc("config.set", {
        action: "update_general",
        guard_mode: mode,
      });
      onConfig(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存确认模式。");
    } finally {
      setSaving(undefined);
    }
  }

  if (!config) return null;
  const current = config.guard_mode ?? "smart";

  return (
    <div className="grid gap-4">
      <section>
        <h3 className="m-0 mb-1 text-[13px] font-extrabold text-ink">
          操作确认
        </h3>
        <p className="mt-0 mb-3 text-[12px] leading-relaxed text-ink-muted">
          Suna 在执行修改操作前如何征得你的同意。
        </p>
        <div className="grid gap-2">
          {GUARD_MODES.map((mode) => (
            <button
              aria-pressed={current === mode.value}
              className={`cursor-pointer rounded-xl border p-3 text-left transition-colors duration-150 ${
                current === mode.value
                  ? "border-blue/50 bg-blue-soft/60"
                  : "border-line bg-surface-raised/50 hover:bg-surface-subtle"
              }`}
              disabled={saving === mode.value}
              key={mode.value}
              onClick={() => void setMode(mode.value)}
              type="button"
            >
              <span className="flex items-center justify-between">
                <strong className="text-[13px] font-extrabold text-ink">
                  {mode.label}
                </strong>
                {current === mode.value && (
                  <span className="rounded-sm bg-blue-soft px-1.5 py-px text-[10px] font-bold text-blue-strong">
                    当前
                  </span>
                )}
              </span>
              <small className="mt-0.5 block text-[11.5px] text-ink-muted">
                {mode.desc}
              </small>
            </button>
          ))}
        </div>
        {error && (
          <small className="mt-2 block text-[12px] font-semibold text-rose">
            {error}
          </small>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface-raised/50 p-3.5">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">工作目录</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          Suna 只能在此目录内执行操作，目录之外的操作会被拒绝。
        </p>
        <code className="mt-2 block truncate rounded-lg bg-surface-raised px-2.5 py-2 font-mono text-[12px] text-ink">
          {config.workspace || "（未设置）"}
        </code>
      </section>
    </div>
  );
}
