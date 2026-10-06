// Frozen optional providers-v4 wire contract.
//
// It adds Cursor (`cursor`) and Cline (`cline`) to the managed CLI runtimes of `providers-v2` and to
// the sign-in on another device of `providers-v3`, for a host whose browser nobody can see. An owner
// or admin of a server can read the host's runtimes, download or cancel one, and start, answer or
// cancel a sign-in. A member cannot use any route; `requireAdmin` on the host is the only gate.
//
// The sign-in kinds are those of `providers-v3`, plus `link`: a page that signs the provider's CLI in
// by itself, with no code to confirm or copy (Cursor). Cline signs in with a device `code`. A host
// advertises this whenever it has provider admin, so a client offers the Claude `paste` sign-in only
// when the host also advertises `providers-v3`, which a host does only where it can run that flow.
// How a sign-in ends arrives as the host's agent status, as for `providers-v1`. A runtime message
// longer than 1024 characters is cut by the host before it is sent. `providers-v1` to `providers-v3`
// stay as they were.
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

/** The providers these routes sign in. */
export const PROVIDERS_V4_SIGN_IN_PROVIDERS = ["codex", "claude", "grok", "cursor", "cline"] as const;
/** The managed runtimes these routes read, download and cancel. */
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
