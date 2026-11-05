// Frozen optional browser-proxies-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list, add, change and delete the saved proxies of that host's named browser profiles,
// and choose the proxy of each named profile, or none (the proxy settings of the host). An address
// is `scheme://[user[:password]@]host[:port]` with the scheme socks5, http or https. The password goes
// to the host only in a save request; the host keeps it encrypted and never sends it back, and a list
// says only that one is saved. A change of a proxy also sends `previousAddress`, the address without
// the password that the admin changed; when the proxy has a different address now, the host refuses
// the change. A change with `keepPassword` true has no password in its address and keeps the saved
// password. A delete sends the profiles that the admin saw use the proxy; when different profiles use
// it now, the host refuses the delete. A change of a profile's proxy, or of a proxy that profiles use,
// closes the tabs of those profiles. A delete moves its profiles to the host's proxy settings.
// `failure` says why the last page load through the proxy failed: `unreachable` (the proxy did not
// answer or could not reach the site) or `signIn` (the proxy refused the saved sign-in); null when it
// did not fail. A change of it sends
// `browser-profiles-changed` (`browser-profiles-events-v1`), as each change through these routes
// does. A list also has the computers of members (`computers`): each one sends the pages of its
// profiles through the OpenBot desktop app of that member (`browser-egress-v1`). `online` is true
// while that app shares its connection, and `mine` is true for the computer of the member who asks.
// Only `computer` adds one, and only the computer of the member who sends it: no member can add
// the computer of another. The delete and profile routes take a computer id as they take a proxy
// id. A member cannot use these routes;
// `requireAdmin` on the host is the only gate. Bounds and meaning do not follow IPC changes; widening
// any of it needs a second capability string.
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
