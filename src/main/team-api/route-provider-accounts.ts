import { isString } from "@openbot/contracts/runtime-values";
import {
  PROVIDER_ACCOUNT_MODELS_CAPABILITY,
  PROVIDER_ACCOUNT_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-models-v1";
import {
  PROVIDER_ACCOUNT_POOL_CAPABILITY,
  PROVIDER_ACCOUNT_POOL_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderId } from "../ipc/app-inputs";
import type { TeamApiProviderAccounts } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_ACCOUNTS_ROUTES));

/**
 * The accounts of this host's providers, managed from a joined server. Frozen by
 * `provider-accounts-v1`. `requireAdmin` runs on every route.
 *
 * An account sign-in opens its page in a private tab of this host's browser, and the administrator
 * signs in through its live view. No route carries the page's link or a credential.
 */
export async function routeProviderAccounts(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `provider-accounts-v1` codec.
  const body = await readJson(request);
  const accountId = isString(body.accountId) ? body.accountId : null;
  switch (url.pathname) {
    case PROVIDER_ACCOUNTS_ROUTES.list:
      return json(200, accounts.list());
    case PROVIDER_ACCOUNTS_ROUTES.usage:
      return json(200, await runCauseEffect(accounts.usage()));
    case PROVIDER_ACCOUNTS_ROUTES.signInStart:
      await runCauseEffect(accounts.startSignIn(parseProviderId(body.provider), accountId));
      return json(200, {});
    case PROVIDER_ACCOUNTS_ROUTES.signInStatus:
      return json(200, accounts.signInStatus(parseProviderId(body.provider)));
    case PROVIDER_ACCOUNTS_ROUTES.signInCancel:
      await runCauseEffect(accounts.cancelSignIn(parseProviderId(body.provider)));
      return json(200, {});
    case PROVIDER_ACCOUNTS_ROUTES.rename:
      await runCauseEffect(
        accounts.rename(
          parseProviderId(body.provider),
          requiredAccount(accountId),
          isString(body.label) ? body.label : null,
        ),
      );
      return json(200, {});
    case PROVIDER_ACCOUNTS_ROUTES.remove:
      await runCauseEffect(accounts.remove(parseProviderId(body.provider), requiredAccount(accountId)));
      return json(200, {});
    default:
      if (!isString(body.agentId)) throw new HttpError(400, "agentId is invalid.");
      await runCauseEffect(accounts.setAgentAccount(body.agentId, accountId));
      return json(200, {});
  }
}

/**
 * The models that each account after the first serves and the provider's own sign-in does not.
 * Frozen by `provider-account-models-v1`. `requireAdmin` runs on the route.
 */
export async function routeProviderAccountModels(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, json } = context;
  if (method !== "POST" || url.pathname !== PROVIDER_ACCOUNT_MODELS_ROUTES.list) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_MODELS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  return json(200, accounts.models());
}

const POOL_ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_ACCOUNT_POOL_ROUTES));

/**
 * The account pool of each of this host's providers. Frozen by `provider-account-pool-v1`.
 * `requireAdmin` runs on every route.
 */
export async function routeProviderAccountPool(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !POOL_ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_POOL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  if (url.pathname === PROVIDER_ACCOUNT_POOL_ROUTES.list) return json(200, accounts.pools());
  // `readJson` has already run the body through the `provider-account-pool-v1` codec.
  const body = await readJson(request);
  const leftOut = Array.isArray(body.leftOut) ? body.leftOut.filter(isString) : [];
  await runCauseEffect(accounts.setPool(parseProviderId(body.provider), body.enabled === true, leftOut));
  return json(200, {});
}

function requiredAccount(accountId: string | null): string {
  if (accountId === null) throw new HttpError(400, "accountId is invalid.");
  return accountId;
}
