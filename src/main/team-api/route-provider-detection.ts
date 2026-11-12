import {
  PROVIDER_DETECTION_CAPABILITY,
  PROVIDER_DETECTION_ROUTES,
} from "@openbot/contracts/team-protocol/provider-detection-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseDiscoverModels, parseProviderDetectionSettings } from "../ipc/provider-detection-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";
import { answer } from "./route-agent-import";

const ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_DETECTION_ROUTES));

/** A refused input; the parsers do not quote it, because a model list request can carry a key. */
function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Error) throw new HttpError(400, error.message);
    throw error;
  }
}

/**
 * The local model servers and ACP agent commands that this server finds, for a joined server's
 * Server Settings > Providers. The host makes each request from the host, as the Providers section
 * does on this computer. A response never carries a key or a header value. Frozen by
 * `provider-detection-v1`.
 */
export async function routeProviderDetection(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  const detection = admin?.providerDetection;
  if (!detection || !capabilities.has(PROVIDER_DETECTION_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providerDetectionUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the provider-detection wire codec.
  const body = await readJson(request);
  switch (url.pathname) {
    case PROVIDER_DETECTION_ROUTES.settings:
      return json(200, detection.settings.get());
    case PROVIDER_DETECTION_ROUTES.updateSettings: {
      const next = parsed(() => parseProviderDetectionSettings(body));
      return json(200, await answer(() => runCauseEffect(detection.settings.set(next)), 409));
    }
    case PROVIDER_DETECTION_ROUTES.scanModelServers:
      return json(200, { servers: await runCauseEffect(detection.detection.scanModelServers()) });
    case PROVIDER_DETECTION_ROUTES.scanAgents:
      return json(200, { agents: await runCauseEffect(detection.detection.scanAgents()) });
    default: {
      const input = parsed(() => parseDiscoverModels(body));
      // A probe error names only the host of the address, never a key or a header value.
      return json(200, await answer(() => Effect.runPromise(detection.detection.discoverModels(input)), 409));
    }
  }
}
