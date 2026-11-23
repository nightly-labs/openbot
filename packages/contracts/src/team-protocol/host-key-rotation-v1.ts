import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const HOST_KEY_ROTATION_CAPABILITY = "host-key-rotation-v1";

export const HOST_KEY_ROTATION_ROUTES = {
  rotate: "/v1/admin/host/key/rotate",
} as const;

const rotated = fields({ publicKey: string(512) });

export const HOST_KEY_ROTATION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_KEY_ROTATION_ROUTES.rotate, adminRoute(empty, rotated)],
]);
