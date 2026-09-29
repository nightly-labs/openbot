// Frozen optional providers-v3 wire contract.
//
// It adds sign-in on another device for Claude and Grok to the Codex device code of `providers-v1`,
// for a host whose browser nobody can see, such as a hosted server. An owner or admin of a server can
// start a code sign-in for Codex, Claude or Grok on the host, type the code the provider's page showed
// into the host's Claude sign-in, and cancel a sign-in. A member cannot use any route; `requireAdmin`
// on the host is the only gate.
//
// `code` is a device code the user confirms on the provider's page (Codex, Grok). `paste` is a page
// that shows a code after the user signs in, which the user sends back with `submit` (Claude). The
// pasted code is a credential and travels only in a request body, towards the host; no response
// carries it. How a sign-in ends arrives as the host's agent status, as for `providers-v1`.
// `providers-v1` stays as it was: its start route signs in Codex only.
import { adminRoute, count, empty, fields, type OptionalRouteCodec, oneOf, string, variant } from "./admin-wire";

export const PROVIDERS_SIGN_IN_V3_CAPABILITY = "providers-v3";

export const PROVIDERS_SIGN_IN_V3_ROUTES = {
  codeLoginStart: "/v1/admin/providers/v3/code-login/start",
  codeLoginSubmit: "/v1/admin/providers/v3/code-login/submit",
  codeLoginCancel: "/v1/admin/providers/v3/code-login/cancel",
} as const;

/** The providers these routes sign in. */
export const PROVIDERS_SIGN_IN_V3_PROVIDERS = ["codex", "claude", "grok"] as const;

const byProvider = fields({ provider: oneOf(...PROVIDERS_SIGN_IN_V3_PROVIDERS) });
const url = string(2048);

export const PROVIDERS_SIGN_IN_V3_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginStart,
    adminRoute(
      byProvider,
      variant({
        code: fields(
          { kind: oneOf("code"), userCode: string(64), verificationUrl: url, expiresAt: count },
          { verificationUrlComplete: url },
        ),
        paste: fields({ kind: oneOf("paste"), verificationUrl: url, expiresAt: count }),
        connected: fields({ kind: oneOf("connected") }),
      }),
    ),
  ],
  [
    PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginSubmit,
    adminRoute(fields({ provider: oneOf(...PROVIDERS_SIGN_IN_V3_PROVIDERS), code: string(2048) }), empty),
  ],
  [PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginCancel, adminRoute(byProvider, empty)],
]);
