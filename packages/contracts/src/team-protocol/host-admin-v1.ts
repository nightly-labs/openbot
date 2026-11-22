import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const HOST_ADMIN_CAPABILITY = "host-admin-v1";

export const HOST_ADMIN_ROUTES = {
  identity: "/v1/admin/host/identity",
} as const;

const LOGO_BASE64_LIMIT = 699_052;

export const HOST_ADMIN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    HOST_ADMIN_ROUTES.identity,
    adminRoute(
      fields(
        {},
        {
          serverName: string(32),
          logo: nullable(
            fields({ mimeType: oneOf("image/png", "image/jpeg", "image/webp"), data: string(LOGO_BASE64_LIMIT) }),
          ),
        },
      ),
      empty,
    ),
  ],
]);
