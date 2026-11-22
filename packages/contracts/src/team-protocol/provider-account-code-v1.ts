import {
  adminRoute,
  count,
  empty,
  fields,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";
import { PROVIDER_ACCOUNT_ID, PROVIDER_ACCOUNTS_MESSAGE_LIMIT } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_CODE_CAPABILITY = "provider-account-code-v1";

export const PROVIDER_ACCOUNT_CODE_ROUTES = {
  start: "/v1/admin/providers/accounts/code/start",
  submit: "/v1/admin/providers/accounts/code/submit",
  status: "/v1/admin/providers/accounts/code/status",
  cancel: "/v1/admin/providers/accounts/code/cancel",
} as const;

const url = string(2048);
const account = fields({ provider: string(64), accountId: PROVIDER_ACCOUNT_ID });

export const PROVIDER_ACCOUNT_CODE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_CODE_ROUTES.start,
    adminRoute(
      fields({ provider: string(64), accountId: nullable(PROVIDER_ACCOUNT_ID) }),
      fields({
        accountId: PROVIDER_ACCOUNT_ID,
        start: variant({
          code: fields(
            { kind: oneOf("code"), userCode: string(64), verificationUrl: url, expiresAt: count },
            { verificationUrlComplete: url },
          ),
          paste: fields({ kind: oneOf("paste"), verificationUrl: url, expiresAt: count }),
          link: fields({ kind: oneOf("link"), verificationUrl: url, expiresAt: count }),
          connected: fields({ kind: oneOf("connected") }),
        }),
      }),
    ),
  ],
  [
    PROVIDER_ACCOUNT_CODE_ROUTES.submit,
    adminRoute(fields({ provider: string(64), accountId: PROVIDER_ACCOUNT_ID, code: string(2048) }), empty),
  ],
  [
    PROVIDER_ACCOUNT_CODE_ROUTES.status,
    adminRoute(
      account,
      fields({ result: nullable(fields({ error: nullable(string(PROVIDER_ACCOUNTS_MESSAGE_LIMIT)) })) }),
    ),
  ],
  [PROVIDER_ACCOUNT_CODE_ROUTES.cancel, adminRoute(account, empty)],
]);
