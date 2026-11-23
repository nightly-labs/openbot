import { type McpServerConfig, mcpConfigErrors, normalizeMcpConfig } from "@openbot/contracts/ipc";

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

export function mcpServerConfig(draft: McpServerDraft, id: string, enabled: boolean): McpServerConfig {
  return normalizeMcpConfig({ ...draft, id, enabled });
}

export function mcpServerDraftChanged(draft: McpServerDraft, saved: McpServerConfig | undefined): boolean {
  const config = mcpServerConfig(draft, saved?.id ?? "", saved?.enabled ?? true);
  if (!saved) return JSON.stringify(config) !== JSON.stringify(mcpServerConfig(mcpServerDraft(undefined), "", true));
  return JSON.stringify(config) !== JSON.stringify(normalizeMcpConfig(saved));
}

export function mcpServerDraftErrors(config: McpServerConfig): {
  name: boolean;
  command: boolean;
  url: boolean;
  headers: string | null;
} {
  const errors = mcpConfigErrors(config);
  return {
    name: Boolean(errors.name),
    command: Boolean(errors.command),
    url: Boolean(errors.url),
    headers: errors.headers ?? null,
  };
}

export function mcpServerDetail(config: McpServerConfig): string {
  return config.transport === "http" ? config.url : [config.command, ...config.args].join(" ");
}
