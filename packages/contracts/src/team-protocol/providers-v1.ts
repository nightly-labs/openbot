// Frozen optional providers-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can sign the host's providers in with a device code, store or clear a provider API key on
// the host, download or cancel the host's managed CLI runtimes, and add or remove the host's custom
// OpenCode endpoints. A member cannot use any route; `requireAdmin` on the host is the only gate.
//
// Secrets are write-only. A provider key, a custom endpoint key and a header value travel only in a
// request body, towards the host. No response carries one: key state is `missing`, `saved` or
// `unreadable`, and a custom endpoint says only whether it has a key. The browser sign-in is not
// here, because it opens a browser on the host. A runtime message longer than 1024 characters is cut
// by the host before it is sent. Widening any of it needs a second capability string.
import {
  adminRoute,
  boolean,
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

export const PROVIDERS_ADMIN_CAPABILITY = "providers-v1";

export const PROVIDERS_ADMIN_ROUTES = {
  codeLoginStart: "/v1/admin/providers/code-login/start",
  codeLoginCancel: "/v1/admin/providers/code-login/cancel",
  apiKeyState: "/v1/admin/providers/api-key/state",
  apiKeySet: "/v1/admin/providers/api-key/set",
  apiKeyClear: "/v1/admin/providers/api-key/clear",
  runtimesStatus: "/v1/admin/providers/runtimes/status",
  runtimesDownload: "/v1/admin/providers/runtimes/download",
  runtimesCancel: "/v1/admin/providers/runtimes/cancel",
  runtimesCheck: "/v1/admin/providers/runtimes/check-updates",
  customList: "/v1/admin/providers/custom/list",
  customSave: "/v1/admin/providers/custom/save",
  customDelete: "/v1/admin/providers/custom/delete",
} as const;

const provider = oneOf("codex", "claude", "grok", "opencode");
const byProvider = fields({ provider });
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
  providers: fields({ codex: runtime, claude: runtime, grok: runtime, opencode: runtime }),
  toolRuntimes: fields({ bun: runtime }),
});
const model = fields({ id: identifier, name: string(160) });
const name = string(80);
const customSummary = fields({
  id: identifier,
  name,
  baseUrl: string(2048),
  hasApiKey: boolean,
  models: list(model, 64),
});
const customResult = fields({
  providers: list(customSummary, 256),
  restart: oneOf("restarted", "skipped-busy", "not-running"),
});

export const PROVIDERS_ADMIN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDERS_ADMIN_ROUTES.codeLoginStart,
    adminRoute(
      byProvider,
      fields(
        { kind: oneOf("code", "connected") },
        { userCode: string(64), verificationUrl: string(2048), expiresAt: count },
      ),
    ),
  ],
  [PROVIDERS_ADMIN_ROUTES.codeLoginCancel, adminRoute(byProvider, empty)],
  [
    PROVIDERS_ADMIN_ROUTES.apiKeyState,
    adminRoute(byProvider, fields({ status: oneOf("missing", "saved", "unreadable") })),
  ],
  [PROVIDERS_ADMIN_ROUTES.apiKeySet, adminRoute(fields({ provider, key: string(512) }), empty)],
  [PROVIDERS_ADMIN_ROUTES.apiKeyClear, adminRoute(byProvider, empty)],
  [PROVIDERS_ADMIN_ROUTES.runtimesStatus, adminRoute(empty, snapshot)],
  [PROVIDERS_ADMIN_ROUTES.runtimesDownload, adminRoute(byProvider, snapshot)],
  [PROVIDERS_ADMIN_ROUTES.runtimesCancel, adminRoute(byProvider, snapshot)],
  [PROVIDERS_ADMIN_ROUTES.runtimesCheck, adminRoute(empty, snapshot)],
  [PROVIDERS_ADMIN_ROUTES.customList, adminRoute(empty, list(customSummary, 256))],
  [
    PROVIDERS_ADMIN_ROUTES.customSave,
    adminRoute(
      fields({
        id: identifier,
        name,
        baseUrl: string(2048),
        apiKey: nullable(string(4096)),
        models: list(model, 64),
        headers: list(fields({ name: string(128), value: string(4096) }), 32),
      }),
      customResult,
    ),
  ],
  [PROVIDERS_ADMIN_ROUTES.customDelete, adminRoute(fields({ id: identifier }), customResult)],
]);
