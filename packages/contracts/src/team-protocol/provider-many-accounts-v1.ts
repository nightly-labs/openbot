import { type AdminDecoder, boolean, count, fields, identifier, list, nullable, string } from "./admin-wire";
import {
  PROVIDER_ACCOUNT_MODELS_LIMIT,
  PROVIDER_ACCOUNT_MODELS_ROUTES,
  providerAccountModelWire,
} from "./provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_ROUTES } from "./provider-account-pool-v1";
import { PROVIDER_ACCOUNT_ID, PROVIDER_ACCOUNTS_ROUTES, providerAccountWire } from "./provider-accounts-v1";
import { PROVIDER_USAGE_RESET_ROUTES } from "./provider-usage-reset-v1";

export const PROVIDER_MANY_ACCOUNTS_CAPABILITY = "provider-many-accounts-v1";
export const PROVIDER_MANY_ACCOUNTS_LIMIT = 20;
export const PROVIDER_FROZEN_ACCOUNTS_LIMIT = 10;

const PROVIDER_LIMIT = 64;
const AGENT_LIMIT = 10_000;
const provider = string(PROVIDER_LIMIT);
const leftOut = list(PROVIDER_ACCOUNT_ID, 20);

const RESPONSES: ReadonlyMap<string, AdminDecoder> = new Map([
  [
    PROVIDER_ACCOUNTS_ROUTES.list,
    fields({
      providers: list(fields({ provider, accounts: list(providerAccountWire, 20) }), PROVIDER_LIMIT),
      agents: list(fields({ agentId: identifier, accountId: PROVIDER_ACCOUNT_ID }), AGENT_LIMIT),
    }),
  ],
  [
    PROVIDER_ACCOUNT_MODELS_ROUTES.list,
    fields({
      providers: list(
        fields({
          provider,
          accounts: list(
            fields({
              accountId: PROVIDER_ACCOUNT_ID,
              models: list(providerAccountModelWire, PROVIDER_ACCOUNT_MODELS_LIMIT),
            }),
            20,
          ),
        }),
        PROVIDER_LIMIT,
      ),
    }),
  ],
  [
    PROVIDER_ACCOUNT_POOL_ROUTES.list,
    fields({ pools: list(fields({ provider, leftOut, inUse: nullable(PROVIDER_ACCOUNT_ID) }), PROVIDER_LIMIT) }),
  ],
  [
    PROVIDER_USAGE_RESET_ROUTES.list,
    fields({ accounts: list(fields({ provider, accountId: PROVIDER_ACCOUNT_ID, available: count }), 20) }),
  ],
]);

const REQUESTS: ReadonlyMap<string, AdminDecoder> = new Map([
  [PROVIDER_ACCOUNT_POOL_ROUTES.update, fields({ provider, enabled: boolean, leftOut })],
]);

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}

export function providerManyAccountsResponse(path: string): AdminDecoder | null {
  return RESPONSES.get(pathname(path)) ?? null;
}

export function providerManyAccountsRequest(path: string): AdminDecoder | null {
  return REQUESTS.get(pathname(path)) ?? null;
}
