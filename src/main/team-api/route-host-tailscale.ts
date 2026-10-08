import { HOST_TAILSCALE_CAPABILITY, HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireOwner } from "./request-helpers";

const ROUTES = new Set<string>(Object.values(HOST_TAILSCALE_ROUTES));

/**
 * The Tailscale setup of this host, for its owner only: the state, the direct path switch and the
 * start of a Tailscale sign-in. Frozen by `host-tailscale-v1`.
 */
export async function routeHostTailscale(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  const tailscale = admin?.tailscale;
  if (!tailscale || !capabilities.has(HOST_TAILSCALE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostTailscaleUnsupported"));
  requireOwner(member);
  // `readJson` has already run the body through the `host-tailscale-v1` codec.
  const body = await readJson(request);
  if (url.pathname === HOST_TAILSCALE_ROUTES.status) return json(200, await runCauseEffect(tailscale.status()));
  if (url.pathname === HOST_TAILSCALE_ROUTES.signIn) return json(200, await runCauseEffect(tailscale.signIn()));
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "A valid JSON object is required.");
  return json(200, await runCauseEffect(tailscale.setEnabled(body.enabled)));
}
