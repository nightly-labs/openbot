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
 * This sits beside `marketplace-plugins.ts` because the plugin listing is the only thing that reads
 * it today. It moves out the day `ServerMcpPanel` offers the same guided connect.
 */

import type { McpKeyValue, McpServerConfig } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";

/** One credential the user pastes. */
export interface McpAuthField {
  id: string;
  /** What the input is called on screen, as the server's own documentation calls it. */
  label: string;
  /**
   * The value is the server's own address, for a service that gives each user a link, such as
   * Composio. It replaces the listing's URL and must stay on the listing's host or a subdomain of it.
   */
  url?: boolean;
  /** The http header the value is sent in. */
  header?: string;
  /** The environment variable the value is set as, for a stdio server. */
  env?: string;
  /**
   * Written in front of the typed value, so the user pastes the token the server gave them and not
   * the scheme word in front of it. `"Bearer "` is the usual one; the space is part of the string.
   */
  prefix?: string;
  placeholder?: string;
  /** Where this value is found, in the user's own account. */
  hint?: string;
  /** The server can connect without it, such as a key that only some accounts require. */
  optional?: boolean;
}

interface McpConnectFlowBase {
  id: string;
  /** What this way in is called where the ways are listed side by side. */
  label: string;
}

/** Sign-in in the browser. The exchange happens in the main process; no secret reaches this side. */
export interface McpLinkFlow extends McpConnectFlowBase {
  kind: "link";
}

/** A credential the user pastes, or two. */
export interface McpKeyFlow extends McpConnectFlowBase {
  kind: "key";
  fields: McpAuthField[];
  /** The page the key is created on. Opened externally; never fetched here. */
  docsUrl?: string | null;
  docsLabel?: string;
}

export type McpConnectFlow = McpLinkFlow | McpKeyFlow;

/** Every way into one server. The first is the one the dialog opens on. Empty is a server that
 *  asks for nothing, which still connects: a server that is down is found before an agent has it. */
export type McpAuth = McpConnectFlow[];

/** What the user has typed in the current flow, keyed by field id. */
export type McpAuthValues = Record<string, string>;

/** The flow's required fields all have a value. A flow with no fields is complete by asking for nothing. */
export function mcpFlowComplete(flow: McpConnectFlow | null | undefined, values: McpAuthValues): boolean {
  return mcpFlowFields(flow).every((field) => field.optional || (values[field.id] ?? "").trim().length > 0);
}

/**
 * What is wrong with a typed link, in the words the dialog shows, or null.
 *
 * The host is held to the listing's so that a plugin row stays recognizable as the plugin's:
 * `isPluginAppConfig` matches a user's link by host, not by the exact address.
 */
export function mcpFlowError(
  config: McpServerConfig,
  flow: McpConnectFlow | null | undefined,
  values: McpAuthValues,
  t: AppTranslate,
): string | null {
  for (const field of mcpFlowFields(flow)) {
    const value = (values[field.id] ?? "").trim();
    if (field.url && value && !isListingUrl(value, config.url)) {
      return t("mcp.connect.httpsLinkRequired", { hostname: new URL(config.url).hostname });
    }
  }
  return null;
}

/** The address is https and on the listing's host, or on a subdomain of it. */
export function isListingUrl(value: string, listingUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = new URL(listingUrl).hostname;
  return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith(`.${host}`));
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
  // A link is trimmed, unlike a credential: a space pasted around an address is never part of it.
  const link = mcpFlowFields(flow)
    .filter((field) => field.url)
    .map((field) => (values[field.id] ?? "").trim())
    .find(Boolean);
  const base = link && !stdio ? { ...config, url: link } : config;
  const written = mcpFlowFields(flow).flatMap((field) => {
    if (field.url) return [];
    const key = stdio ? field.env : field.header;
    const value = values[field.id] ?? "";
    return key && value ? [{ key, value: `${field.prefix ?? ""}${value}` }] : [];
  });
  const kept = (pairs: McpKeyValue[]) => pairs.filter((pair) => !written.some((wrote) => wrote.key === pair.key));
  return stdio
    ? { ...base, env: [...kept(base.env), ...written] }
    : { ...base, headers: [...kept(base.headers), ...written] };
}
