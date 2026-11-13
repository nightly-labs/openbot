// Frozen optional custom-provider-edit-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list, add, edit and remove the host's custom endpoints. The list, save and delete
// routes are those of `custom-provider-harness-v1`, and each endpoint in a response also names its
// header names, so a client can show which headers an edit keeps. The update route changes an
// endpoint in place, so agents on a kept model stay on it:
//
// - a request with no `apiKey` keeps the saved key; a request cannot clear the key;
// - a request with no `headers` keeps every saved header; a header with a `null` value keeps its
//   saved value; a header that is not in the request is removed;
// - the host keeps the harness of the endpoint and the settings of each model id it keeps;
// - agents on a removed model move to another model of the endpoint, as a save does.
//
// A member cannot use any route; `requireAdmin` on the host is the only gate. Secrets are
// write-only: an endpoint key and a header value travel only in a request body, towards the host,
// and a response says only whether an endpoint has a key and which header names it has. Widening
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

export const CUSTOM_PROVIDER_EDIT_CAPABILITY = "custom-provider-edit-v1";

export const CUSTOM_PROVIDER_EDIT_ROUTES = {
  customList: "/v1/admin/providers/custom-edit/list",
  customSave: "/v1/admin/providers/custom-edit/save",
  customDelete: "/v1/admin/providers/custom-edit/delete",
  customUpdate: "/v1/admin/providers/custom-edit/update",
} as const;

const model = fields({ id: identifier, name: string(160) });
const customSummary = fields({
  id: identifier,
  name: string(80),
  baseUrl: string(2048),
  hasApiKey: boolean,
  models: list(model, 64),
  harness: oneOf("opencode", "pi"),
  headerNames: list(string(128), 32),
});
const customResult = fields({
  providers: list(customSummary, 256),
  restart: oneOf("restarted", "skipped-busy", "not-running"),
});

export const CUSTOM_PROVIDER_EDIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CUSTOM_PROVIDER_EDIT_ROUTES.customList, adminRoute(empty, list(customSummary, 256))],
  [
    CUSTOM_PROVIDER_EDIT_ROUTES.customSave,
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
  [
    CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate,
    adminRoute(
      fields(
        { id: identifier, name: string(80), baseUrl: string(2048), models: list(model, 64) },
        {
          apiKey: string(4096),
          headers: list(fields({ name: string(128), value: nullable(string(4096)) }), 32),
        },
      ),
      customResult,
    ),
  ],
  [CUSTOM_PROVIDER_EDIT_ROUTES.customDelete, adminRoute(fields({ id: identifier }), customResult)],
]);
