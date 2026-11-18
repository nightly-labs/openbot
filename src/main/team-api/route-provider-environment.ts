import { isProviderEnvironmentProvider, type ProviderEnvironmentVariableInput } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  PROVIDER_ENVIRONMENT_CAPABILITY,
  PROVIDER_ENVIRONMENT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-environment-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { ProviderEnvironmentRefused } from "../provider-environment-store";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The environment variables of one provider of this server, read and set from a joined server. Frozen
 * by `provider-environment-v1`. No response carries a sensitive value.
 */
export async function routeProviderEnvironment(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== PROVIDER_ENVIRONMENT_ROUTES.settings && url.pathname !== PROVIDER_ENVIRONMENT_ROUTES.update)
  )
    return "unmatched";
  const environment = admin?.providerEnvironment;
  if (!environment || !capabilities.has(PROVIDER_ENVIRONMENT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providerEnvironmentUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the provider-environment wire codec.
  const body = await readJson(request);
  const provider = body.provider;
  if (!isProviderEnvironmentProvider(provider)) throw new HttpError(400, "A provider is required.");
  if (url.pathname === PROVIDER_ENVIRONMENT_ROUTES.settings) return json(200, environment.get(provider));
  const variables: ProviderEnvironmentVariableInput[] = (Array.isArray(body.variables) ? body.variables : []).flatMap(
    (item) =>
      isDynamicRecord(item) && isString(item.name) && typeof item.sensitive === "boolean"
        ? [{ name: item.name, value: isString(item.value) ? item.value : null, sensitive: item.sensitive }]
        : [],
  );
  try {
    return json(200, await runCauseEffect(environment.set({ provider, variables })));
  } catch (error) {
    // A refusal is the fault of the request, and its message is for the person who made the change.
    if (error instanceof ProviderEnvironmentRefused) throw new HttpError(400, error.message);
    throw error;
  }
}
