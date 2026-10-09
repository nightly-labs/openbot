// Frozen optional session settings contract. Bounds and semantics do not follow IPC changes.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const AGENT_SESSION_SETTINGS_CAPABILITY = "agent-session-settings-v1";
export const AGENT_SESSION_SETTINGS_ROUTES = {
  read: "/v1/admin/agents/session-settings",
  set: "/v1/admin/agents/session-settings/set",
  reset: "/v1/admin/agents/session-settings/reset",
} as const;
const settingId: AdminDecoder = (input) => {
  if (typeof input !== "string" || input.length === 0 || input.length > 256)
    throw new Error("Invalid session setting id.");
  return input;
};
const value: AdminDecoder = (input) => (typeof input === "boolean" ? input : string(4096)(input));
const list =
  (decode: AdminDecoder, maximum: number): AdminDecoder =>
  (input) => {
    if (!Array.isArray(input) || input.length > maximum) throw new Error("Invalid session settings list.");
    return input.map(decode);
  };
const choice = fields({ value: string(4096), name: string(4096) }, { description: string(16384), group: string(4096) });
const option: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || (input.type !== "boolean" && input.type !== "select"))
    throw new Error("Invalid session setting.");
  const base = fields(
    { id: settingId, name: string(4096) },
    { description: string(16384), category: string(256) },
  )(input);
  if (!isDynamicRecord(base)) throw new Error("Invalid session setting.");
  return input.type === "boolean"
    ? { ...base, type: "boolean", currentValue: boolean(input.currentValue) }
    : {
        ...base,
        type: "select",
        currentValue: string(4096)(input.currentValue),
        options: list(choice, 4096)(input.options),
      };
};
const overrides: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).length > 64) throw new Error("Invalid session setting overrides.");
  return Object.fromEntries(
    Object.entries(input).map(([id, entry]) => {
      settingId(id);
      return [id, value(entry)];
    }),
  );
};
const response = fields({
  agentId: identifier,
  providerIdentity: string(160),
  pending: boolean,
  overrides,
  options: list(option, 64),
});
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid session settings request.");
    return decode(input);
  };
export const AGENT_SESSION_SETTINGS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_SESSION_SETTINGS_ROUTES.read, adminRoute(exact(["agentId"], fields({ agentId: identifier })), response)],
  [
    AGENT_SESSION_SETTINGS_ROUTES.set,
    adminRoute(exact(["agentId", "settingId", "value"], fields({ agentId: identifier, settingId, value })), response),
  ],
  [
    AGENT_SESSION_SETTINGS_ROUTES.reset,
    adminRoute(exact(["agentId", "settingId"], fields({ agentId: identifier, settingId })), response),
  ],
]);
export type AgentSessionSettingsEvent = { type: "agent-session-settings-changed"; agentId: string };
export function agentSessionSettingsEvent(input: unknown): AgentSessionSettingsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "agent-session-settings-changed") return null;
  const agentId = identifier(input.agentId);
  if (typeof agentId !== "string") throw new Error("Invalid session settings event.");
  return { type: "agent-session-settings-changed", agentId };
}
