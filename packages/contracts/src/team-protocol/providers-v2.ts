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
