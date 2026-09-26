// Frozen optional agent-admin-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change how far each agent reaches on the host (`access`) and whether the
// host answers that agent's approvals by itself (`autoApprove`). A member cannot use either route;
// `requireAdmin` on the host is the only gate. Turbo mode stays on the host: the client reads it as
// `autoApproveLocked` and cannot change it. Widening any of it needs a second capability string.
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
