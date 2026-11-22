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
