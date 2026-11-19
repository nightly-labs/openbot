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
