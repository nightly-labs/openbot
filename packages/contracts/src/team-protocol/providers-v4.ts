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

export const PROVIDERS_V4_CAPABILITY = "providers-v4";

export const PROVIDERS_V4_ROUTES = {
  codeLoginStart: "/v1/admin/providers/v4/code-login/start",
  codeLoginSubmit: "/v1/admin/providers/v4/code-login/submit",
  codeLoginCancel: "/v1/admin/providers/v4/code-login/cancel",
  runtimesStatus: "/v1/admin/providers/v4/runtimes/status",
  runtimesDownload: "/v1/admin/providers/v4/runtimes/download",
  runtimesCancel: "/v1/admin/providers/v4/runtimes/cancel",
  runtimesCheck: "/v1/admin/providers/v4/runtimes/check-updates",
} as const;

export const PROVIDERS_V4_SIGN_IN_PROVIDERS = ["codex", "claude", "grok", "cursor", "cline"] as const;
export const PROVIDERS_V4_RUNTIME_PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
] as const;

const signInProvider = fields({ provider: oneOf(...PROVIDERS_V4_SIGN_IN_PROVIDERS) });
const runtimeProvider = fields({ provider: oneOf(...PROVIDERS_V4_RUNTIME_PROVIDERS) });
const url = string(2048);
const version = nullable(string(128));
const runtime = fields(
  {
    phase: oneOf("not-downloaded", "downloading", "finishing", "ready", "download-error"),
    progress: nullable(count),
    message: nullable(string(1024)),
    version,
  },
  { availableVersion: version },
);
const snapshot = fields({
  revision: count,
  providers: fields({
    codex: runtime,
    claude: runtime,
    grok: runtime,
    opencode: runtime,
    antigravity: runtime,
    cursor: runtime,
    cline: runtime,
  }),
  toolRuntimes: fields({ bun: runtime }),
});

export const PROVIDERS_V4_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDERS_V4_ROUTES.codeLoginStart,
    adminRoute(
      signInProvider,
      variant({
        code: fields(
          { kind: oneOf("code"), userCode: string(64), verificationUrl: url, expiresAt: count },
          { verificationUrlComplete: url },
        ),
        paste: fields({ kind: oneOf("paste"), verificationUrl: url, expiresAt: count }),
        link: fields({ kind: oneOf("link"), verificationUrl: url, expiresAt: count }),
        connected: fields({ kind: oneOf("connected") }),
      }),
    ),
  ],
  [
    PROVIDERS_V4_ROUTES.codeLoginSubmit,
    adminRoute(fields({ provider: oneOf(...PROVIDERS_V4_SIGN_IN_PROVIDERS), code: string(2048) }), empty),
  ],
  [PROVIDERS_V4_ROUTES.codeLoginCancel, adminRoute(signInProvider, empty)],
  [PROVIDERS_V4_ROUTES.runtimesStatus, adminRoute(empty, snapshot)],
  [PROVIDERS_V4_ROUTES.runtimesDownload, adminRoute(runtimeProvider, snapshot)],
  [PROVIDERS_V4_ROUTES.runtimesCancel, adminRoute(runtimeProvider, snapshot)],
  [PROVIDERS_V4_ROUTES.runtimesCheck, adminRoute(empty, snapshot)],
]);
