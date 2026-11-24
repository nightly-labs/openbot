import {
  CLAUDE_COMPACT_WINDOW_CAPABILITY,
  CLAUDE_COMPACT_WINDOW_ROUTES,
} from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeClaudeCompactWindow(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CLAUDE_COMPACT_WINDOW_ROUTES.settings && url.pathname !== CLAUDE_COMPACT_WINDOW_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.claudeCompactWindow;
  if (!setting || !capabilities.has(CLAUDE_COMPACT_WINDOW_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.claudeCompactWindowUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === CLAUDE_COMPACT_WINDOW_ROUTES.settings) return json(200, setting.get());
  return json(200, await runCauseEffect(setting.set(typeof body.tokens === "number" ? body.tokens : null)));
}
