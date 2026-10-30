import { parseDiscordAllowedRoles } from "@openbot/contracts/ipc";
import { DISCORD_ACCESS_CAPABILITY, DISCORD_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/discord-access-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiConnectors } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(DISCORD_ACCESS_ROUTES));

/**
 * Which Discord roles can use OpenBot in each Discord server of this host, read and set from a joined
 * server. Frozen by `discord-access-v1`. `requireAdmin` runs on every route.
 */
export async function routeDiscordAccess(
  context: TeamApiRequestContext,
  connectors: TeamApiConnectors | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connectors || !capabilities.has(DISCORD_ACCESS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.discordAccessUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `discord-access-v1` codec.
  const body = await readJson(request);
  const { messaging } = connectors;
  const workspaceId = stringField(body, "workspaceId", false, 128);
  switch (url.pathname) {
    case DISCORD_ACCESS_ROUTES.access:
      return json(200, await runCauseEffect(messaging.discordAccess(workspaceId)));
    case DISCORD_ACCESS_ROUTES.roles:
      return json(200, await runCauseEffect(messaging.listDiscordRoles(workspaceId)));
    default: {
      const allowedRoles = parseDiscordAllowedRoles(body.allowedRoles);
      if (!allowedRoles) throw new HttpError(400, "allowedRoles is invalid.");
      return json(200, await runCauseEffect(messaging.setDiscordAccess({ workspaceId, allowedRoles })));
    }
  }
}
