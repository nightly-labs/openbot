// Frozen optional provider-account-keys-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can give an account of a host's provider an API key of that provider. For a provider whose
// CLI holds one sign-in only, such as Cursor, each account after the first is one key: the host
// keeps the key encrypted, and the processes of the agents on that account get it in their
// environment. `provider-accounts-v1` lists, renames and removes such an account as any other; its
// sign-in routes refuse it, because it has no browser sign-in.
//
// `connect` adds an account when `accountId` is null, and replaces the key of an account that
// exists. It answers when the provider accepted the key. When the provider refuses the key, the
// route fails with the reason: a new account is then removed, and another one keeps its last key.
// The key travels to the host only; no route gives a key back. A member cannot use the route;
// `requireAdmin` on the host is the only gate, as on `provider-accounts-v1`.
//
// A provider is an open bounded string: the host refuses one whose accounts are not keys. Widening
// any of it needs a second capability string.
import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_KEYS_CAPABILITY = "provider-account-keys-v1";

export const PROVIDER_ACCOUNT_KEYS_ROUTES = {
  connect: "/v1/admin/providers/accounts/key/connect",
} as const;

export const PROVIDER_ACCOUNT_KEYS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_KEYS_ROUTES.connect,
    adminRoute(fields({ provider: string(64), accountId: nullable(PROVIDER_ACCOUNT_ID), key: string(512) }), empty),
  ],
]);
