// Frozen optional agent-defaults-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change the host defaults of the agent settings that have one, and set which
// agents follow them. The defaults are local scripts (`allowAutomation`), the agent's own new chats
// (`allowNewChat`), the plan card (`quickAcknowledgement`) with its start time (`planStartAfterMs`;
// null waits for Start), the local script limit for each hour (`automationRunsPerHour`), the OpenBot
// co-author line of git commits (`commitCoAuthor`), and what a message sent while an agent works does
// (`busyMessageMode`). Before this contract these defaults were a local choice of the host computer;
// `agent-host-settings-v1`, `agent-new-chat-v1` and `agent-plan-card-v1` keep their released meaning.
// The read gives the defaults and each visible agent's own value (null follows the default). A choice
// sets the own value of each named agent: `default` removes it. A member cannot use the routes;
// `requireAdmin` on the host is the only gate. Protocol 9 only. Widening any of it needs a second
// capability string.
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

/** The most agents that one read lists and one choice names. */
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
