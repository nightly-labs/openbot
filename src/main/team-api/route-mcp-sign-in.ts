import { MCP_SIGN_IN_CAPABILITY, MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseCancelMcpSignIn, parseRemoveMcpServer, parseTestMcpServer } from "../ipc/mcp-inputs";
import type { TeamApiMcpSignIns } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(MCP_SIGN_IN_ROUTES));

/**
 * The MCP sign-ins of this host, started from a joined server. Frozen by `mcp-sign-in-v1`.
 *
 * The page opens in a private tab of this host's browser, and the administrator signs in through
 * its live view. The grant comes back to this host's own listener, so no route carries a credential.
 * `requireAdmin` runs on every route, as on the MCP list itself.
 */
export async function routeMcpSignIn(
  context: TeamApiRequestContext,
  signIns: TeamApiMcpSignIns | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!signIns || !capabilities.has(MCP_SIGN_IN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.mcpUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `mcp-sign-in-v1` codec.
  const body = await readJson(request);
  switch (url.pathname) {
    case MCP_SIGN_IN_ROUTES.start:
      await runCauseEffect(signIns.start(parseTestMcpServer(body)));
      return json(200, {});
    case MCP_SIGN_IN_ROUTES.status:
      return json(200, signIns.status(parseCancelMcpSignIn(body).url));
    case MCP_SIGN_IN_ROUTES.cancel:
      signIns.cancel(parseCancelMcpSignIn(body).url);
      return json(200, {});
    // A sign-out names its row the way a removal does, so it is read by the same parser.
    case MCP_SIGN_IN_ROUTES.signOut:
      return json(200, await runCauseEffect(signIns.signOut(parseRemoveMcpServer(body))));
    default:
      return json(200, signIns.list());
  }
}
