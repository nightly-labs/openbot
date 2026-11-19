import {
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const HOSTED_SITES_CAPABILITY = "hosted-sites-v1";

export const HOSTED_SITES_ROUTES = {
  list: "/v1/hosted-sites/list",
  remove: "/v1/hosted-sites/delete",
} as const;

const timestamp = string(64);
const site = fields({
  id: identifier,
  hostname: string(253),
  url: string(2_048),
  title: string(1_024),
  description: string(4_096),
  framework: oneOf("vanilla", "astro"),
  status: oneOf("active", "deleted", "expired", "blocked"),
  fileCount: count,
  size: count,
  expiresAt: nullable(timestamp),
  updatedAt: timestamp,
  serverId: nullable(identifier),
});

export const HOSTED_SITES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOSTED_SITES_ROUTES.list, adminRoute(empty, fields({ sites: list(site, 1_000), limit: count, used: count }))],
  [HOSTED_SITES_ROUTES.remove, adminRoute(fields({ siteId: identifier }), empty)],
]);
