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
