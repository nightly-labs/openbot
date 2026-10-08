import {
  DIRECT_ENDPOINT_CAPABILITY,
  DIRECT_ENDPOINT_ROUTES,
} from "@openbot/contracts/team-protocol/direct-endpoint-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiDirectEndpoint } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * The direct Tailscale address of this host, for any signed-in member, or null while it is off. Only
 * the address crosses the wire: the tailnet name, the device name and the loopback port stay here.
 * Frozen by `direct-endpoint-v1`.
 */
export async function routeDirectEndpoint(
  context: TeamApiRequestContext,
  directEndpoint: TeamApiDirectEndpoint | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== DIRECT_ENDPOINT_ROUTES.read) return "unmatched";
  if (!directEndpoint || !capabilities.has(DIRECT_ENDPOINT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.directEndpointUnsupported"));
  // `readJson` has already run the body through the direct-endpoint wire codec.
  await readJson(request);
  return json(200, { url: directEndpoint.url() });
}
