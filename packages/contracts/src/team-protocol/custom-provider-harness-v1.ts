// Frozen optional custom-provider-harness-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list, add and remove the host's custom endpoints, as `providers-v1` does, and each
// endpoint in a response also names the harness that runs it on the host: `opencode` or `pi`. A save
// names no harness: the host runs a new endpoint on OpenCode and keeps the harness of an endpoint it
// has. A member cannot use any route; `requireAdmin` on the host is the only gate.
//
// Secrets are write-only, as in `providers-v1`: an endpoint key and a header value travel only in a
// request body, towards the host, and a response says only whether an endpoint has a key. Widening
// any of it needs a second capability string.
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const CUSTOM_PROVIDER_HARNESS_CAPABILITY = "custom-provider-harness-v1";

export const CUSTOM_PROVIDER_HARNESS_ROUTES = {
  customList: "/v1/admin/providers/custom-harness/list",
  customSave: "/v1/admin/providers/custom-harness/save",
  customDelete: "/v1/admin/providers/custom-harness/delete",
} as const;

const model = fields({ id: identifier, name: string(160) });
const customSummary = fields({
  id: identifier,
  name: string(80),
  baseUrl: string(2048),
  hasApiKey: boolean,
  models: list(model, 64),
  harness: oneOf("opencode", "pi"),
});
const customResult = fields({
  providers: list(customSummary, 256),
  restart: oneOf("restarted", "skipped-busy", "not-running"),
});

export const CUSTOM_PROVIDER_HARNESS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CUSTOM_PROVIDER_HARNESS_ROUTES.customList, adminRoute(empty, list(customSummary, 256))],
  [
    CUSTOM_PROVIDER_HARNESS_ROUTES.customSave,
    adminRoute(
      fields({
        id: identifier,
        name: string(80),
        baseUrl: string(2048),
        apiKey: nullable(string(4096)),
        models: list(model, 64),
        headers: list(fields({ name: string(128), value: string(4096) }), 32),
      }),
      customResult,
    ),
  ],
  [CUSTOM_PROVIDER_HARNESS_ROUTES.customDelete, adminRoute(fields({ id: identifier }), customResult)],
]);
