import {
  HOST_PERSONALITY_CAPABILITY,
  HOST_PERSONALITY_ROUTES,
} from "@openbot/contracts/team-protocol/host-personality-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseServerPersonality } from "../server-personality-preference-store";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The server personality of this computer, read and set from a joined server. Frozen by
 * `host-personality-v1`: any member reads it, an owner or admin sets it.
 */
export async function routeHostPersonality(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== HOST_PERSONALITY_ROUTES.settings && url.pathname !== HOST_PERSONALITY_ROUTES.update)
  )
    return "unmatched";
  const personality = admin?.personality;
  if (!personality || !capabilities.has(HOST_PERSONALITY_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostPersonalityUnsupported"));
  const body = await readJson(request);
  if (url.pathname === HOST_PERSONALITY_ROUTES.settings) return json(200, personality.get());
  requireAdmin(member);
  let change: ReturnType<typeof parseServerPersonality>;
  try {
    change = parseServerPersonality(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : sourceText("error.host.personalityInvalid"));
  }
  return json(200, await runCauseEffect(personality.set(change)));
}
