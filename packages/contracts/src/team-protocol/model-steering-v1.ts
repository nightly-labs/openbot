import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const MODEL_STEERING_CAPABILITY = "model-steering-v1";

export const MODEL_STEERING_ROUTES = {
  list: "/v1/model-steering/list",
} as const;

const steeringModel = fields({ provider: identifier, id: string(160) });

export const MODEL_STEERING_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MODEL_STEERING_ROUTES.list, adminRoute(empty, fields({ models: list(steeringModel, 10_000) }))],
]);
