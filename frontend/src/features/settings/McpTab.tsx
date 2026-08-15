import { Switch } from "../../components/ui/Switch";
import type { SettingsTabProps } from "./RuntimeSettings";

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

/** 外部工具 Tab：MCP 服务管理（原设置面板内容，独立成 Tab）。 */
export function McpTab({ cap, mcpServers, refreshMcp, rpc }: SettingsTabProps) {
  if (!cap("mcp")) return null;
  return (
    <div>
      <h3 className="m-0 mb-2 text-[13px] font-extrabold text-ink">外部工具</h3>
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
                  void rpc("mcp.reload", { name: server.name }).then(refreshMcp)
                }
                type="button"
              >
                重载
              </button>
              <Switch
                checked={state === "active" || state === "starting"}
                disabled={state === "starting"}
                label={`启用外部工具 ${server.name}`}
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
