import { Switch } from "../../components/ui/Switch";
import { useT } from "../../lib/i18n";
import type { SettingsTabProps } from "./RuntimeSettings";

/** MCP server 状态徽章：文字 + 图标 + 颜色三重表达（不只用颜色）。 */
function MCPStateBadge({ state }: { state: string }) {
  const t = useT();
  const config: Record<string, { label: string; cls: string; dot: string }> = {
    starting: {
      label: t("mcp.loading"),
      cls: "bg-amber-soft text-amber-strong",
      dot: "bg-amber",
    },
    active: {
      label: t("mcp.enabled"),
      cls: "bg-emerald-soft text-emerald-strong",
      dot: "bg-emerald",
    },
    error: {
      label: t("mcp.failed"),
      cls: "bg-rose-soft text-rose-strong",
      dot: "bg-rose",
    },
    disabled: {
      label: t("mcp.disabled"),
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

/** 外部工具 Tab：MCP 服务管理（原设置面板内容，独立成 Tab）。 */
export function McpTab({ cap, mcpServers, refreshMcp, rpc }: SettingsTabProps) {
  const t = useT();
  if (!cap("mcp")) return null;
  return (
    <div>
      <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">
        {t("mcp.title")}
      </h3>
      {mcpServers.map((server) => {
        const state = server.state ?? (server.active ? "active" : "disabled");
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
                {t("mcp.toolCount", { count: server.tool_count })}
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
                  void rpc("mcp.reload", { name: server.name }).then(refreshMcp)
                }
                type="button"
              >
                {t("mcp.reload")}
              </button>
              <Switch
                checked={state === "active" || state === "starting"}
                disabled={state === "starting"}
                label={t("mcp.toggle", { name: server.name })}
                onCheckedChange={(active) =>
                  void rpc("mcp.toggle", { name: server.name, active }).then(
                    refreshMcp,
                  )
                }
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
