// Provider administration for Pi and Muse. Earlier contracts remain unchanged.
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

export const PROVIDERS_V5_CAPABILITY = "providers-v5";

export const PROVIDERS_V5_ROUTES = {
  codeLoginStart: "/v1/admin/providers/v5/code-login/start",
  codeLoginSubmit: "/v1/admin/providers/v5/code-login/submit",
  codeLoginCancel: "/v1/admin/providers/v5/code-login/cancel",
  apiKeyState: "/v1/admin/providers/v5/api-key/state",
  apiKeySet: "/v1/admin/providers/v5/api-key/set",
  apiKeyClear: "/v1/admin/providers/v5/api-key/clear",
  runtimesStatus: "/v1/admin/providers/v5/runtimes/status",
  runtimesDownload: "/v1/admin/providers/v5/runtimes/download",
  runtimesCancel: "/v1/admin/providers/v5/runtimes/cancel",
  runtimesCheck: "/v1/admin/providers/v5/runtimes/check-updates",
} as const;

/** The providers these routes sign in. */
export const PROVIDERS_V5_SIGN_IN_PROVIDERS = ["codex", "claude", "grok", "cursor", "cline"] as const;
/** The managed runtimes these routes read, download and cancel. */
export const PROVIDERS_V5_RUNTIME_PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "pi",
  "muse",
] as const;

const signInProvider = fields({ provider: oneOf(...PROVIDERS_V5_SIGN_IN_PROVIDERS) });
const runtimeProvider = fields({ provider: oneOf(...PROVIDERS_V5_RUNTIME_PROVIDERS) });
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
    pi: runtime,
    muse: runtime,
  }),
  toolRuntimes: fields({ bun: runtime }),
});

export const PROVIDERS_V5_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDERS_V5_ROUTES.apiKeyState,
    adminRoute(runtimeProvider, fields({ status: oneOf("missing", "saved", "unreadable") })),
  ],
  [
    PROVIDERS_V5_ROUTES.apiKeySet,
    adminRoute(fields({ provider: oneOf(...PROVIDERS_V5_RUNTIME_PROVIDERS), key: string(512) }), empty),
  ],
  [PROVIDERS_V5_ROUTES.apiKeyClear, adminRoute(runtimeProvider, empty)],
  [
    PROVIDERS_V5_ROUTES.codeLoginStart,
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
    PROVIDERS_V5_ROUTES.codeLoginSubmit,
    adminRoute(fields({ provider: oneOf(...PROVIDERS_V5_SIGN_IN_PROVIDERS), code: string(2048) }), empty),
  ],
  [PROVIDERS_V5_ROUTES.codeLoginCancel, adminRoute(signInProvider, empty)],
  [PROVIDERS_V5_ROUTES.runtimesStatus, adminRoute(empty, snapshot)],
  [PROVIDERS_V5_ROUTES.runtimesDownload, adminRoute(runtimeProvider, snapshot)],
  [PROVIDERS_V5_ROUTES.runtimesCancel, adminRoute(runtimeProvider, snapshot)],
  [PROVIDERS_V5_ROUTES.runtimesCheck, adminRoute(empty, snapshot)],
]);
