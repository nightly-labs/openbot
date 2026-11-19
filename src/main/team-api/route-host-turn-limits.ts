import { type HostTurnLimitsInput, parseHostTurnLimitsInput } from "@openbot/contracts/ipc";
import {
  HOST_TURN_LIMITS_CAPABILITY,
  HOST_TURN_LIMITS_ROUTES,
} from "@openbot/contracts/team-protocol/host-turn-limits-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The turn limits of this computer, read and set from a joined server. They decide how much work the
 * agents put on this computer, so only an owner or admin can read or change them. Frozen by
 * `host-turn-limits-v1`.
 */
export async function routeHostTurnLimits(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== HOST_TURN_LIMITS_ROUTES.settings && url.pathname !== HOST_TURN_LIMITS_ROUTES.update)
  )
    return "unmatched";
  const turnLimits = admin?.turnLimits;
  if (!turnLimits || !capabilities.has(HOST_TURN_LIMITS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostTurnLimitsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the host-turn-limits wire codec.
  const body = await readJson(request);
  if (url.pathname === HOST_TURN_LIMITS_ROUTES.settings) return json(200, turnLimits.get());
  let input: HostTurnLimitsInput;
  try {
    input = parseHostTurnLimitsInput(body);
  } catch {
    throw new HttpError(400, sourceText("error.host.turnLimitInvalid"));
  }
  return json(200, await runCauseEffect(turnLimits.set(input)));
}
