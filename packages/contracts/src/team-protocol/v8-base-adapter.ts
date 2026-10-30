import { agentProviderName, isAgentProvider } from "../agent-providers";
import { expandChatTagReferences } from "../chat-tag-references";
import { type AgentEvent, isAgentEvent } from "../ipc-agent-events";
import { isTeamRealtimeEvent, type TeamRealtimeEvent } from "../ipc-team-host";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { restoreBrowserSecretMetadata } from "./browser-secret-v1";
import { restoreBrowserTakeoverReason } from "./browser-sign-in-v1";
import { withRuntimeSnapshotContextUsage } from "./context-usage-v1";
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
  decodeTeamProtocolV8BaseEvent,
  decodeTeamProtocolV8BaseHttpRequest,
  decodeTeamProtocolV8BaseHttpResponse,
  encodeTeamProtocolV8BaseEvent,
  type TeamProtocolV8BaseEventDecodeResult,
  type TeamProtocolV8BaseJsonObject,
  type TeamProtocolV8BaseJsonValue,
} from "./v8-base";

export type TeamProtocolV8BaseCurrentEventDecodeResult =
  | { kind: "known"; event: AgentEvent | TeamRealtimeEvent }
  | Exclude<TeamProtocolV8BaseEventDecodeResult, { kind: "known" }>;

export function decodeTeamProtocolV8BaseCurrentEvent(value: unknown): TeamProtocolV8BaseCurrentEventDecodeResult {
  if (isDynamicRecord(value) && value.type === "turn-progress") {
    // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
    const wireValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(value));
    const current = toCurrentAgentKeys(wireValue);
    return isAgentEvent(current) ? { kind: "known", event: current } : { kind: "invalid", type: value.type };
  }
  const decoded = decodeTeamProtocolV8BaseEvent(value);
  if (decoded.kind !== "known") return decoded;
  const decodedValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(decoded.event));
  let current: unknown;
  try {
    current = withEventPromptMultiSelect(
      withEventConversationPlans(
        restoreBrowserTakeoverReason(
          restoreBrowserSecretMetadata(toCurrentAgentKeys(withRuntimeSnapshotContextUsage(decodedValue, value)), value),
          value,
        ),
        value,
        // A host sends a UI block only under ui-blocks-v1, the subagents only under subagents-v1, a
        // multi-select flag only under prompt-multi-select-v1, a takeover reason only under
        // browser-sign-in, and context states only under context-usage-v1, so a present one is always
        // kept.
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

export function encodeTeamProtocolV8BaseCurrentEvent(
  event: AgentEvent | TeamRealtimeEvent,
  options: {
    preserveSemanticTags?: boolean;
    preserveBrowserSecrets?: boolean;
    browserSignIn?: boolean;
    uiBlocks?: boolean;
    subagents?: boolean;
    promptMultiSelect?: boolean;
    contextUsage?: boolean;
  } = {},
): string | null {
  // `turn-progress` bypasses the frozen codec, so it needs the vocabulary swap applied by hand.
  if (event.type === "turn-progress") return JSON.stringify(toWireAgentKeys(JSON.parse(JSON.stringify(event))));
  const eventValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(event));
  const currentValue =
    isDynamicRecord(eventValue) && event.type === "status" && eventValue.status !== undefined
      ? { ...eventValue, status: withProviderDisplayNames(eventValue.status) }
      : eventValue;
  const wireValue = toWireAgentKeys(currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  const decoded = decodeTeamProtocolV8BaseEvent(downconvertedValue);
  if (decoded.kind !== "known") return null;
  const encoded = encodeTeamProtocolV8BaseEvent(decoded.event);
  const promptMultiSelect = options.promptMultiSelect === true && eventHasPromptQuestions(event.type);
  const contextUsage = options.contextUsage === true && event.type === "runtime-snapshot";
  if (
    !encoded ||
    (!options.preserveBrowserSecrets &&
      !options.browserSignIn &&
      !eventConversationKey(event.type) &&
      !promptMultiSelect &&
      !contextUsage)
  )
    return encoded;
  // The block and the subagents go as written: the key swap would rename a response value under a
  // field id such as `agentId`.
  const withPlans = withEventConversationPlans(
    JSON.parse(encoded),
    wireValue,
    options.uiBlocks ? currentValue : null,
    options.subagents ? currentValue : null,
  );
  const withMultiSelect = promptMultiSelect ? withEventPromptMultiSelect(withPlans, currentValue) : withPlans;
  const output = contextUsage ? withRuntimeSnapshotContextUsage(withMultiSelect, wireValue, true) : withMultiSelect;
  const withSecrets = options.preserveBrowserSecrets ? restoreBrowserSecretMetadata(output, wireValue) : output;
  return JSON.stringify(options.browserSignIn ? restoreBrowserTakeoverReason(withSecrets, wireValue) : withSecrets);
}

/**
 * Puts the plans and the senders of a conversation event beside its frozen projection, the UI blocks
 * of `uiBlockSource` when it is not null, and the subagents of `subagentSource` when it is not null.
 * See `withConversationPlans`, `withConversationSenders`, `withConversationUiBlocks` and
 * `withConversationSubagents`.
 */
function withEventConversationPlans(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  uiBlockSource: unknown,
  subagentSource: unknown,
): TeamProtocolV8BaseJsonValue {
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

export function encodeTeamProtocolV8BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const currentValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(value));
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV8BaseHttpRequest(method, path, downconvertedValue));
}

export function decodeTeamProtocolV8BaseCurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV8BaseJsonObject {
  return toCurrentAgentKeysObjectForPath(
    path,
    structuredClone(decodeTeamProtocolV8BaseHttpRequest(method, path, value)),
  );
}

export function encodeTeamProtocolV8BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  const responseValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(value));
  const currentValue =
    status < 400 && isAgentStatusRoute(method, path) ? withProviderDisplayNames(responseValue) : responseValue;
  // The installed-skills route bypasses the frozen codec, so it needs the vocabulary swap by hand.
  const wireValue = toWireAgentKeysForRequestPath(path, currentValue);
  if (status < 400 && isInstalledSkillsRoute(method, path)) return JSON.stringify(wireValue);
  const downconvertedValue = options.preserveSemanticTags ? wireValue : downconvertCurrentTags(wireValue);
  return JSON.stringify(decodeTeamProtocolV8BaseHttpResponse(method, path, status, downconvertedValue));
}

