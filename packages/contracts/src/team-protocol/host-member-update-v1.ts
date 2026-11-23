import { empty, type OptionalRouteCodec } from "./admin-wire";
import { HOST_UPDATE_CODECS, HOST_UPDATE_ROUTES } from "./host-update-v1";

export const HOST_MEMBER_UPDATE_CAPABILITY = "host-member-update-v1";
export const HOST_MEMBER_UPDATE_ROUTES = {
  status: "/v1/host/update/status",
  check: "/v1/host/update/check",
  start: "/v1/host/update/start",
} as const;

export const HOST_MEMBER_UPDATE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map(
  [...HOST_UPDATE_CODECS].flatMap(([path, codec]) => {
    const route = memberUpdateRoute(path);
    return route ? [[route, { request: empty, response: codec.response }] as const] : [];
  }),
);

export function memberUpdateRoute(adminRoute: string) {
  switch (adminRoute) {
    case HOST_UPDATE_ROUTES.status:
      return HOST_MEMBER_UPDATE_ROUTES.status;
    case HOST_UPDATE_ROUTES.check:
      return HOST_MEMBER_UPDATE_ROUTES.check;
    case HOST_UPDATE_ROUTES.start:
      return HOST_MEMBER_UPDATE_ROUTES.start;
    default:
      return undefined;
  }
}
