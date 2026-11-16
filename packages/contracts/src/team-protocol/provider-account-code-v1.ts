// Frozen optional provider-account-code-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can sign an account of a host's provider in with a code. The host starts the provider's
// code sign-in in the folder of that account and answers with the page and the code. The person
// opens the page on any device and types the code there, so no browser on the host is necessary.
// `provider-accounts-v1` lists, renames and removes such an account as any other.
//
// `start` adds an account when `accountId` is null, and signs an account that exists in again. It
// answers with the id of the account and the page to open. A `paste` start has no code: the page
// shows one after the sign-in, and `submit` sends it to the host, which types it into the
// provider's CLI. That code is a credential: it goes in the body, and no reply carries it. `status`
// answers `result: null` while the sign-in runs, and then the result: `error` is null when the
// account is signed in. A new account whose sign-in fails is removed. `cancel` stops the sign-in.
// No route gives a credential back. A member cannot use the routes; `requireAdmin` on the host is
// the only gate, as on `provider-accounts-v1`.
//
// A provider is an open bounded string: the host refuses one whose accounts have no code sign-in.
// Widening any of it needs a second capability string.
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
