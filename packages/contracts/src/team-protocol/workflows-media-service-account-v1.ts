// Frozen optional workflows-media-service-account-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: Apps can have more than one
// account of Sunra or Higgsfield (`mcp-accounts-v1`). A host that advertises this capability lists
// them, and a step chooses the account that pays.
//
// The accounts of a service are its enabled, signed-in Apps rows, in the order of Apps: the row that
// the first connect saved, then the accounts that the person added. The first one is the default.
//
// The `account` field of the `image` node of `workflows-media-v1` then also applies to a Sunra or a
// Higgsfield model. A missing or empty field, and "default", is the first account of the service. An
// `id` of this list is that account. The host makes the file on that account, so its credits pay for
// it. When the host does not have that account for that service, the step fails with the "account
// not found" error: the host never makes the file on another account. This replaces the sentence of
// `workflows-sunra-v1` and `workflows-higgsfield-v1` that a service model ignores the field. The
// `sunra` and `higgsfield` answers of those capabilities, and the catalog and the price of
// `workflows-media-catalog-v1`, stay on the first account.
//
// It adds two routes, which each member who can use workflows can call. Both are reads only; they
// never give a token, an address or a sign-in. `accounts` answers `{ accounts }`: each account with
// its `provider`, its `id` (the id of its Apps row) and its `name`, the name that Apps shows, or null
// for the row of the first connect, which Apps names by the app. `credits` answers `{ accounts }` in the
// same order with `credits` too, as `workflows-sunra-v1` sets it, or null when the service did not
// answer. A client lets a person choose the account of a service step only on a host that advertises
// it. Widening any of it needs a second capability string.
import {
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY = "workflows-media-service-account-v1";

export const WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES = {
  accounts: "/v1/workflows/media/service-accounts",
  credits: "/v1/workflows/media/service-credits",
} as const;

/** The most accounts that one answer lists, of all services together. */
export const WORKFLOWS_MEDIA_SERVICE_ACCOUNT_MAX = 32;

const account = {
  provider: oneOf("sunra", "higgsfield"),
  id: identifier,
  name: nullable(string(80)),
};
const balance = nullable(fields({ available: count, quota: nullable(count) }));

export const WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts,
    adminRoute(empty, fields({ accounts: list(fields(account), WORKFLOWS_MEDIA_SERVICE_ACCOUNT_MAX) })),
  ],
  [
    WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.credits,
    adminRoute(
      empty,
      fields({ accounts: list(fields({ ...account, credits: balance }), WORKFLOWS_MEDIA_SERVICE_ACCOUNT_MAX) }),
    ),
  ],
]);
