// Frozen optional model-visibility-kept-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: every member reads the models
// of the released model list that an admin turned off with `model-visibility-v1`, and that the host
// keeps in that list only because an agent of the server uses them. A client shows each one only in
// a model choice that holds it already, such as the picker of the agent that uses it. It holds no
// more than the model list that the member reads. Widening any of it needs a second capability string.
import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const MODEL_VISIBILITY_KEPT_CAPABILITY = "model-visibility-kept-v1";

export const MODEL_VISIBILITY_KEPT_ROUTES = {
  list: "/v1/model-visibility/kept",
} as const;

const keptModel = fields({ provider: identifier, id: string(160) });

export const MODEL_VISIBILITY_KEPT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MODEL_VISIBILITY_KEPT_ROUTES.list, adminRoute(empty, fields({ models: list(keptModel, 10_000) }))],
]);
