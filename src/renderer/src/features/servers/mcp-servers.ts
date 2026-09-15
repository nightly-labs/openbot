/**
 * What the MCP settings panel needs beyond the shared contract: a blank draft, a reopened draft,
 * the dirty check, and the badge text and variant.
 *
 * The types and the rules the main process also applies - validation, normalization, the id - live
 * in `@openbot/contracts/ipc` so that a saved row can never hold something the form never previewed.
 */

import { type McpServerConfig, normalizeMcpConfig } from "@openbot/contracts/ipc";

export type {
  McpConfigErrors,
  McpKeyValue,
  McpServerConfig,
  McpTestResult,
  McpTransport,
} from "@openbot/contracts/ipc";
export { createMcpServerId, mcpConfigErrors, mcpConfigIsValid, normalizeMcpConfig } from "@openbot/contracts/ipc";

/** The badge variants this panel uses, narrowed from the shared `Badge` set. */
export type McpStatusVariant = "success-light" | "destructive-light" | "secondary";

/**
 * What the panel knows about one server's test, for as long as the panel is open.
 *
 * A test is a question the user asked once, not a state the app keeps: OpenBot connects only when
 * asked, and an answer from a minute ago is not a claim about now. Leaving the panel drops these.
 */
export type McpTestState =
  | { status: "testing" }
  | { status: "passed"; toolCount: number }
  | { status: "failed"; error: string };

/** The whole sentence a test produced, for the form. The row shows the short badge instead. */
export function mcpTestMessage(test: McpTestState): string {
  if (test.status === "testing") return "Connecting…";
  if (test.status === "failed") return test.error;
  return test.toolCount === 1 ? "Connected · 1 tool" : `Connected · ${test.toolCount} tools`;
}

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

/**
 * The badge on a row. Without a test it says only what the user set, because that is all OpenBot
 * knows: a server is offered to this server's agents, or it is not. A test answers for itself, and
 * that answer is shown even on a server that is turned off, because the user asked for it.
 */
export function mcpStatusLabel(config: McpServerConfig, test?: McpTestState): string {
  if (test?.status === "testing") return "Testing…";
  if (test?.status === "failed") return "Failed";
  if (test) return mcpTestMessage(test);
  return config.enabled ? "Enabled" : "Disabled";
}

export function mcpStatusVariant(test?: McpTestState): McpStatusVariant {
  if (test?.status === "failed") return "destructive-light";
  if (test?.status === "passed") return "success-light";
  return "secondary";
}
