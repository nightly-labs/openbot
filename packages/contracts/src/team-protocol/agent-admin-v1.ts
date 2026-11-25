import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const AGENT_ADMIN_CAPABILITY = "agent-admin-v1";

export const AGENT_ADMIN_ROUTES = {
  settings: "/v1/admin/agents/settings",
  update: "/v1/admin/agents/settings/update",
} as const;

const access = oneOf("full", "workspace");
const settings: AdminDecoder = fields({ access, autoApprove: boolean, autoApproveLocked: boolean });

export const AGENT_ADMIN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_ADMIN_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_ADMIN_ROUTES.update, adminRoute(fields({ agentId: identifier }, { access, autoApprove: boolean }), settings)],
]);
