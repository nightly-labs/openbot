// Frozen optional provider-account-models-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read, for each account after the first of the host's providers, the models that the
// account serves and the provider's own sign-in does not. A plan can serve more models than the
// provider's own sign-in, and `provider-accounts-v1` carries no model list. The client adds these
// models to the model picker of that account. No credential, usage or agent travels on this route.
// A member cannot use it; `requireAdmin` on the host is the only gate, as on `provider-accounts-v1`.
//
// A provider and a reasoning effort are open bounded strings: a client ignores a provider that it
// does not know, and a model whose default effort it does not know. Widening any of it needs a
// second capability string.
import { adminRoute, boolean, empty, fields, list, type OptionalRouteCodec, string } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_MODELS_CAPABILITY = "provider-account-models-v1";

export const PROVIDER_ACCOUNT_MODELS_ROUTES = {
  list: "/v1/admin/providers/accounts/models",
} as const;

const PROVIDER_LIMIT = 64;
const ACCOUNTS_PER_PROVIDER = 10;
/** The most models one account sends. A host leaves out the models after this many. */
export const PROVIDER_ACCOUNT_MODELS_LIMIT = 1_000;

const effort = string(32);
const model = fields(
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
              fields({ accountId: PROVIDER_ACCOUNT_ID, models: list(model, PROVIDER_ACCOUNT_MODELS_LIMIT) }),
              ACCOUNTS_PER_PROVIDER,
            ),
          }),
          PROVIDER_LIMIT,
        ),
      }),
    ),
  ],
]);
