import { isProviderAccountId } from "@openbot/contracts/ipc";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderId } from "../ipc/app-inputs";
import type { TeamApiProviderUsageResets } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_USAGE_RESET_ROUTES));

/**
 * The usage reset credits of this host's provider accounts, read and spent from a joined server.
 * Frozen by `provider-usage-reset-v1`. `requireAdmin` runs on every route.
 */
export async function routeProviderUsageReset(
  context: TeamApiRequestContext,
  resets: TeamApiProviderUsageResets | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!resets || !capabilities.has(PROVIDER_USAGE_RESET_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `provider-usage-reset-v1` codec.
  const body = await readJson(request);
  const provider = parseProviderId(body.provider);
  if (url.pathname === PROVIDER_USAGE_RESET_ROUTES.list)
    return json(200, { accounts: await runCauseEffect(resets.providerUsageResets(provider)) });
  if (!isProviderAccountId(body.accountId)) throw new HttpError(400, "accountId is invalid.");
  return json(200, { outcome: await runCauseEffect(resets.resetProviderUsage(provider, body.accountId)) });
}
