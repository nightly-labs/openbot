/**
 * What the MCP settings panel needs beyond the shared contract: a blank draft, a reopened draft,
 * the dirty check, and the badge text and variant.
 *
 * The types and the rules the main process also applies - validation, normalization, the id - live
 * in `@openbot/contracts/ipc` so that a saved row can never hold something the form never previewed.
 */

import { type McpServerConfig, type McpServerEntry, normalizeMcpConfig } from "@openbot/contracts/ipc";

export type {
  McpConfigErrors,
  McpConnectionState,
  McpKeyValue,
  McpServerConfig,
  McpServerEntry,
  McpServerStatus,
  McpTransport,
} from "@openbot/contracts/ipc";
export { createMcpServerId, mcpConfigErrors, mcpConfigIsValid, normalizeMcpConfig } from "@openbot/contracts/ipc";

/** The badge variants this panel uses, narrowed from the shared `Badge` set. */
export type McpStatusVariant = "success-light" | "destructive-light" | "secondary";

/**
 * A blank draft. Each repeatable list starts with one empty row so the form opens showing the row
 * shape rather than only an "Add" button.
 */
export function emptyMcpConfig(): McpServerConfig {
  return {
    id: "",
    name: "",
    transport: "stdio",
    enabled: true,
    command: "",
    args: [""],
    env: [{ key: "", value: "" }],
    envPassthrough: [""],
    workingDirectory: "",
    url: "",
    headers: [{ key: "", value: "" }],
  };
}

/**
 * An existing configuration reopened for editing. Saving strips the empty rows, so a stored
 * configuration has none; put one back in each list to give the user somewhere to type.
 */
export function mcpConfigDraft(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    args: config.args.length > 0 ? [...config.args] : [""],
    env: config.env.length > 0 ? config.env.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
    envPassthrough: config.envPassthrough.length > 0 ? [...config.envPassthrough] : [""],
    headers: config.headers.length > 0 ? config.headers.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
  };
}

/**
 * Whether the form holds a change worth saving. The comparison is between the normalized values, so
 * adding an empty row, or typing a trailing space, does not count as an edit.
 */
export function mcpConfigChanged(draft: McpServerConfig, baseline: McpServerConfig): boolean {
  return JSON.stringify(normalizeMcpConfig(draft)) !== JSON.stringify(normalizeMcpConfig(baseline));
}

export function mcpStatusLabel(entry: McpServerEntry): string {
  if (!entry.config.enabled || entry.state === "disabled") return "Disabled";
  if (entry.state === "connecting") return "Connecting…";
  if (entry.state === "failed") return "Failed";
  return entry.toolCount === 1 ? "Connected · 1 tool" : `Connected · ${entry.toolCount} tools`;
}

export function mcpStatusVariant(entry: McpServerEntry): McpStatusVariant {
  if (!entry.config.enabled || entry.state === "disabled") return "secondary";
  if (entry.state === "failed") return "destructive-light";
  return entry.state === "connected" ? "success-light" : "secondary";
}
