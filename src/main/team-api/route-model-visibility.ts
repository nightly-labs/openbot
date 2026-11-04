import { parseProviderModelVisibilityChange, parseProviderModelVisibilityProvider } from "@openbot/contracts/ipc";
import {
  MODEL_VISIBILITY_CAPABILITY,
  MODEL_VISIBILITY_ROUTES,
} from "@openbot/contracts/team-protocol/model-visibility-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** Which models the model picker of this server shows, read and set from a joined server, and how it lists them. Frozen by `model-visibility-v1`. */
export async function routeModelVisibility(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== MODEL_VISIBILITY_ROUTES.settings &&
      url.pathname !== MODEL_VISIBILITY_ROUTES.update &&
      url.pathname !== MODEL_VISIBILITY_ROUTES.listing)
  )
    return "unmatched";
  const visibility = admin?.modelVisibility;
  if (!visibility || !capabilities.has(MODEL_VISIBILITY_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.modelVisibilityUnsupported"));
  // Each member's picker reads the listing; it holds no more than the model list that the member reads.
  if (url.pathname === MODEL_VISIBILITY_ROUTES.listing)
    return json(200, { models: await runCauseEffect(visibility.listings()) });
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === MODEL_VISIBILITY_ROUTES.settings) {
    const provider = parseOr400(() => parseProviderModelVisibilityProvider(body.provider));
    return json(200, await runCauseEffect(visibility.settings(provider)));
  }
  const change = parseOr400(() => parseProviderModelVisibilityChange(body));
  return json(200, await runCauseEffect(visibility.set(change)));
}

function parseOr400<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid model list.");
  }
}
