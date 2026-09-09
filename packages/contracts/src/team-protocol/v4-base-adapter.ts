import { expandChatTagReferences } from "../chat-tag-references";
import { type AgentEvent, isAgentEvent } from "../ipc-agent-events";
import { isTeamRealtimeEvent, type TeamRealtimeEvent } from "../ipc-team-host";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import {
  toCurrentAgentKeys,
  toCurrentAgentKeysObjectForPath,
  toWireAgentKeys,
  toWireAgentKeysObjectForPath,
} from "./current-agent-keys";
import {
  decodeTeamProtocolV4BaseEvent,
  decodeTeamProtocolV4BaseHttpRequest,
  decodeTeamProtocolV4BaseHttpResponse,
  encodeTeamProtocolV4BaseEvent,
  type TeamProtocolV4BaseEventDecodeResult,
  type TeamProtocolV4BaseJsonObject,
  type TeamProtocolV4BaseJsonValue,
} from "./v4-base";

export type TeamProtocolV4BaseCurrentEventDecodeResult =
  | { kind: "known"; event: AgentEvent | TeamRealtimeEvent }
  | Exclude<TeamProtocolV4BaseEventDecodeResult, { kind: "known" }>;

export function decodeTeamProtocolV4BaseCurrentEvent(value: unknown): TeamProtocolV4BaseCurrentEventDecodeResult {
  if (isDynamicRecord(value) && value.type === "turn-progress") {
    // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
    const wireValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(value));
    const current = toCurrentAgentKeys(wireValue);
    return isAgentEvent(current) ? { kind: "known", event: current } : { kind: "invalid", type: value.type };
  }
  const decoded = decodeTeamProtocolV4BaseEvent(value);
  if (decoded.kind !== "known") return decoded;
  const decodedValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(decoded.event));
  const current = toCurrentAgentKeys(decodedValue);
  return isAgentEvent(current) || isTeamRealtimeEvent(current)
    ? { kind: "known", event: current }
    : { kind: "invalid", type: decoded.event.type };
}

export function encodeTeamProtocolV4BaseCurrentEvent(
  event: AgentEvent | TeamRealtimeEvent,
  options: { preserveSemanticTags?: boolean } = {},
): string | null {
  // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
  if (event.type === "turn-progress") return JSON.stringify(toWireAgentKeys(JSON.parse(JSON.stringify(event))));
  const currentValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(event));
  const wireValue = toWireAgentKeys(currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  const decoded = decodeTeamProtocolV4BaseEvent(downconvertedValue);
  return decoded.kind === "known" ? encodeTeamProtocolV4BaseEvent(decoded.event) : null;
}

export function encodeTeamProtocolV4BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(value));
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV4BaseHttpRequest(method, path, downconvertedValue));
}

export function decodeTeamProtocolV4BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV4BaseJsonObject {
  return toCurrentAgentKeysObjectForPath(
    path,
    structuredClone(decodeTeamProtocolV4BaseHttpRequest(method, path, value)),
  );
}

export function encodeTeamProtocolV4BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(value));
  // The installed-skills route bypasses the frozen codec, so it needs the vocabulary swap by hand.
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  if (status < 400 && isInstalledSkillsRoute(method, path)) return JSON.stringify(wireValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV4BaseHttpResponse(method, path, status, downconvertedValue));
}

function downconvertCurrentTags(value: TeamProtocolV4BaseJsonValue, key = ""): TeamProtocolV4BaseJsonValue {
  if (isString(value)) return key === "text" || key === "preview" ? expandChatTagReferences(value) : value;
  if (Array.isArray(value)) return value.map((item) => downconvertCurrentTags(item));
  if (value === null || isBoolean(value) || isNumber(value)) return value;
  const result: TeamProtocolV4BaseJsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = downconvertCurrentTags(entryValue, entryKey);
  }
  return result;
}

export function decodeTeamProtocolV4BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV4BaseJsonValue {
  if (status < 400 && isInstalledSkillsRoute(method, path)) {
    const wireValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(value));
    return toCurrentAgentKeysForResponsePath(path, structuredClone(wireValue));
  }
  return toCurrentAgentKeysForResponsePath(
    path,
    structuredClone(decodeTeamProtocolV4BaseHttpResponse(method, path, status, value)),
  );
}

function isInstalledSkillsRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/skills$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

function toWireAgentKeysForRequestPath(path: string, value: TeamProtocolV4BaseJsonValue): TeamProtocolV4BaseJsonValue {
  return isDynamicRecord(value) ? toWireAgentKeysObjectForPath(path, value) : toWireAgentKeys(value);
}

function toCurrentAgentKeysForResponsePath(
  path: string,
  value: TeamProtocolV4BaseJsonValue,
): TeamProtocolV4BaseJsonValue {
  return isDynamicRecord(value) ? toCurrentAgentKeysObjectForPath(path, value) : toCurrentAgentKeys(value);
}
