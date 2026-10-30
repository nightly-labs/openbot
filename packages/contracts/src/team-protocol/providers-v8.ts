// Provider administration with open provider ids. A provider id is any value that `OPEN_PROVIDER_ID`
// matches, and each runtime snapshot is a list of rows keyed by id, so a new provider needs no new
// route set. The host still refuses a provider that it cannot sign in or download. Earlier
// contracts remain unchanged.

import { isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";

export const PROVIDERS_V8_CAPABILITY = "providers-v8";

export const PROVIDERS_V8_ROUTES = {
  codeLoginStart: "/v1/admin/providers/v8/code-login/start",
  codeLoginSubmit: "/v1/admin/providers/v8/code-login/submit",
  codeLoginCancel: "/v1/admin/providers/v8/code-login/cancel",
  apiKeyState: "/v1/admin/providers/v8/api-key/state",
  apiKeySet: "/v1/admin/providers/v8/api-key/set",
  apiKeyClear: "/v1/admin/providers/v8/api-key/clear",
  runtimesStatus: "/v1/admin/providers/v8/runtimes/status",
  runtimesDownload: "/v1/admin/providers/v8/runtimes/download",
  runtimesCancel: "/v1/admin/providers/v8/runtimes/cancel",
  runtimesCheck: "/v1/admin/providers/v8/runtimes/check-updates",
} as const;

/** The most runtime rows that one snapshot carries. */
export const PROVIDERS_V8_RUNTIME_LIMIT = 64;

const providerId: AdminDecoder = (value) => {
  if (!isString(value) || !OPEN_PROVIDER_ID.test(value)) throw new Error("Invalid admin provider.");
  return value;
};
const provider = fields({ provider: providerId });
const url = string(2048);
const version = nullable(string(128));
const runtime = fields(
  {
    id: providerId,
    phase: oneOf("not-downloaded", "downloading", "finishing", "ready", "download-error"),
    progress: nullable(count),
    message: nullable(string(1024)),
    version,
  },
  { availableVersion: version },
);
const snapshot = fields({
  revision: count,
  providers: list(runtime, PROVIDERS_V8_RUNTIME_LIMIT),
  toolRuntimes: list(runtime, PROVIDERS_V8_RUNTIME_LIMIT),
});

export const PROVIDERS_V8_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDERS_V8_ROUTES.apiKeyState, adminRoute(provider, fields({ status: oneOf("missing", "saved", "unreadable") }))],
  [PROVIDERS_V8_ROUTES.apiKeySet, adminRoute(fields({ provider: providerId, key: string(512) }), empty)],
  [PROVIDERS_V8_ROUTES.apiKeyClear, adminRoute(provider, empty)],
  [
    PROVIDERS_V8_ROUTES.codeLoginStart,
    adminRoute(
      provider,
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
  [PROVIDERS_V8_ROUTES.codeLoginSubmit, adminRoute(fields({ provider: providerId, code: string(2048) }), empty)],
  [PROVIDERS_V8_ROUTES.codeLoginCancel, adminRoute(provider, empty)],
  [PROVIDERS_V8_ROUTES.runtimesStatus, adminRoute(empty, snapshot)],
  [PROVIDERS_V8_ROUTES.runtimesDownload, adminRoute(provider, snapshot)],
  [PROVIDERS_V8_ROUTES.runtimesCancel, adminRoute(provider, snapshot)],
  [PROVIDERS_V8_ROUTES.runtimesCheck, adminRoute(empty, snapshot)],
]);
