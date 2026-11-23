import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const MODEL_VISIBILITY_KEPT_CAPABILITY = "model-visibility-kept-v1";

export const MODEL_VISIBILITY_KEPT_ROUTES = {
  list: "/v1/model-visibility/kept",
} as const;

const keptModel = fields({ provider: identifier, id: string(160) });

export const MODEL_VISIBILITY_KEPT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MODEL_VISIBILITY_KEPT_ROUTES.list, adminRoute(empty, fields({ models: list(keptModel, 10_000) }))],
]);
