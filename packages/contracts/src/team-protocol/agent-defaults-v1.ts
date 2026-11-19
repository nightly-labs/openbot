import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const AGENT_DEFAULTS_CAPABILITY = "agent-defaults-v1";

export const AGENT_DEFAULTS_ROUTES = {
  settings: "/v1/admin/agents/defaults",
  update: "/v1/admin/agents/defaults/update",
  choice: "/v1/admin/agents/defaults/choice",
} as const;

export const AGENT_DEFAULTS_MAX_AGENTS = 1_000;

const mode = oneOf("queue", "steer");
const overview: AdminDecoder = fields({
  defaults: fields({
    allowAutomation: boolean,
    allowNewChat: boolean,
    quickAcknowledgement: boolean,
    planStartAfterMs: nullable(count),
    automationRunsPerHour: count,
    commitCoAuthor: boolean,
  }),
  busyMessageMode: mode,
  agents: list(
    fields({
      agentId: identifier,
      allowAutomation: nullable(boolean),
      allowNewChat: nullable(boolean),
      quickAcknowledgement: nullable(boolean),
      busyMessageMode: nullable(mode),
    }),
    AGENT_DEFAULTS_MAX_AGENTS,
  ),
});

export const AGENT_DEFAULTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_DEFAULTS_ROUTES.settings, adminRoute(fields({}), overview)],
  [
    AGENT_DEFAULTS_ROUTES.update,
    adminRoute(
      fields(
        {},
        {
          allowAutomation: boolean,
          allowNewChat: boolean,
          quickAcknowledgement: boolean,
          planStartAfterMs: nullable(count),
          automationRunsPerHour: count,
          commitCoAuthor: boolean,
          busyMessageMode: mode,
        },
      ),
      overview,
    ),
  ],
  [
    AGENT_DEFAULTS_ROUTES.choice,
    adminRoute(
      fields({
        agentIds: list(identifier, AGENT_DEFAULTS_MAX_AGENTS),
        setting: oneOf("allowAutomation", "allowNewChat", "quickAcknowledgement", "busyMessageMode"),
        choice: oneOf("default", "on", "off"),
      }),
      overview,
    ),
  ],
]);
