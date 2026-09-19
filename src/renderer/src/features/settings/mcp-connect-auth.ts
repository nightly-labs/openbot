/**
 * The ways into an MCP server, as the listing declares them.
 *
 * A server does not have one way in with exceptions under it. It has the ways its own account system
 * offers: a sign-in in the browser, a key from a settings page, sometimes both, sometimes neither.
 * So a listing declares a list of flows, and the dialog shows the ones that exist - the first is
 * the one it opens on, and a second is a choice, not a fallback.
 *
 * A flow is what the user does, plus where what they get is written. `kind` names the doing:
 * `"link"` leaves for the browser and comes back with a grant, `"key"` is a value typed into a
 * header or an environment variable. A new way in is a new `kind` here, not a flag on this one.
 *
 * The flow shapes are in `@openbot/contracts/ipc`, because a listing declares them and the
 * openbot.run page reads the same declaration to say whether a plugin wants a sign-in or a key.
 * What stays here is what only this side does: the form state, and writing a typed value into the
 * configuration that connects.
 */

import type { McpAuthField, McpConnectFlow, McpKeyValue, McpServerConfig } from "@openbot/contracts/ipc";

export type { McpAuth, McpAuthField, McpConnectFlow, McpKeyFlow, McpLinkFlow } from "@openbot/contracts/ipc";

/** What the user has typed in the current flow, keyed by field id. */
export type McpAuthValues = Record<string, string>;

/** The flow's fields all have a value. A flow with no fields is complete by asking for nothing. */
export function mcpFlowComplete(flow: McpConnectFlow | null | undefined, values: McpAuthValues): boolean {
  return mcpFlowFields(flow).every((field) => (values[field.id] ?? "").trim().length > 0);
}

/** What this flow asks the user to type. A sign-in asks for nothing here; the browser asks. */
export function mcpFlowFields(flow: McpConnectFlow | null | undefined): McpAuthField[] {
  return flow?.kind === "key" ? flow.fields : [];
}

/**
 * The configuration to connect with: the base the listing states, plus the typed credentials in the
 * places the flow names.
 *
 * The value is written as typed, with only the prefix added. `normalizeMcpConfig` keeps header and
 * environment values exactly as given for the same reason: a token that ends in a space is a
 * different token, and a credential the app quietly edits is a credential the server rejects.
 *
 * A field whose value is blank is left out rather than written empty, so a half-filled form
 * produces a configuration that fails to connect instead of one that sends an empty credential.
 */
export function applyMcpFlow(
  config: McpServerConfig,
  flow: McpConnectFlow | null | undefined,
  values: McpAuthValues,
): McpServerConfig {
  const stdio = config.transport === "stdio";
  const written = mcpFlowFields(flow).flatMap((field) => {
    const key = stdio ? field.env : field.header;
    const value = values[field.id] ?? "";
    return key && value ? [{ key, value: `${field.prefix ?? ""}${value}` }] : [];
  });
  const kept = (pairs: McpKeyValue[]) => pairs.filter((pair) => !written.some((wrote) => wrote.key === pair.key));
  return stdio
    ? { ...config, env: [...kept(config.env), ...written] }
    : { ...config, headers: [...kept(config.headers), ...written] };
}