function downconvertCurrentTags(value: TeamProtocolV8BaseJsonValue, key = ""): TeamProtocolV8BaseJsonValue {
  if (isString(value)) return key === "text" || key === "preview" ? expandChatTagReferences(value) : value;
  if (Array.isArray(value)) return value.map((item) => downconvertCurrentTags(item));
  if (value === null || isBoolean(value) || isNumber(value)) return value;
  const result: TeamProtocolV8BaseJsonObject = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = downconvertCurrentTags(entryValue, entryKey);
  }
  return result;
}

export function decodeTeamProtocolV8BaseCurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV8BaseJsonValue {
  if (status < 400 && isInstalledSkillsRoute(method, path)) {
    const wireValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(value));
    return toCurrentAgentKeysForResponsePath(path, structuredClone(wireValue));
  }
  return toCurrentAgentKeysForResponsePath(
    path,
    structuredClone(decodeTeamProtocolV8BaseHttpResponse(method, path, status, value)),
  );
}

function isAgentStatusRoute(method: string, path: string): boolean {
  return method === "GET" && new URL(path, "http://openbot.invalid").pathname === "/v1/agents/status";
}

/**
 * The host names each provider of its status, so a client that does not know a provider id can still
 * show it. A name that the status already has stays.
 */
function withProviderDisplayNames(status: TeamProtocolV8BaseJsonValue): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(status) || !Array.isArray(status.providers)) return status;
  return {
    ...status,
    providers: status.providers.map((row) =>
      isDynamicRecord(row) && row.displayName === undefined && isString(row.id) && isAgentProvider(row.id)
        ? { ...row, displayName: agentProviderName(row.id) }
        : row,
    ),
  };
}

function isInstalledSkillsRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/skills$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

function toWireAgentKeysForRequestPath(path: string, value: TeamProtocolV8BaseJsonValue): TeamProtocolV8BaseJsonValue {
  return isDynamicRecord(value) ? toWireAgentKeysObjectForPath(path, value) : toWireAgentKeys(value);
}

function toCurrentAgentKeysForResponsePath(
  path: string,
  value: TeamProtocolV8BaseJsonValue,
): TeamProtocolV8BaseJsonValue {
  return isDynamicRecord(value) ? toCurrentAgentKeysObjectForPath(path, value) : toCurrentAgentKeys(value);
}
