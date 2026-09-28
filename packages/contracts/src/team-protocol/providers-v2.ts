// Frozen optional providers-v2 wire contract.
//
// It adds Gemini (`antigravity`) to the managed CLI runtimes of `providers-v1`, and nothing else:
// an owner or admin of a server can read the host's runtimes, and download or cancel the host's
// Gemini runtime as for the other providers. Sign-in, API keys and custom endpoints stay on
// `providers-v1`. Gemini signs in through a browser on the host, so no route here signs it in.
// The same `requireAdmin` gate applies on the host. A runtime message longer than 1024 characters is
// cut by the host before it is sent.
import { adminRoute, count, empty, fields, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const PROVIDERS_RUNTIMES_V2_CAPABILITY = "providers-v2";

export const PROVIDERS_RUNTIMES_V2_ROUTES = {
  runtimesStatus: "/v1/admin/providers/v2/runtimes/status",
  runtimesDownload: "/v1/admin/providers/v2/runtimes/download",
  runtimesCancel: "/v1/admin/providers/v2/runtimes/cancel",
  runtimesCheck: "/v1/admin/providers/v2/runtimes/check-updates",
} as const;

const byProvider = fields({ provider: oneOf("codex", "claude", "grok", "opencode", "antigravity") });
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
  providers: fields({ codex: runtime, claude: runtime, grok: runtime, opencode: runtime, antigravity: runtime }),
  toolRuntimes: fields({ bun: runtime }),
});

export const PROVIDERS_RUNTIMES_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus, adminRoute(empty, snapshot)],
  [PROVIDERS_RUNTIMES_V2_ROUTES.runtimesDownload, adminRoute(byProvider, snapshot)],
  [PROVIDERS_RUNTIMES_V2_ROUTES.runtimesCancel, adminRoute(byProvider, snapshot)],
  [PROVIDERS_RUNTIMES_V2_ROUTES.runtimesCheck, adminRoute(empty, snapshot)],
]);
