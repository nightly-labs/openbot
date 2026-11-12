// Frozen optional agent-usage-limit-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member can read which agents
// that the member can see have a message that a provider usage limit holds, with the reset time in epoch
// seconds or null, and which provider models and accounts a usage limit or a provider error holds now.
// The released `runtime-snapshot` event does not carry these fields. The host sends no model of a
// provider that the peer's protocol does not know. A member with the `manage` level of an agent can move
// that agent to another model and send the held message there (`switch`), as the chat on the host's
// computer does. A move to a named provider account that is not the agent's account needs an owner or
// admin, as `provider-accounts-v1` does. A hidden agent, or an agent that the peer cannot see, is not
// found (404). Every route is a POST with its ids in the body. A change of a hold sends the released
// `runtime-snapshot` event, and the client then reads `list` again. Widening any of it needs a second
// capability string.
import { type AgentModelChoice, isAgentModelChoice } from "../ipc-agents";
import { isDynamicRecord, isString } from "../runtime-values";
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
  string,
} from "./admin-wire";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";

export const AGENT_USAGE_LIMIT_CAPABILITY = "agent-usage-limit-v1";

export const AGENT_USAGE_LIMIT_ROUTES = {
  list: "/v1/agent-usage-limit/list",
  switch: "/v1/agent-usage-limit/switch",
} as const;

/** The most agents, and the most models of each list, that one answer carries. */
export const AGENT_USAGE_LIMIT_LIST_LIMIT = 500;

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u;
const ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

const pattern =
  (expression: RegExp): AdminDecoder =>
  (value) => {
    if (!isString(value) || !expression.test(value)) throw new Error("Invalid usage limit model.");
    return value;
  };
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent usage limit request.");
    return decode(input);
  };
const choice = fields(
  { provider: pattern(OPEN_PROVIDER_ID), model: pattern(MODEL) },
  { providerAccountId: pattern(ACCOUNT_ID) },
);
const hold = fields({ agentId: identifier, resetsAt: nullable(count) });

export const AGENT_USAGE_LIMIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_USAGE_LIMIT_ROUTES.list,
    adminRoute(
      exact([], empty),
      fields({
        usageLimits: list(hold, AGENT_USAGE_LIMIT_LIST_LIMIT),
        usageLimitedModels: list(choice, AGENT_USAGE_LIMIT_LIST_LIMIT),
        failedModels: list(choice, AGENT_USAGE_LIMIT_LIST_LIMIT),
      }),
    ),
  ],
  [
    AGENT_USAGE_LIMIT_ROUTES.switch,
    adminRoute(
      exact(
        ["agentId", "provider", "model", "providerAccountId", "reasoningEffort"],
        fields(
          {
            agentId: identifier,
            provider: pattern(OPEN_PROVIDER_ID),
            model: pattern(MODEL),
            reasoningEffort: string(32),
          },
          { providerAccountId: pattern(ACCOUNT_ID) },
        ),
      ),
      empty,
    ),
  ],
]);

/** The holds that `list` answers: the fields that the released runtime snapshot does not carry. */
export interface AgentUsageLimits {
  usageLimits: Array<{ agentId: string; resetsAt: number | null }>;
  usageLimitedModels: AgentModelChoice[];
  failedModels: AgentModelChoice[];
}

export function isAgentUsageLimits(value: unknown): value is AgentUsageLimits {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.usageLimits) &&
    value.usageLimits.every(
      (entry) =>
        isDynamicRecord(entry) &&
        isString(entry.agentId) &&
        (entry.resetsAt === null || (typeof entry.resetsAt === "number" && Number.isFinite(entry.resetsAt))),
    ) &&
    Array.isArray(value.usageLimitedModels) &&
    value.usageLimitedModels.every(isAgentModelChoice) &&
    Array.isArray(value.failedModels) &&
    value.failedModels.every(isAgentModelChoice)
  );
}
