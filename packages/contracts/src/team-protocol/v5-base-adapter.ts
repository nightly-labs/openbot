import { expandChatTagReferences } from "../chat-tag-references";
import { type AgentEvent, isAgentEvent } from "../ipc-agent-events";
import { isTeamRealtimeEvent, type TeamRealtimeEvent } from "../ipc-team-host";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { restoreBrowserSecretMetadata } from "./browser-secret-v1";
import { eventConversationKey, withConversationPlans } from "./conversation-plan-v4";
import { withConversationSenders } from "./conversation-sender-v5";
import {
  toCurrentAgentKeys,
  toCurrentAgentKeysObjectForPath,
  toWireAgentKeys,
  toWireAgentKeysObjectForPath,
} from "./current-agent-keys";
import {
  decodeTeamProtocolV5BaseEvent,
  decodeTeamProtocolV5BaseHttpRequest,
  decodeTeamProtocolV5BaseHttpResponse,
  encodeTeamProtocolV5BaseEvent,
  type TeamProtocolV5BaseEventDecodeResult,
  type TeamProtocolV5BaseJsonObject,
  type TeamProtocolV5BaseJsonValue,
} from "./v5-base";

export type TeamProtocolV5BaseCurrentEventDecodeResult =
  | { kind: "known"; event: AgentEvent | TeamRealtimeEvent }
  | Exclude<TeamProtocolV5BaseEventDecodeResult, { kind: "known" }>;

export function decodeTeamProtocolV5BaseCurrentEvent(value: unknown): TeamProtocolV5BaseCurrentEventDecodeResult {
  if (isDynamicRecord(value) && value.type === "turn-progress") {
    // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
    const wireValue: TeamProtocolV5BaseJsonValue = JSON.parse(JSON.stringify(value));
    const current = toCurrentAgentKeys(wireValue);
    return isAgentEvent(current) ? { kind: "known", event: current } : { kind: "invalid", type: value.type };
  }
  const decoded = decodeTeamProtocolV5BaseEvent(value);
  if (decoded.kind !== "known") return decoded;
  const decodedValue: TeamProtocolV5BaseJsonValue = JSON.parse(JSON.stringify(decoded.event));
  let current: unknown;
  try {
    current = withEventConversationPlans(restoreBrowserSecretMetadata(toCurrentAgentKeys(decodedValue), value), value);
  } catch {
    return { kind: "invalid", type: decoded.event.type };
  }
  return isAgentEvent(current) || isTeamRealtimeEvent(current)
    ? { kind: "known", event: current }
    : { kind: "invalid", type: decoded.event.type };
}

export function encodeTeamProtocolV5BaseCurrentEvent(
  event: AgentEvent | TeamRealtimeEvent,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean } = {},
): string | null {
  // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
  if (event.type === "turn-progress") return JSON.stringify(toWireAgentKeys(JSON.parse(JSON.stringify(event))));
  const currentValue: TeamProtocolV5BaseJsonValue = JSON.parse(JSON.stringify(event));
  const wireValue = toWireAgentKeys(currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  const decoded = decodeTeamProtocolV5BaseEvent(downconvertedValue);
  if (decoded.kind !== "known") return null;
  const encoded = encodeTeamProtocolV5BaseEvent(decoded.event);
  if (!encoded || (!options.preserveBrowserSecrets && !eventConversationKey(event.type))) return encoded;
  const output = withEventConversationPlans(JSON.parse(encoded), wireValue);
  return JSON.stringify(options.preserveBrowserSecrets ? restoreBrowserSecretMetadata(output, wireValue) : output);
}

/**
 * Puts the plans and the senders of a conversation event beside its frozen projection. See
 * `withConversationPlans` and `withConversationSenders`.
 */
function withEventConversationPlans(
  projected: TeamProtocolV5BaseJsonValue,
  source: unknown,
): TeamProtocolV5BaseJsonValue {
  if (projected === null || Array.isArray(projected) || typeof projected !== "object") return projected;
  if (!isDynamicRecord(source)) return projected;
  const key = eventConversationKey(projected.type);
  const conversation = key ? projected[key] : undefined;
  if (!key || conversation === undefined) return projected;
  return {
    ...projected,
    [key]: withConversationSenders(withConversationPlans(conversation, source[key]), source[key]),
  };
}

export function encodeTeamProtocolV5BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV5BaseJsonValue = JSON.parse(JSON.stringify(value));
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV5BaseHttpRequest(method, path, downconvertedValue));
}

export function decodeTeamProtocolV5BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV5BaseJsonObject {
  return toCurrentAgentKeysObjectForPath(
    path,
    structuredClone(decodeTeamProtocolV5BaseHttpRequest(method, path, value)),
  );
}

export function encodeTeamProtocolV5BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV5BaseJsonValue = JSON.parse(JSON.stringify(value));
  // The installed-skills route bypasses the frozen codec, so it needs the vocabulary swap by hand.
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  if (status < 400 && isInstalledSkillsRoute(method, path)) return JSON.stringify(wireValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV5BaseHttpResponse(method, path, status, downconvertedValue));
}

function downconvertCurrentTags(value: TeamProtocolV5BaseJsonValue, key = ""): TeamProtocolV5BaseJsonValue {
  if (isString(value)) return key === "text" || key === "preview" ? expandChatTagReferences(value) : value;
  if (Array.isArray(value)) return value.map((item) => downconvertCurrentTags(item));
  if (value === null || isBoolean(value) || isNumber(value)) return value;
  const result: TeamProtocolV5BaseJsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = downconvertCurrentTags(entryValue, entryKey);
  }
  return result;
}

export function decodeTeamProtocolV5BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV5BaseJsonValue {
  if (status < 400 && isInstalledSkillsRoute(method, path)) {
    const wireValue: TeamProtocolV5BaseJsonValue = JSON.parse(JSON.stringify(value));
    return toCurrentAgentKeysForResponsePath(path, structuredClone(wireValue));
  }
  return toCurrentAgentKeysForResponsePath(
    path,
    structuredClone(decodeTeamProtocolV5BaseHttpResponse(method, path, status, value)),
  );
}

function isInstalledSkillsRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/skills$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

function toWireAgentKeysForRequestPath(path: string, value: TeamProtocolV5BaseJsonValue): TeamProtocolV5BaseJsonValue {
  return isDynamicRecord(value) ? toWireAgentKeysObjectForPath(path, value) : toWireAgentKeys(value);
}

function toCurrentAgentKeysForResponsePath(
  path: string,
  value: TeamProtocolV5BaseJsonValue,
): TeamProtocolV5BaseJsonValue {
  return isDynamicRecord(value) ? toCurrentAgentKeysObjectForPath(path, value) : toCurrentAgentKeys(value);
}
