import { isString } from "@openbot/contracts/runtime-values";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import {
  decodeLiveVoiceAccount,
  LIVE_VOICE_ACCOUNT_CAPABILITY,
  LIVE_VOICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/live-voice-account-v1";
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
import {
  PROVIDER_FROZEN_ACCOUNTS_LIMIT,
  PROVIDER_MANY_ACCOUNTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/provider-many-accounts-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText, registerSecretValue } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseProviderId } from "../ipc/app-inputs";
import type { TeamApiProviderAccounts } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_ACCOUNTS_ROUTES));

export function requireProviderAccountsFit(capabilities: ReadonlySet<string>, accountCount: number): void {
  if (accountCount > PROVIDER_FROZEN_ACCOUNTS_LIMIT && !capabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY))
    throw new HttpError(
      409,
      sourceText("error.team.providerAccountListNeedsUpdate", { limit: PROVIDER_FROZEN_ACCOUNTS_LIMIT }),
    );
}

type ProviderAccountList = Pick<TeamApiProviderAccounts, "list">;

function mostAccounts(listed: ReturnType<TeamApiProviderAccounts["list"]>): number {
  return Math.max(0, ...listed.providers.map((row) => row.accounts.length));
}

function requireAllAccountsFit(capabilities: ReadonlySet<string>, accounts: ProviderAccountList): void {
  if (!capabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY))
    requireProviderAccountsFit(capabilities, mostAccounts(accounts.list()));
}

export function requireRoomForAccount(
  capabilities: ReadonlySet<string>,
  accounts: ProviderAccountList | undefined,
  provider: string,
  accountId: string | null,
): void {
  if (!accounts || accountId !== null || capabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY)) return;
  const held = accounts.list().providers.find((row) => row.provider === provider)?.accounts.length ?? 0;
  requireProviderAccountsFit(capabilities, held + 1);
}

export function requireRoomForKeyAccount(
  capabilities: ReadonlySet<string>,
  accounts: ProviderAccountList | undefined,
  provider: string,
): void {
  if (provider !== "claude" || !accounts) return;
  const listed = accounts.list().providers.find((row) => row.provider === provider)?.accounts ?? [];
  if (listed.some((account) => account.id === CLAUDE_API_KEY_ACCOUNT_ID)) return;
  requireRoomForAccount(capabilities, accounts, provider, null);
}

export async function routeProviderAccounts(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const accountId = isString(body.accountId) ? body.accountId : null;
  switch (url.pathname) {
    case PROVIDER_ACCOUNTS_ROUTES.list: {
      const listed = accounts.list();
      requireProviderAccountsFit(capabilities, mostAccounts(listed));
      return json(200, listed);
    }
    case PROVIDER_ACCOUNTS_ROUTES.usage:
      return json(200, await runCauseEffect(accounts.usage()));
    case PROVIDER_ACCOUNTS_ROUTES.signInStart: {
      const provider = parseProviderId(body.provider);
      requireRoomForAccount(capabilities, accounts, provider, accountId);
      await runCauseEffect(accounts.startSignIn(provider, accountId));
      return json(200, {});
    }
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

export async function routeProviderAccountModels(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, json } = context;
  if (method !== "POST" || url.pathname !== PROVIDER_ACCOUNT_MODELS_ROUTES.list) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_MODELS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  requireAllAccountsFit(capabilities, accounts);
  return json(200, accounts.models());
}

const POOL_ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_ACCOUNT_POOL_ROUTES));

export async function routeProviderAccountPool(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !POOL_ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_POOL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  requireAllAccountsFit(capabilities, accounts);
  if (url.pathname === PROVIDER_ACCOUNT_POOL_ROUTES.list) return json(200, accounts.pools());
  const body = await readJson(request);
  const leftOut = Array.isArray(body.leftOut) ? body.leftOut.filter(isString) : [];
  await runCauseEffect(accounts.setPool(parseProviderId(body.provider), body.enabled === true, leftOut));
  return json(200, {});
}

const LIVE_VOICE_ACCOUNT_ROUTE_SET: ReadonlySet<string> = new Set(Object.values(LIVE_VOICE_ACCOUNT_ROUTES));

export async function routeLiveVoiceAccount(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !LIVE_VOICE_ACCOUNT_ROUTE_SET.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(LIVE_VOICE_ACCOUNT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  if (url.pathname === LIVE_VOICE_ACCOUNT_ROUTES.settings) return json(200, accounts.liveVoiceAccount());
  let accountId: string | null;
  try {
    accountId = decodeLiveVoiceAccount(await readJson(request));
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  await runCauseEffect(accounts.setLiveVoiceAccount(accountId));
  return json(200, {});
}

export async function routeProviderAccountKeys(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== PROVIDER_ACCOUNT_KEYS_ROUTES.connect) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_KEYS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const key = isString(body.key) ? body.key.trim() : "";
  if (!key) throw new HttpError(400, "key is invalid.");
  registerSecretValue(key);
  const provider = parseProviderId(body.provider);
  const accountId = isString(body.accountId) ? body.accountId : null;
  requireRoomForAccount(capabilities, accounts, provider, accountId);
  try {
    await runCauseEffect(accounts.connectKey(provider, accountId, key));
  } catch (error) {
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
  return json(200, {});
}

const CODE_ROUTES: ReadonlySet<string> = new Set(Object.values(PROVIDER_ACCOUNT_CODE_ROUTES));

export async function routeProviderAccountCode(
  context: TeamApiRequestContext,
  accounts: TeamApiProviderAccounts | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !CODE_ROUTES.has(url.pathname)) return "unmatched";
  if (!accounts || !capabilities.has(PROVIDER_ACCOUNT_CODE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.providersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const provider = parseProviderId(body.provider);
  const accountId = isString(body.accountId) ? body.accountId : null;
  if (url.pathname === PROVIDER_ACCOUNT_CODE_ROUTES.status)
    return json(200, accounts.codeSignInStatus(provider, requiredAccount(accountId)));
  if (url.pathname === PROVIDER_ACCOUNT_CODE_ROUTES.submit) {
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
  requireRoomForAccount(capabilities, accounts, provider, accountId);
  try {
    return json(200, await runCauseEffect(accounts.startCodeSignIn(provider, accountId)));
  } catch (error) {
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

function requiredAccount(accountId: string | null): string {
  if (accountId === null) throw new HttpError(400, "accountId is invalid.");
  return accountId;
}
