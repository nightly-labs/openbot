import type { AgentStatus } from "@openbot/contracts/ipc";
import {
  PROVIDER_USE_CAPABILITY,
  PROVIDER_USE_LIMIT,
  PROVIDER_USE_ROUTES,
} from "@openbot/contracts/team-protocol/provider-use-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderUseInput } from "../ipc/provider-handlers";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The on/off switch of the host's built-in providers, from a joined server, as Settings > Providers
 * has it on this computer. Only an owner or admin can use it. The provider runtime refuses to turn
 * off a provider that an agent uses or that is busy; the refusal goes back as a 409 with its message.
 * Frozen by `provider-use-v1`.
 */
export async function routeProviderUse(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || (path !== PROVIDER_USE_ROUTES.list && path !== PROVIDER_USE_ROUTES.set)) return "unmatched";
  const service = admin?.providers?.service;
  if (!service || !capabilities.has(PROVIDER_USE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providerUseUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the provider-use wire codec.
  const body = await readJson(request);
  if (path === PROVIDER_USE_ROUTES.list) return json(200, { off: offProviders(service.getStatus()) });
  let input: ReturnType<typeof parseProviderUseInput>;
  try {
    input = parseProviderUseInput(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.providerUseInvalid"));
  }
  try {
    return json(200, { off: offProviders(await runCauseEffect(service.setProviderOn(input.provider, input.on))) });
  } catch (error) {
    // A provider in use or a busy provider is a sentence for the admin, not a host fault.
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

function offProviders(status: AgentStatus): string[] {
  return (status.providers ?? [])
    .filter((provider) => provider.off === true)
    .map((provider) => provider.id)
    .slice(0, PROVIDER_USE_LIMIT);
}
