// Frozen optional host-admin-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can change the host's server name and logo. The host makes the change with the account
// signed in on it, as when the change is made on the host. A member cannot use the route;
// `requireAdmin` on the host is the only gate.
//
// An absent field is left unchanged, and a `null` logo removes it. The logo travels as base64 of a
// PNG, JPEG or WebP image of at most 512 KiB; the host checks the decoded image again. The response
// is empty: the client reads the new name and logo the way it reads them after any identity change.
// Publishing, unpublishing and the host's own permissions are not here, because they are decided on
// the host. Widening any of it needs a second capability string.
import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const HOST_ADMIN_CAPABILITY = "host-admin-v1";

export const HOST_ADMIN_ROUTES = {
  identity: "/v1/admin/host/identity",
} as const;

/** Base64 of 512 KiB: `ceil(524288 / 3) * 4`. */
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
