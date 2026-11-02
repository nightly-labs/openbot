// Frozen optional browser-profiles-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list, create, rename, recolor, clear and delete the named browser profiles of that
// host, and choose the profile of each agent: the shared profile, a session of the agent's own, or
// one named profile. The cookies, site data and saved passwords of a profile stay on the host; only
// the profile name, color, agent ids and tab count go over the wire. A clear closes the tabs of the
// profile and signs it out of every site. A delete also moves its agents to the shared profile. A
// change of the agent's profile closes the agent's tabs. Any signed-in member reads the profile name
// and color of each host tab that the member can already see, and nothing about the other tabs. A
// member cannot use the other routes; `requireAdmin` on the host is the only gate. Bounds and meaning
// do not follow IPC changes; widening any of it needs a second capability string.
import {
  type AdminDecoder,
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
  variant,
} from "./admin-wire";

export const BROWSER_PROFILES_CAPABILITY = "browser-profiles-v1";

export const BROWSER_PROFILES_ROUTES = {
  list: "/v1/admin/browser-profiles",
  create: "/v1/admin/browser-profiles/create",
  update: "/v1/admin/browser-profiles/update",
  clear: "/v1/admin/browser-profiles/clear",
  delete: "/v1/admin/browser-profiles/delete",
  agent: "/v1/admin/agents/browser-profile",
  updateAgent: "/v1/admin/agents/browser-profile/update",
  tabs: "/v1/browser/tab-profiles",
} as const;

const profileId: AdminDecoder = (input) => {
  if (typeof input !== "string" || !/^[0-9a-f]{32}$/.test(input)) throw new Error("Invalid browser profile id.");
  return input;
};
const name = string(60);
const hue: AdminDecoder = (input) => {
  if (typeof input !== "number" || ![0, 30, 55, 100, 150, 185, 215, 245, 280, 320].includes(input))
    throw new Error("Invalid browser profile color.");
  return input;
};
const agentIds = list(identifier, 10_000);
const summary = fields({ id: profileId, name, hue, agentIds, tabCount: count });
const choice = variant({
  shared: fields({ kind: oneOf("shared") }),
  agent: fields({ kind: oneOf("agent") }),
  profile: fields({ kind: oneOf("profile"), profileId }),
});

/** Exactly one of `profileId` and `agentId`: the named profile, or the agent's own session. */
const clearTarget: AdminDecoder = (input) => {
  const decoded = fields({}, { profileId, agentId: identifier })(input);
  const keys = decoded && typeof decoded === "object" ? Object.keys(decoded) : [];
  if (keys.length !== 1) throw new Error("Invalid browser data clear request.");
  return decoded;
};

export const BROWSER_PROFILES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_PROFILES_ROUTES.list, adminRoute(empty, fields({ profiles: list(summary, 100), sharedAgentIds: agentIds }))],
  [BROWSER_PROFILES_ROUTES.create, adminRoute(fields({ name }), summary)],
  [BROWSER_PROFILES_ROUTES.update, adminRoute(fields({ profileId }, { name, hue }), summary)],
  [BROWSER_PROFILES_ROUTES.clear, adminRoute(clearTarget, empty)],
  [BROWSER_PROFILES_ROUTES.delete, adminRoute(fields({ profileId }), empty)],
  [BROWSER_PROFILES_ROUTES.agent, adminRoute(fields({ agentId: identifier }), choice)],
  [BROWSER_PROFILES_ROUTES.updateAgent, adminRoute(fields({ agentId: identifier, profile: choice }), choice)],
  [
    BROWSER_PROFILES_ROUTES.tabs,
    adminRoute(
      empty,
      fields({ tabs: list(fields({ tabId: identifier, name: nullable(name), hue: nullable(hue) }), 1000) }),
    ),
  ],
]);
