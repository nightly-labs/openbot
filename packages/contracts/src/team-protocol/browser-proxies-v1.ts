import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const BROWSER_PROXIES_CAPABILITY = "browser-proxies-v1";

export const BROWSER_PROXIES_ROUTES = {
  list: "/v1/admin/browser-proxies",
  save: "/v1/admin/browser-proxies/save",
  delete: "/v1/admin/browser-proxies/delete",
  profile: "/v1/admin/browser-profiles/proxy",
  computer: "/v1/admin/browser-proxies/computer",
} as const;

const hexId =
  (message: string): AdminDecoder =>
  (input) => {
    if (typeof input !== "string" || !/^[0-9a-f]{32}$/.test(input)) throw new Error(message);
    return input;
  };
const proxyId = hexId("Invalid browser proxy id.");
const profileId = hexId("Invalid browser profile id.");
const port: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > 65_535)
    throw new Error("Invalid browser proxy port.");
  return input;
};
const summary = fields({
  id: proxyId,
  scheme: oneOf("socks5", "http", "https"),
  host: string(255),
  port,
  username: nullable(string(2048)),
  hasPassword: boolean,
  profileIds: list(profileId, 100),
  failure: nullable(oneOf("unreachable", "signIn")),
});

const computer = fields({
  id: proxyId,
  memberId: string(255),
  name: nullable(string(255)),
  online: boolean,
  mine: boolean,
  profileIds: list(profileId, 100),
  failure: nullable(oneOf("unreachable", "signIn")),
});

export const BROWSER_PROXIES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    BROWSER_PROXIES_ROUTES.list,
    adminRoute(empty, fields({ proxies: list(summary, 50), computers: list(computer, 50) })),
  ],
  [
    BROWSER_PROXIES_ROUTES.save,
    adminRoute(
      fields({ address: string(2048) }, { proxyId, previousAddress: string(2048), keepPassword: boolean }),
      summary,
    ),
  ],
  [BROWSER_PROXIES_ROUTES.delete, adminRoute(fields({ proxyId, profileIds: list(profileId, 100) }), empty)],
  [BROWSER_PROXIES_ROUTES.profile, adminRoute(fields({ profileId, proxyId: nullable(proxyId) }), empty)],
  [BROWSER_PROXIES_ROUTES.computer, adminRoute(empty, computer)],
]);
