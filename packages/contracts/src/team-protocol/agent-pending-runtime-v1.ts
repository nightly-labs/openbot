// Frozen optional agent-pending-runtime-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member with manage access to
// an agent can change its provider, model, reasoning effort and provider account, or some of them, while
// the agent works (`update`), as the chat on the host's computer does. The host keeps the change as the
// agent's `pendingRuntime` and applies it before the next queued message starts; a later change while it
// waits edits it. On an idle agent it applies at once. A provider change names the model too. A provider
// that is off or has no such model is refused. `providerAccountId` `default` is the provider's own
// sign-in; with no `providerAccountId`, a provider change also goes to it. Another change of the account
// needs an owner or admin, as `provider-accounts-v1` does. The response is empty.
//
// For a client that advertises the capability, on protocol 9, the host also adds `pendingRuntime`
// beside the frozen keys of each agent in the response of `GET /v1/agents` and in the agents of a
// `bots-changed` event. It has `provider`, `model`, `reasoningEffort` and, for a named account,
// `providerAccountId`. An agent with no waiting change has none. A host without the capability never
// sends the field, so a client accepts it whenever it is present. A present value outside this shape
// fails closed; a provider or an effort that the client does not know is left out. Widening any of it
// needs a second capability string.
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../ipc-agent-status";
import { isAgentPendingRuntime, type UpdateAgentInput } from "../ipc-agents";
import { isDynamicRecord, isString } from "../runtime-values";
import { TEAM_API_ROUTES } from "../team-api-routes";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";
import type { TeamProtocolV8BaseJsonValue } from "./v8-base";

export const AGENT_PENDING_RUNTIME_CAPABILITY = "agent-pending-runtime-v1";

export const AGENT_PENDING_RUNTIME_ROUTES = {
  update: "/v1/agent-pending-runtime/update",
} as const;

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u;
const ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

const pattern =
  (expression: RegExp): AdminDecoder =>
  (value) => {
    if (!isString(value) || !expression.test(value)) throw new Error("Invalid pending runtime.");
    return value;
  };
const runtimeFields = {
  provider: pattern(OPEN_PROVIDER_ID),
  model: pattern(MODEL),
  reasoningEffort: string(32),
};
const account = { providerAccountId: pattern(ACCOUNT_ID) };
const runtime = fields(runtimeFields, account);

export const AGENT_PENDING_RUNTIME_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_PENDING_RUNTIME_ROUTES.update,
    adminRoute(fields({ agentId: identifier }, { ...runtimeFields, ...account }), empty),
  ],
]);

const RUNTIME_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  "agentId",
  "provider",
  "model",
  "reasoningEffort",
  "providerAccountId",
]);

/**
 * The body of `update` for a change of the runtime alone, or null for a change with another field, which
 * goes on the released agent route. A null account is the provider's own sign-in (`default`).
 */
export function pendingRuntimeUpdateBody(input: UpdateAgentInput): Record<string, string> | null {
  const changed = Object.entries(input).filter(([, value]) => value !== undefined);
  if (changed.length < 2 || changed.some(([key]) => !RUNTIME_CHANGE_FIELDS.has(key))) return null;
  const { agentId, provider, model, reasoningEffort, providerAccountId } = input;
  return {
    agentId,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(providerAccountId === undefined ? {} : { providerAccountId: providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID }),
  };
}

/** The released agent list, whose agents carry `pendingRuntime` under this capability. */
export function isAgentListRoute(method: string, path: string): boolean {
  return method === "GET" && new URL(path, "http://openbot.invalid").pathname === TEAM_API_ROUTES.agents.all;
}

/**
 * `projected`, an agent list after the frozen projection, with the `pendingRuntime` of each agent of
 * `source`, the list before it. The projection keeps the agents in order, so the agent at the same index
 * with the same `id` is the source. The host passes `sending`, so a value outside the shape stays on the
 * host; a client refuses it.
 */
export function withAgentPendingRuntimes(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!Array.isArray(projected) || !Array.isArray(source)) return projected;
  const sourceAgents: unknown[] = source;
  return projected.map((agent, index) => {
    const from = sourceAgents[index];
    if (!isDynamicRecord(agent) || !isDynamicRecord(from) || from.id !== agent.id) return agent;
    if (from.pendingRuntime === undefined) return agent;
    let pendingRuntime: TeamProtocolV8BaseJsonValue;
    try {
      pendingRuntime = runtime(from.pendingRuntime);
    } catch (error) {
      if (sending) return agent;
      throw error;
    }
    return sending || isAgentPendingRuntime(pendingRuntime) ? { ...agent, pendingRuntime } : agent;
  });
}

/** `projected`, an agents event after the frozen projection, with the `pendingRuntime` of the agents of `source`. */
export function withEventAgentPendingRuntimes(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  // The wire spells the event `bots-changed`; a host reads its own event in the current spelling.
  const key = projected.type === "bots-changed" ? "bots" : projected.type === "agents-changed" ? "agents" : null;
  if (!key || projected[key] === undefined) return projected;
  const from = source.bots ?? source.agents;
  return { ...projected, [key]: withAgentPendingRuntimes(projected[key], from, sending) };
}
