import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const AGENT_HOST_SETTINGS_CAPABILITY = "agent-host-settings-v1";

export const AGENT_HOST_SETTINGS_ROUTES = {
  settings: "/v1/admin/agents/host-settings",
  update: "/v1/admin/agents/host-settings/update",
} as const;

const mode = oneOf("queue", "steer");
const settings: AdminDecoder = fields({
  computerUse: boolean,
  allowAutomation: boolean,
  busyMessageMode: nullable(mode),
  defaultBusyMessageMode: mode,
});

export const AGENT_HOST_SETTINGS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_HOST_SETTINGS_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [
    AGENT_HOST_SETTINGS_ROUTES.update,
    adminRoute(
      fields(
        { agentId: identifier },
        { computerUse: boolean, allowAutomation: boolean, busyMessageMode: nullable(mode) },
      ),
      settings,
    ),
  ],
]);
