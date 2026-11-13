import {
  CLAUDE_USER_SETUP_CAPABILITY,
  CLAUDE_USER_SETUP_ROUTES,
} from "@openbot/contracts/team-protocol/claude-user-setup-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * "Use my Claude Code setup" of this server, read and set from a joined server. Only the switch
 * leaves the host, never a file of the setup. Frozen by `claude-user-setup-v1`.
 */
export async function routeClaudeUserSetup(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CLAUDE_USER_SETUP_ROUTES.settings && url.pathname !== CLAUDE_USER_SETUP_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.claudeUserSetup;
  if (!setting || !capabilities.has(CLAUDE_USER_SETUP_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.claudeUserSetupUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the claude-user-setup wire codec.
  const body = await readJson(request);
  if (url.pathname === CLAUDE_USER_SETUP_ROUTES.settings) return json(200, setting.get());
  return json(200, await runCauseEffect(setting.set(body.enabled === true)));
}
