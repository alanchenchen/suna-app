import { Switch } from "../../components/ui/Switch";
import { useT } from "../../lib/i18n";
import type { SkillInfo } from "../../lib/runtimeBridge";
import type { SettingsTabProps } from "./RuntimeSettings";

/** 技能 Tab：启用/禁用 + scope 徽标（原设置面板内容，独立成 Tab）。 */
export function SkillsTab({
  cap,
  items,
  onChanged,
  rpc,
}: SettingsTabProps & { items: SkillInfo[]; onChanged: () => void }) {
  const t = useT();
  if (!cap("skill")) return null;
  return (
    <div>
      <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">
        {t("skills.title")}
      </h3>
      {items.map((skill) => (
        <div
          className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
          key={`${skill.scope ?? "global"}:${skill.name}`}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <strong className="truncate text-ink">{skill.name}</strong>
              {skill.scope === "project" && (
                <span className="rounded-sm bg-surface-raised px-1 py-px text-[10px] font-medium text-ink-muted">
                  {t("skills.project")}
                </span>
              )}
            </span>
            <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
              {skill.description}
            </small>
          </span>
          <Switch
            checked={skill.enabled}
            disabled={skill.can_toggle === false}
            label={t("skills.toggle", { name: skill.name })}
            onCheckedChange={(enabled) =>
              void rpc("skill.set", {
                name: skill.name,
                scope: skill.scope,
                enabled,
              }).then(onChanged)
            }
          />
        </div>
      ))}
    </div>
  );
}
