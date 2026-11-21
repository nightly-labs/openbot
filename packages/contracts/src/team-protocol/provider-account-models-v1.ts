import { adminRoute, boolean, empty, fields, list, type OptionalRouteCodec, string } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_MODELS_CAPABILITY = "provider-account-models-v1";

export const PROVIDER_ACCOUNT_MODELS_ROUTES = {
  list: "/v1/admin/providers/accounts/models",
} as const;

const PROVIDER_LIMIT = 64;
const ACCOUNTS_PER_PROVIDER = 10;
export const PROVIDER_ACCOUNT_MODELS_LIMIT = 1_000;

const effort = string(32);
export const providerAccountModelWire = fields(
  {
    id: string(160),
    name: string(160),
    description: string(2_000),
    defaultReasoningEffort: effort,
    supportedReasoningEfforts: list(effort, 16),
  },
  { reasoningEffortConfigurable: boolean, fastServiceTier: string(64), ultrafastServiceTier: string(64) },
);

export const PROVIDER_ACCOUNT_MODELS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_MODELS_ROUTES.list,
    adminRoute(
      empty,
      fields({
        providers: list(
          fields({
            provider: string(PROVIDER_LIMIT),
            accounts: list(
              fields({
                accountId: PROVIDER_ACCOUNT_ID,
                models: list(providerAccountModelWire, PROVIDER_ACCOUNT_MODELS_LIMIT),
              }),
              ACCOUNTS_PER_PROVIDER,
            ),
          }),
          PROVIDER_LIMIT,
        ),
      }),
    ),
  ],
]);
