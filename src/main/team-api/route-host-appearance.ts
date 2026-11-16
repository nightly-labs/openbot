import {
  HOST_APPEARANCE_CAPABILITY,
  HOST_APPEARANCE_ROUTES,
  type ServerAppearance,
  serverAppearanceOrNull,
} from "@openbot/contracts/team-protocol/host-appearance-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The shape and colour of the plush that this server shows with no logo, changed from a joined
 * server. The change runs as the local one does, so the account service gets a copy. Frozen by
 * `host-appearance-v1`.
 */
export async function routeHostAppearance(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== HOST_APPEARANCE_ROUTES.appearance) return "unmatched";
  const identity = admin?.identity;
  if (!identity || !capabilities.has(HOST_APPEARANCE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostIdentityUnsupported"));
  requireAdmin(member);
  const appearance = parsedAppearance((await readJson(request)).appearance);
  try {
    await runCauseEffect(identity.updateIdentity({ appearance }));
    return json(200, {});
  } catch (error) {
    // A signed-out host is a sentence for the admin, not a host fault.
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}

function parsedAppearance(value: unknown): ServerAppearance | null {
  if (value === null) return null;
  const appearance = serverAppearanceOrNull(value);
  if (!appearance) throw new HttpError(400, "Invalid server appearance.");
  return appearance;
}
