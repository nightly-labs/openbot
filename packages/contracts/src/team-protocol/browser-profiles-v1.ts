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
