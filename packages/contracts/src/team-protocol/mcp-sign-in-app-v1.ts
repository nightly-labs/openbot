import { adminRoute, boolean, fields, identifier, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const MCP_SIGN_IN_APP_CAPABILITY = "mcp-sign-in-app-v1";

export const MCP_SIGN_IN_APP_ROUTES = {
  get: "/v1/admin/mcp-servers/sign-in-app",
  save: "/v1/admin/mcp-servers/sign-in-app/save",
  remove: "/v1/admin/mcp-servers/sign-in-app/remove",
} as const;

const byRow = fields({ mcpServerId: identifier });
const state = fields({
  redirectUrl: nullable(string(2_048)),
  app: nullable(fields({ clientId: string(1_024), secretSaved: boolean, scope: string(2_048) })),
});

export const MCP_SIGN_IN_APP_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MCP_SIGN_IN_APP_ROUTES.get, adminRoute(byRow, state)],
  [
    MCP_SIGN_IN_APP_ROUTES.save,
    adminRoute(
      fields({
        mcpServerId: identifier,
        clientId: string(1_024),
        clientSecret: nullable(string(4_096)),
        scope: string(2_048),
      }),
      state,
    ),
  ],
  [MCP_SIGN_IN_APP_ROUTES.remove, adminRoute(byRow, state)],
]);
