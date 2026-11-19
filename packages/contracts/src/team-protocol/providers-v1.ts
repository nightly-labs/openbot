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

export const PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS = ["codex"] as const;

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
