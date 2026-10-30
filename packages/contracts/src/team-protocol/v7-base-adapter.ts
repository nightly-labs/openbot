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
import { eventHasPromptQuestions, withEventPromptMultiSelect } from "./prompt-multi-select-v1";
import { withConversationSubagents } from "./subagents-v1";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import {
  decodeTeamProtocolV7BaseEvent,
  decodeTeamProtocolV7BaseHttpRequest,
  decodeTeamProtocolV7BaseHttpResponse,
  encodeTeamProtocolV7BaseEvent,
  type TeamProtocolV7BaseEventDecodeResult,
  type TeamProtocolV7BaseJsonObject,
  type TeamProtocolV7BaseJsonValue,
} from "./v7-base";

export type TeamProtocolV7BaseCurrentEventDecodeResult =
  | { kind: "known"; event: AgentEvent | TeamRealtimeEvent }
  | Exclude<TeamProtocolV7BaseEventDecodeResult, { kind: "known" }>;

export function decodeTeamProtocolV7BaseCurrentEvent(value: unknown): TeamProtocolV7BaseCurrentEventDecodeResult {
  if (isDynamicRecord(value) && value.type === "turn-progress") {
    // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
    const wireValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value));
    const current = toCurrentAgentKeys(wireValue);
    return isAgentEvent(current) ? { kind: "known", event: current } : { kind: "invalid", type: value.type };
  }
  const decoded = decodeTeamProtocolV7BaseEvent(value);
  if (decoded.kind !== "known") return decoded;
  const decodedValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(decoded.event));
  let current: unknown;
  try {
    current = withEventPromptMultiSelect(
      withEventConversationPlans(
        restoreBrowserSecretMetadata(toCurrentAgentKeys(decodedValue), value),
        value,
        // A host sends a UI block only under ui-blocks-v1, the subagents only under subagents-v1, and
        // a multi-select flag only under prompt-multi-select-v1, so a present one is always kept.
        value,
        value,
      ),
      value,
    );
  } catch {
    return { kind: "invalid", type: decoded.event.type };
  }
  return isAgentEvent(current) || isTeamRealtimeEvent(current)
    ? { kind: "known", event: current }
    : { kind: "invalid", type: decoded.event.type };
}

export function encodeTeamProtocolV7BaseCurrentEvent(
  event: AgentEvent | TeamRealtimeEvent,
  options: {
    preserveSemanticTags?: boolean;
    preserveBrowserSecrets?: boolean;
    uiBlocks?: boolean;
    subagents?: boolean;
    promptMultiSelect?: boolean;
  } = {},
): string | null {
  // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
  if (event.type === "turn-progress") return JSON.stringify(toWireAgentKeys(JSON.parse(JSON.stringify(event))));
  const currentValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(event));
  const wireValue = toWireAgentKeys(currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  const decoded = decodeTeamProtocolV7BaseEvent(downconvertedValue);
  if (decoded.kind !== "known") return null;
  const encoded = encodeTeamProtocolV7BaseEvent(decoded.event);
  const promptMultiSelect = options.promptMultiSelect === true && eventHasPromptQuestions(event.type);
  if (!encoded || (!options.preserveBrowserSecrets && !eventConversationKey(event.type) && !promptMultiSelect))
    return encoded;
  // The block and the subagents go as written: the key swap would rename a response value under a
  // field id such as `agentId`.
  const withPlans = withEventConversationPlans(
    JSON.parse(encoded),
    wireValue,
    options.uiBlocks ? currentValue : null,
    options.subagents ? currentValue : null,
  );
  const output = promptMultiSelect ? withEventPromptMultiSelect(withPlans, currentValue) : withPlans;
  return JSON.stringify(options.preserveBrowserSecrets ? restoreBrowserSecretMetadata(output, wireValue) : output);
}

/**
 * Puts the plans and the senders of a conversation event beside its frozen projection, the UI blocks
 * of `uiBlockSource` when it is not null, and the subagents of `subagentSource` when it is not null.
 * See `withConversationPlans`, `withConversationSenders`, `withConversationUiBlocks` and
 * `withConversationSubagents`.
 */
function withEventConversationPlans(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
  uiBlockSource: unknown,
  subagentSource: unknown,
): TeamProtocolV7BaseJsonValue {
  if (projected === null || Array.isArray(projected) || typeof projected !== "object") return projected;
  if (!isDynamicRecord(source)) return projected;
  const key = eventConversationKey(projected.type);
  const conversation = key ? projected[key] : undefined;
  if (!key || conversation === undefined) return projected;
  const withPlans = withConversationSenders(withConversationPlans(conversation, source[key]), source[key]);
  const withBlocks = isDynamicRecord(uiBlockSource)
    ? withConversationUiBlocks(withPlans, uiBlockSource[key])
    : withPlans;
  return {
    ...projected,
    [key]: isDynamicRecord(subagentSource) ? withConversationSubagents(withBlocks, subagentSource[key]) : withBlocks,
  };
}

export function encodeTeamProtocolV7BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value));
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV7BaseHttpRequest(method, path, downconvertedValue));
}

export function decodeTeamProtocolV7BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV7BaseJsonObject {
  return toCurrentAgentKeysObjectForPath(
    path,
    structuredClone(decodeTeamProtocolV7BaseHttpRequest(method, path, value)),
  );
}

export function encodeTeamProtocolV7BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value));
  // The installed-skills route bypasses the frozen codec, so it needs the vocabulary swap by hand.
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  if (status < 400 && isInstalledSkillsRoute(method, path)) return JSON.stringify(wireValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV7BaseHttpResponse(method, path, status, downconvertedValue));
}

function downconvertCurrentTags(value: TeamProtocolV7BaseJsonValue, key = ""): TeamProtocolV7BaseJsonValue {
  if (isString(value)) return key === "text" || key === "preview" ? expandChatTagReferences(value) : value;
  if (Array.isArray(value)) return value.map((item) => downconvertCurrentTags(item));
  if (value === null || isBoolean(value) || isNumber(value)) return value;
  const result: TeamProtocolV7BaseJsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = downconvertCurrentTags(entryValue, entryKey);
  }
  return result;
}

export function decodeTeamProtocolV7BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV7BaseJsonValue {
  if (status < 400 && isInstalledSkillsRoute(method, path)) {
    const wireValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value));
    return toCurrentAgentKeysForResponsePath(path, structuredClone(wireValue));
  }
  return toCurrentAgentKeysForResponsePath(
    path,
    structuredClone(decodeTeamProtocolV7BaseHttpResponse(method, path, status, value)),
  );
}

function isInstalledSkillsRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/skills$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

function toWireAgentKeysForRequestPath(path: string, value: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue {
  return isDynamicRecord(value) ? toWireAgentKeysObjectForPath(path, value) : toWireAgentKeys(value);
}

function toCurrentAgentKeysForResponsePath(
  path: string,
  value: TeamProtocolV7BaseJsonValue,
): TeamProtocolV7BaseJsonValue {
  return isDynamicRecord(value) ? toCurrentAgentKeysObjectForPath(path, value) : toCurrentAgentKeys(value);
}
