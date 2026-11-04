// Frozen optional model-visibility-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read every model that one provider of the host lists, and set which of them the model
// picker of that server shows. The host then leaves the other models out of the model list that it
// gives to clients, but keeps each model that an agent of the server uses. Agents, tools and
// automations still reach every model. The settings and update routes are for an owner or admin;
// `requireAdmin` on the host is the only gate. `shown: null` resets a provider to the host's default.
// Every member reads the listing route: for each model of the released model list that the picker
// labels New or folds under Older models, its listing. Widening any of it needs a second capability string.
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
