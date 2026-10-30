import { type McpServerConfig, mcpConfigErrors, normalizeMcpConfig } from "@openbot/contracts/ipc";

/**
 * What the MCP server page edits: one field for each argument, variable and header, as on desktop.
 * Both transports keep their fields, so a switch back to the other transport keeps what the user typed.
 */
export type McpServerDraft = Omit<McpServerConfig, "id" | "enabled">;

export function mcpServerDraft(config: McpServerConfig | undefined): McpServerDraft {
  return {
    name: config?.name ?? "",
    transport: config?.transport ?? "stdio",
    command: config?.command ?? "",
    args: [...(config?.args ?? [])],
    env: config?.env.map((pair) => ({ ...pair })) ?? [],
    envPassthrough: [...(config?.envPassthrough ?? [])],
    workingDirectory: config?.workingDirectory ?? "",
    url: config?.url ?? "",
    headers: config?.headers.map((pair) => ({ ...pair })) ?? [],
  };
}

/** The configuration that a save or a test sends. `normalizeMcpConfig` drops the empty fields. */
export function mcpServerConfig(draft: McpServerDraft, id: string, enabled: boolean): McpServerConfig {
  return normalizeMcpConfig({ ...draft, id, enabled });
}

/** Whether the draft holds a change worth saving. Empty fields and the fields of the other transport do not count. */
export function mcpServerDraftChanged(draft: McpServerDraft, saved: McpServerConfig | undefined): boolean {
  const config = mcpServerConfig(draft, saved?.id ?? "", saved?.enabled ?? true);
  if (!saved) return JSON.stringify(config) !== JSON.stringify(mcpServerConfig(mcpServerDraft(undefined), "", true));
  return JSON.stringify(config) !== JSON.stringify(normalizeMcpConfig(saved));
}

/** Which fields stop a save. The page shows its own text: these messages are English only. */
export function mcpServerDraftErrors(config: McpServerConfig): { name: boolean; command: boolean; url: boolean } {
  const errors = mcpConfigErrors(config);
  return { name: Boolean(errors.name), command: Boolean(errors.command), url: Boolean(errors.url) };
}

/** The second line of a row: the command and its arguments, or the address. */
export function mcpServerDetail(config: McpServerConfig): string {
  return config.transport === "http" ? config.url : [config.command, ...config.args].join(" ");
}
