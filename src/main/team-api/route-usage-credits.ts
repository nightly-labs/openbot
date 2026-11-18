import { type AccountUsageLimit, canAdministerServer, DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { USAGE_CREDITS_CAPABILITY, USAGE_CREDITS_ROUTES } from "@openbot/contracts/team-protocol/usage-credits-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents, TeamApiProviderAccounts } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * Whether each provider account of this host can keep working on credits, for the usage-limit
 * notice of a joined server. Frozen by `usage-credits-v1`. A member gets the provider's own
 * sign-ins, as the released usage route gives; an owner or admin also gets the accounts after it.
 */
export async function routeUsageCredits(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "getUsage">,
  providerAccounts: Pick<TeamApiProviderAccounts, "usage"> | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== USAGE_CREDITS_ROUTES.list) return "unmatched";
  if (!capabilities.has(USAGE_CREDITS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  // `readJson` has already run the body through the `usage-credits-v1` codec.
  await readJson(request);
  const signIns = (await runCauseEffect(agents.getUsage())).limits.filter((limit) => limit.accountId === undefined);
  const others =
    providerAccounts && canAdministerServer(member.role)
      ? (await runCauseEffect(providerAccounts.usage())).limits.filter((limit) => limit.accountId !== undefined)
      : [];
  return json(200, { accounts: [...signIns, ...others].flatMap(creditsOf) });
}

function creditsOf(limit: AccountUsageLimit) {
  return limit.creditsAvailable === undefined
    ? []
    : [
        {
          provider: limit.id,
          accountId: limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
          available: limit.creditsAvailable,
        },
      ];
}
