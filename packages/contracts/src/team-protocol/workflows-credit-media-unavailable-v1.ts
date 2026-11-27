import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_CAPABILITY = "workflows-credit-media-unavailable-v1";

export const WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_ROUTES = {
  list: "/v1/workflows/media/credit/unavailable",
} as const;

const unavailableModel = fields({
  id: identifier,
  name: string(160),
  kinds: list(oneOf("image", "video"), 2),
});

export const WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_ROUTES.list, adminRoute(empty, fields({ models: list(unavailableModel, 1000) }))],
]);
