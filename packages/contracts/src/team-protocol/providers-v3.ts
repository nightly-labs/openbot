import { adminRoute, count, empty, fields, type OptionalRouteCodec, oneOf, string, variant } from "./admin-wire";

export const PROVIDERS_SIGN_IN_V3_CAPABILITY = "providers-v3";

export const PROVIDERS_SIGN_IN_V3_ROUTES = {
  codeLoginStart: "/v1/admin/providers/v3/code-login/start",
  codeLoginSubmit: "/v1/admin/providers/v3/code-login/submit",
  codeLoginCancel: "/v1/admin/providers/v3/code-login/cancel",
} as const;

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
