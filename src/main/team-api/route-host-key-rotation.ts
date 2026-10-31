import {
  HOST_KEY_ROTATION_CAPABILITY,
  HOST_KEY_ROTATION_ROUTES,
} from "@openbot/contracts/team-protocol/host-key-rotation-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireOwner } from "./request-helpers";

/**
 * The owner changes the key of this computer's server from another device. Frozen by
 * `host-key-rotation-v1`. The host signs the handover itself, so no key leaves this computer.
 */
export async function routeHostKeyRotation(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== HOST_KEY_ROTATION_ROUTES.rotate) return "unmatched";
  const hostKey = admin?.hostKey;
  if (!hostKey || !capabilities.has(HOST_KEY_ROTATION_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostKeyRotationUnsupported"));
  requireOwner(member);
  await readJson(request);
  return json(200, await runCauseEffect(hostKey.rotate()));
}
