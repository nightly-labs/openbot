import { adminRoute, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const WORKFLOWS_MEDIA_CAPABILITY = "workflows-media-v1";

export const WORKFLOWS_MEDIA_ROUTES = {
  keepPicture: "/v1/workflows/media/keep-picture",
} as const;

export const WORKFLOWS_MEDIA_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_MEDIA_ROUTES.keepPicture, adminRoute(fields({ draftId: identifier }), fields({ fileId: identifier }))],
]);
