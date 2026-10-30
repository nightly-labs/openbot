// Frozen optional discord-access-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server reads and sets which Discord roles can use OpenBot in each Discord server that the host
// connected, and lists that server's roles to choose from. The host asks Discord for the roles
// through Signal. An empty list lets everyone in the Discord server mention OpenBot; with a list,
// the host ignores a mention from a member who has none of those roles. A member cannot use any
// route; `requireAdmin` on the host is the only gate. Widening any of it needs a second capability
// string.
import { adminRoute, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const DISCORD_ACCESS_CAPABILITY = "discord-access-v1";

export const DISCORD_ACCESS_ROUTES = {
  access: "/v1/admin/connectors/discord/access",
  roles: "/v1/admin/connectors/discord/roles",
  update: "/v1/admin/connectors/discord/access/update",
} as const;

const workspace = fields({ workspaceId: identifier });
const role = fields({ id: identifier, name: string(100) });
const access = fields({ allowedRoles: list(role, 50) });

export const DISCORD_ACCESS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [DISCORD_ACCESS_ROUTES.access, adminRoute(workspace, access)],
  [DISCORD_ACCESS_ROUTES.roles, adminRoute(workspace, fields({ roles: list(role, 250) }))],
  [DISCORD_ACCESS_ROUTES.update, adminRoute(fields({ workspaceId: identifier, allowedRoles: list(role, 50) }), access)],
]);
