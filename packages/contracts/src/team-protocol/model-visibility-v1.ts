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

export const MODEL_VISIBILITY_CAPABILITY = "model-visibility-v1";

export const MODEL_VISIBILITY_ROUTES = {
  settings: "/v1/admin/host/model-visibility",
  update: "/v1/admin/host/model-visibility/update",
  listing: "/v1/model-visibility/listing",
} as const;

const modelIds = list(string(160), 10_000);

const snapshot = fields({
  provider: identifier,
  models: list(fields({ id: string(160), name: string(160) }), 10_000),
  shown: modelIds,
  changed: boolean,
});

const listing = fields({ provider: identifier, id: string(160), listing: oneOf("new", "older") });

export const MODEL_VISIBILITY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MODEL_VISIBILITY_ROUTES.settings, adminRoute(fields({ provider: identifier }), snapshot)],
  [MODEL_VISIBILITY_ROUTES.update, adminRoute(fields({ provider: identifier, shown: nullable(modelIds) }), snapshot)],
  [MODEL_VISIBILITY_ROUTES.listing, adminRoute(empty, fields({ models: list(listing, 10_000) }))],
]);
