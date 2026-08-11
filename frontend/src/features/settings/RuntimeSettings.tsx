import { useCallback, useEffect, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import type { Theme } from "../../lib/models";
import type {
  MCPServerInfo,
  MemoryItem,
  RuntimeConfig,
  SkillInfo,
} from "../../lib/runtimeBridge";
import type { useRuntimeBridge } from "../runtime/useRuntimeBridge";

type SettingsProps = {
  cap: (name: string) => boolean;
  config?: RuntimeConfig;
  mcpServers: MCPServerInfo[];
  onConfig: (config: RuntimeConfig) => void;
  onClose: () => void;
  refreshMcp: () => void;
  rpc: ReturnType<typeof useRuntimeBridge>["rpc"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

/** Runtime 能力设置面板：主题、默认模型、记忆、技能与 MCP 服务。 */
export function RuntimeSettings({
  cap,
  config,
  mcpServers,
  onConfig,
  onClose,
  refreshMcp,
  rpc,
  theme,
  onThemeChange,
}: SettingsProps) {
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      if (cap("memory")) setMemory((await rpc("memory.list", {})).memories);
      if (cap("skill")) setSkills((await rpc("skill.list", {})).skills);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载设置。");
    }
  }, [cap, rpc]);
  useEffect(() => {
    void load();
    if (cap("mcp")) refreshMcp();
  }, [cap, load, refreshMcp]);
  return (
    <section
      aria-label="Runtime 设置"
      className="animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] runtime-settings overflow-auto rounded-2xl border border-line bg-surface-solid p-4 shadow-lg"
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
            能力设置
          </p>
          <h2 className="mt-1 text-[16px] font-extrabold text-ink">
            Runtime 设置
          </h2>
        </div>
        <IconButton label="关闭设置" onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </div>
      {error && <p className="text-[12px] font-semibold text-rose">{error}</p>}
      <div className="mt-3.5 border-t border-line pt-3">
        <label className="grid gap-1.5 text-[11px] font-bold tracking-wide text-ink-soft">
          主题
          <div className="flex gap-1.5">
            {(
              [
                ["system", "跟随系统"],
                ["light", "浅色"],
                ["dark", "深色"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-colors duration-150 ${
                  theme === value
                    ? "border-blue/60 bg-blue-soft text-blue-strong"
                    : "border-line bg-surface-raised text-ink-soft hover:bg-surface-subtle"
                }`}
                key={value}
                onClick={() => {
                  const next = value as Theme;
                  // 同步写入 DOM，避免 View Transition 或异步状态导致切换不生效。
                  document.documentElement.dataset.theme =
                    next === "system"
                      ? window.matchMedia("(prefers-color-scheme: dark)")
                          .matches
                        ? "dark"
                        : "light"
                      : next;
                  onThemeChange(next);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </label>
      </div>
      {cap("config") && config && (
        <div className="border-t border-line pt-3 mt-3.5">
          <label className="grid gap-1.5 text-[11px] font-bold tracking-wide text-ink-soft">
            默认模型
            <Select
              ariaLabel="默认模型"
              onValueChange={(value) =>
                void rpc("config.set", {
                  action: "activate_model",
                  active_model: value,
                }).then(onConfig)
              }
              options={config.models.map((model) => {
                const ref = `${model.provider}/${model.model}`;
                return { value: ref, label: ref };
              })}
              value={config.active_model}
            />
          </label>
        </div>
      )}
      {cap("memory") && (
        <div className="border-t border-line pt-3 mt-3.5">
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-[13px] font-bold text-ink">记忆</h3>
            {memory.length > 0 && (
              <button
                className="cursor-pointer text-[11px] font-bold text-rose transition-opacity duration-150 hover:opacity-75"
                onClick={() => {
                  if (window.confirm("清除所有记忆？此操作无法撤销。"))
                    void rpc("memory.clear", {}).then(() => load());
                }}
                type="button"
              >
                清空全部
              </button>
            )}
          </div>
          {memory.length ? (
            memory.map((item) => (
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
                      void rpc("memory.delete", { id: item.id }).then(() =>
                        load(),
                      );
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
      )}
      {cap("skill") && (
        <div className="border-t border-line pt-3 mt-3.5">
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">技能</h3>
          {skills.map((skill) => (
            <div
              className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
              key={skill.name}
            >
              <span className="min-w-0">
                <strong className="block truncate text-ink">
                  {skill.name}
                </strong>
                <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
                  {skill.description}
                </small>
              </span>
              <Switch
                checked={skill.enabled}
                label={`启用技能 ${skill.name}`}
                onCheckedChange={(enabled) =>
                  void rpc("skill.set", {
                    name: skill.name,
                    enabled,
                  }).then(() => load())
                }
              />
            </div>
          ))}
        </div>
      )}
      {cap("mcp") && (
        <div className="border-t border-line pt-3 mt-3.5">
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">MCP 服务</h3>
          {mcpServers.map((server) => {
            const state =
              server.state ?? (server.active ? "active" : "disabled");
            return (
              <div
                className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"
                key={server.name}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <strong className="truncate text-ink">{server.name}</strong>
                    <MCPStateBadge state={state} />
                  </span>
                  <small className="mt-0.5 block truncate text-[11px] font-normal text-ink-muted">
                    {server.transport ? `${server.transport} · ` : ""}
                    {server.tool_count} 个工具
                  </small>
                  {server.error && (
                    <small className="mt-0.5 block truncate text-[11px] font-normal text-rose">
                      {server.error}
                    </small>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    className="cursor-pointer text-[11px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
                    onClick={() =>
                      void rpc("mcp.reload", { name: server.name }).then(
                        refreshMcp,
                      )
                    }
                    type="button"
                  >
                    重载
                  </button>
                  <Switch
                    checked={state === "active" || state === "starting"}
                    disabled={state === "starting"}
                    label={`启用 MCP 服务 ${server.name}`}
                    onCheckedChange={(active) =>
                      void rpc("mcp.toggle", {
                        name: server.name,
                        active,
                      }).then(refreshMcp)
                    }
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!loaded && (
        <p className="text-[13px] text-ink-muted">正在加载可用设置…</p>
      )}
    </section>
  );
}

/** MCP server 状态徽章：文字 + 图标 + 颜色三重表达（不只用颜色）。 */
function MCPStateBadge({ state }: { state: string }) {
  const config: Record<string, { label: string; cls: string; dot: string }> = {
    starting: {
      label: "加载中",
      cls: "bg-amber-soft text-amber-strong",
      dot: "bg-amber",
    },
    active: {
      label: "已启用",
      cls: "bg-emerald-soft text-emerald-strong",
      dot: "bg-emerald",
    },
    error: {
      label: "失败",
      cls: "bg-rose-soft text-rose-strong",
      dot: "bg-rose",
    },
    disabled: {
      label: "已禁用",
      cls: "bg-surface-subtle text-ink-muted",
      dot: "bg-ink-muted",
    },
  };
  const item = config[state] ?? config.disabled;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${item.cls}`}
    >
      <span className={`size-1.5 rounded-full ${item.dot}`} />
      {item.label}
    </span>
  );
}
