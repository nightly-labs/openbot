import { isCliProxyProvider, normalizeCliProxyBaseUrl } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  CLIPROXY_PROFILES_CAPABILITY,
  CLIPROXY_PROFILES_ROUTES,
} from "@openbot/contracts/team-protocol/cliproxy-profiles-v1";
import {
  PROVIDER_ACCOUNT_CODE_CAPABILITY,
  PROVIDER_ACCOUNT_CODE_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-code-v1";
import {
  PROVIDER_ACCOUNT_KEYS_CAPABILITY,
  PROVIDER_ACCOUNT_KEYS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-keys-v1";
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
import { redactText, registerSecretValue } from "@openbot/logging";
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

/**
 * Gives an account of one of this host's providers its API key. Frozen by `provider-account-keys-v1`.
 * `requireAdmin` runs on the route. The key is in the request only; no answer or log holds it.
 */
export async function routeProviderAccountKeys(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== PROVIDER_ACCOUNT_KEYS_ROUTES.connect) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_KEYS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `provider-account-keys-v1` codec.
  const body = await readJson(request);
  const key = isString(body.key) ? body.key.trim() : "";
  if (!key) throw new HttpError(400, "key is invalid.");
  registerSecretValue(key);
  try {
    await runCauseEffect(
      accounts.connectKey(parseProviderId(body.provider), isString(body.accountId) ? body.accountId : null, key),
    );
  } catch (error) {
    // The admin must see why the provider refused the key, as on the provider routes. A CLI can quote
    // its key, so the message leaves this computer redacted.
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
  return json(200, {});
}

const CLIPROXY_ROUTES: ReadonlySet<string> = new Set(Object.values(CLIPROXY_PROFILES_ROUTES));

/**
 * Lists, creates, and updates dedicated CLIProxy profiles on this host. Frozen by `cliproxy-profiles-v1`.
 * `requireAdmin` runs on every route; any API key travels only to the host and is never returned.
 */
export async function routeCliProxyProfiles(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !CLIPROXY_ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(CLIPROXY_PROFILES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  if (url.pathname === CLIPROXY_PROFILES_ROUTES.list) {
    return json(200, accounts.cliProxyProfiles());
  }
  const body = await readJson(request);
  const provider = parseProviderId(body.provider);
  if (!isCliProxyProvider(provider))
    throw new HttpError(400, sourceText("error.provider.cliProxyUnsupported", { provider }));
  const baseUrl = isString(body.baseUrl) ? normalizeCliProxyBaseUrl(body.baseUrl) : null;
  if (!baseUrl) throw new HttpError(400, sourceText("error.provider.cliProxyInvalidUrl"));
  const apiKey = isString(body.apiKey) ? body.apiKey : null;
  if (apiKey?.trim()) registerSecretValue(apiKey.trim());
  try {
    await runCauseEffect(
      accounts.saveCliProxyProfile({
        provider,
        accountId: isString(body.accountId) ? body.accountId : null,
        label: isString(body.label) ? body.label : null,
        baseUrl,
        apiKey,
      }),
    );
  } catch (error) {
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
  return json(200, {});
}

const CODE_ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_ACCOUNT_CODE_ROUTES));

/**
 * The code sign-in of an account of one of this host's providers. Frozen by
 * `provider-account-code-v1`. `requireAdmin` runs on every route. The answer holds the page and the
 * code of the provider; no route gives a credential. `submit` takes the code of a `paste` sign-in.
 */
export async function routeProviderAccountCode(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !CODE_ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_CODE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `provider-account-code-v1` codec.
  const body = await readJson(request);
  const provider = parseProviderId(body.provider);
  const accountId = isString(body.accountId) ? body.accountId : null;
  if (url.pathname === PROVIDER_ACCOUNT_CODE_ROUTES.status)
    return json(200, accounts.codeSignInStatus(provider, requiredAccount(accountId)));
  if (url.pathname === PROVIDER_ACCOUNT_CODE_ROUTES.submit) {
    // The code is a credential: it goes to the CLI's stdin, and no error quotes it.
    const code = isString(body.code) ? body.code : "";
    if (code) registerSecretValue(code);
    try {
      accounts.submitCodeSignIn(provider, requiredAccount(accountId), code);
    } catch (error) {
      if (error instanceof Error) throw new HttpError(409, redactText(error.message));
      throw error;
    }
    return json(200, {});
  }
  if (url.pathname === PROVIDER_ACCOUNT_CODE_ROUTES.cancel) {
    await runCauseEffect(accounts.cancelCodeSignIn(provider, requiredAccount(accountId)));
    return json(200, {});
  }
  try {
    return json(200, await runCauseEffect(accounts.startCodeSignIn(provider, accountId)));
  } catch (error) {
    // The admin must see why the sign-in did not start, as on the key route.
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

function requiredAccount(accountId: string | null): string {
  if (accountId === null) throw new HttpError(400, "accountId is invalid.");
  return accountId;
}
