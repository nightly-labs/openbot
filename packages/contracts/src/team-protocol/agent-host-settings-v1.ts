// Frozen optional agent-host-settings-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change three settings of each agent that act only on the host: whether the
// agent gets the Computer Use tools there (`computerUse`), whether a script on the host can run its
// routines, send messages, and answer questions and approvals (`allowAutomation`), and what a message
// sent while the agent works does (`busyMessageMode`; null follows the host default). The host default stays a
// local choice: the client reads it as `defaultBusyMessageMode` and cannot change it. A member
// cannot use either route; `requireAdmin` on the host is the only gate.
//
// Developer-approved exception in #1720: Local scripts stays one grant. The added message and
// attention operations also apply to existing enabled agents, without another opt-in or capability.
// See docs/architecture/agents.md#local-scripts-api. Any other widening needs a second capability.
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
