import { AGENT_PROVIDERS, AGENT_REASONING_EFFORTS, isAgentModel } from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";

const result = ["succeeded", "failed", "cancelled"] as const;
const count = (value: unknown) => isNumber(value) && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const duration = (value: unknown) => isNumber(value) && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
const agent = { provider: AGENT_PROVIDERS, model: isAgentModel, reasoning_effort: AGENT_REASONING_EFFORTS };
const outcome = {
  result,
  duration_ms: duration,
  failure_code: ["operation_failed", "connection_failed", "permission_denied", "pairing_failed", "load_failed"],
};

export const MOBILE_EVENTS = {
  mobile_app_opened: { kind: ["cold_start", "foreground"], signed_in: isBoolean },
  mobile_pairing_action: { action: ["scanner_opened", "camera_permission", "redeem", "cancel"], ...outcome },
  mobile_connection_action: {
    action: ["connect", "reconnect", "lost"],
    ...outcome,
    stage: ["preferences", "connection", "compatibility", "agents", "reads", "conversations"],
  },
  conversation_opened: { ...outcome, ...agent },
  message_send: {
    ...outcome,
    ...agent,
    channel: ["agent"],
    server_kind: ["remote"],
    attachment_count: count,
    is_reply: isBoolean,
  },
  agent_input_action: { ...outcome, kind: ["prompt"], decision: ["answered"] },
  attachment_action: {
    ...outcome,
    action: ["select", "upload", "remove"],
    attachment_count: count,
    size_bucket: ["under_100kb", "under_1mb", "under_10mb", "over_10mb"],
  },
  agent_action: { ...outcome, ...agent, action: ["create", "update", "duplicate", "delete"] },
  routine_action: {
    ...outcome,
    action: ["create", "update", "delete"],
    trigger_type: ["hourly", "daily", "weekdays", "weekly", "monthly", "interval", "advanced", "custom"],
  },
  memory_action: { ...outcome, action: ["create", "update", "delete"] },
  search_action: { ...outcome, scope: ["global"], result_count: count },
  team_action: { ...outcome, action: ["server_selected", "server_joined", "server_left"], server_kind: ["remote"] },
  conversation_action: { ...outcome, action: ["pin", "unpin", "hide", "unhide"] },
  usage_viewed: {},
  account_sign_out: outcome,
} as const;

type Rule = readonly string[] | ((value: unknown) => boolean);
type Value<R> = R extends readonly (infer S)[] ? S : R extends (value: unknown) => value is infer T ? T : number;
export type MobileEventName = keyof typeof MOBILE_EVENTS;
export type MobileEventProperties<N extends MobileEventName> = {
  [K in keyof (typeof MOBILE_EVENTS)[N]]?: Value<(typeof MOBILE_EVENTS)[N][K]>;
};
export type SafeProperties = Record<string, string | number | boolean>;

export function sanitizeMobileEvent(name: MobileEventName, properties: DynamicRecord): SafeProperties {
  const rules: Record<string, Rule> = MOBILE_EVENTS[name];
  const safe: SafeProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!Object.hasOwn(rules, key)) continue;
    const rule = rules[key];
    if (!rule) continue;
    const valid = typeof rule === "function" ? rule(value) : isString(value) && rule.includes(value);
    if (valid && (isString(value) || isNumber(value) || isBoolean(value))) safe[key] = value;
  }
  return safe;
}

export function attachmentSizeBucket(bytes: number) {
  if (bytes < 100_000) return "under_100kb";
  if (bytes < 1_000_000) return "under_1mb";
  return bytes <= 10 * 1024 * 1024 ? "under_10mb" : "over_10mb";
}
