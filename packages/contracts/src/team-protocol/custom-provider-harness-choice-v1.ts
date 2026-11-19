// Frozen optional custom-provider-harness-choice-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can choose the harness that runs each of the host's custom endpoints, `opencode` or `pi`,
// as on the host's own computer. Its routes do what those of `custom-provider-edit-v1` do, and a save
// and an update also name the harness:
//
// - a save runs the endpoint on the harness that it names;
// - an update moves the endpoint to the harness that it names, and agents on a kept model move with
//   it, as an edit on the host's own computer does;
// - all other rules are those of `custom-provider-edit-v1`: a request with no `apiKey` keeps the
//   saved key, a header with a `null` value keeps its saved value, and the host keeps the settings
//   of each model id that it keeps.
//
// A member cannot use any route; `requireAdmin` on the host is the only gate. Secrets are
// write-only, as in `custom-provider-edit-v1`. Widening any of it needs a second capability string.
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

export const CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY = "custom-provider-harness-choice-v1";

export const CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES = {
  customList: "/v1/admin/providers/custom-harness-choice/list",
  customSave: "/v1/admin/providers/custom-harness-choice/save",
  customDelete: "/v1/admin/providers/custom-harness-choice/delete",
  customUpdate: "/v1/admin/providers/custom-harness-choice/update",
} as const;

const harness = oneOf("opencode", "pi");
const model = fields({ id: identifier, name: string(160) });
const customSummary = fields({
  id: identifier,
  name: string(80),
  baseUrl: string(2048),
  hasApiKey: boolean,
  models: list(model, 64),
  harness,
  headerNames: list(string(128), 32),
});
const customResult = fields({
  providers: list(customSummary, 256),
  restart: oneOf("restarted", "skipped-busy", "not-running"),
});

export const CUSTOM_PROVIDER_HARNESS_CHOICE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customList, adminRoute(empty, list(customSummary, 256))],
  [
    CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customSave,
    adminRoute(
      fields({
        id: identifier,
        name: string(80),
        baseUrl: string(2048),
        apiKey: nullable(string(4096)),
        models: list(model, 64),
        headers: list(fields({ name: string(128), value: string(4096) }), 32),
        harness,
      }),
      customResult,
    ),
  ],
  [
    CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customUpdate,
    adminRoute(
      fields(
        { id: identifier, name: string(80), baseUrl: string(2048), models: list(model, 64), harness },
        {
          apiKey: string(4096),
          headers: list(fields({ name: string(128), value: nullable(string(4096)) }), 32),
        },
      ),
      customResult,
    ),
  ],
  [CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customDelete, adminRoute(fields({ id: identifier }), customResult)],
]);
