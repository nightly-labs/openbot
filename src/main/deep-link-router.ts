/**
 * What an `openbot://` or `https://openbot.run/...` link means.
 *
 * The scheme carries more than one kind of link now, so the decision of which kind a URL is has one
 * home rather than one `try` per entry point. `src/main/index.ts` has four ways a link arrives -
 * `open-url`, `continue-activity`, a second instance's argv, and this process's own argv - and each
 * of them asks this module and then acts on the answer.
 *
 * The invite parser runs first. It owns the host `join`, it is the shipped behaviour, and asking it
 * first is what stops a later kind ever claiming one of its links.
 *
 * One kind never reaches a renderer. `mcp-auth` carries an OAuth grant for an MCP server, which is
 * a secret, so `src/main/index.ts` hands it to the sign-in that is waiting for it and sends nothing
 * on. It is classified here anyway, because the four entry points must keep asking one question.
 *
 * Anything this module does not recognise is `null`, which every caller drops without a message.
 * That is the existing behaviour for junk in argv, and it is what keeps an older build safe in
 * front of a link kind it has never heard of.
 */

import { type InviteLinkOptions, parseInviteUrl } from "@openbot/contracts/invite-links";
import { parsePluginUrl } from "@openbot/contracts/plugin-links";

export type DeepLink =
  | { kind: "invite"; url: string }
  | { kind: "plugin"; slug: string }
  | { kind: "mcp-auth"; state: string; code: string };

/**
 * Where an MCP grant comes back when this machine could not bind a loopback port.
 *
 * The listener in `mcp-oauth-redirect-server.ts` is the address a sign-in registers and sends;
 * some authorization servers, Canva among them, refuse a private-use scheme at `/authorize` even
 * after they accept it at registration. This stays as the fallback, and for the servers that take
 * it, it is the shorter path: the operating system hands the link straight to the running app.
 */
export const MCP_OAUTH_REDIRECT_URL = "openbot://mcp-auth";

const MCP_OAUTH_HOST = "mcp-auth";

export function parseDeepLink(value: string, options: InviteLinkOptions = {}): DeepLink | null {
  try {
    parseInviteUrl(value, options);
    return { kind: "invite", url: value };
  } catch {
    // Not an invitation. Most command-line arguments are not a link of any kind.
  }

  try {
    return { kind: "plugin", slug: parsePluginUrl(value) };
  } catch {
    // Not a plugin listing. A plugin link carries no query, so it can never be the link below.
  }

  return parseMcpAuthUrl(value);
}

/**
 * The return leg of an MCP sign-in: `openbot://mcp-auth?code=…&state=…`.
 *
 * Both halves are required and neither is inspected here. `state` is what the waiting sign-in is
 * keyed by, so a link this run did not start finds nothing and does nothing - which is the check
 * that makes a forged or replayed link harmless, and it belongs with the sign-in, not with the
 * parser. An error the authorization server sends back instead of a code is no link at all: the
 * sign-in ends on its own deadline and says so in the words the dialog already has.
 */
function parseMcpAuthUrl(value: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "openbot:" || url.hostname !== MCP_OAUTH_HOST) return null;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return null;
  return { kind: "mcp-auth", state, code };
}

/** The first argument that is a link. Used for a cold start and for a second instance's argv. */
export function findDeepLink(values: string[], options: InviteLinkOptions = {}): DeepLink | null {
  for (const value of values) {
    const link = parseDeepLink(value, options);
    if (link) return link;
  }
  return null;
}
