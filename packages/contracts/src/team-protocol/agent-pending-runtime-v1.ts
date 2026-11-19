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

export function isAgentListRoute(method: string, path: string): boolean {
  return method === "GET" && new URL(path, "http://openbot.invalid").pathname === TEAM_API_ROUTES.agents.all;
}

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

export function withEventAgentPendingRuntimes(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const key = projected.type === "bots-changed" ? "bots" : projected.type === "agents-changed" ? "agents" : null;
  if (!key || projected[key] === undefined) return projected;
  const from = source.bots ?? source.agents;
  return { ...projected, [key]: withAgentPendingRuntimes(projected[key], from, sending) };
}
