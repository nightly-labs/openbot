import { agentProviderName, isAgentProvider } from "../agent-providers";
import { expandChatTagReferences } from "../chat-tag-references";
import { type AgentEvent, isAgentEvent } from "../ipc-agent-events";
import { isTeamRealtimeEvent, type TeamRealtimeEvent } from "../ipc-team-host";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { withRuntimeSnapshotBackgroundWork } from "./agent-background-work-v1";
import { withEventAgentPendingRuntimes } from "./agent-pending-runtime-v1";
import { restoreBrowserSecretMetadata } from "./browser-secret-v1";
import { restoreBrowserTakeoverReason } from "./browser-sign-in-v1";
import { restoreBrowserVaultSkip } from "./browser-vault-skip-v1";
import { withRuntimeSnapshotContextUsage } from "./context-usage-v1";
import { eventConversationKey, withConversationPlans } from "./conversation-plan-v4";
import { withConversationSenders } from "./conversation-sender-v5";
import {
  toCurrentAgentKeys,
  toCurrentAgentKeysObjectForPath,
  toWireAgentKeys,
  toWireAgentKeysObjectForPath,
} from "./current-agent-keys";
import { withConversationMemoryChanges } from "./memory-changes-v1";
import { eventHasPromptQuestions, withEventPromptMultiSelect } from "./prompt-multi-select-v1";
import { withQueueEventHold } from "./queue-hold-v1";
import { withConversationSubagents } from "./subagents-v1";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import { withUsageEventGroups } from "./usage-groups-v1";
import { withUsageEventReadFailed } from "./usage-read-failed-v1";
import { withUsageEventTertiary } from "./usage-tertiary-v1";
import {
  decodeTeamProtocolV8BaseEvent,
  decodeTeamProtocolV8BaseHttpRequest,
  decodeTeamProtocolV8BaseHttpResponse,
  encodeTeamProtocolV8BaseEvent,
  type TeamProtocolV8BaseEventDecodeResult,
  type TeamProtocolV8BaseJsonObject,
  type TeamProtocolV8BaseJsonValue,
} from "./v8-base";
import { withConversationVideoGeneration } from "./video-generation-v1";

export type TeamProtocolV8BaseCurrentEventDecodeResult =
  | { kind: "known"; event: AgentEvent | TeamRealtimeEvent }
  | Exclude<TeamProtocolV8BaseEventDecodeResult, { kind: "known" }>;

export function decodeTeamProtocolV8BaseCurrentEvent(value: unknown): TeamProtocolV8BaseCurrentEventDecodeResult {
  if (isDynamicRecord(value) && value.type === "turn-progress") {
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
        restoreBrowserVaultSkip(
          restoreBrowserTakeoverReason(
            restoreBrowserSecretMetadata(
              toCurrentAgentKeys(
                withQueueEventHold(
                  withEventAgentPendingRuntimes(
                    withUsageEventReadFailed(
                      withUsageEventGroups(
                        withUsageEventTertiary(
                          withRuntimeSnapshotBackgroundWork(
                            withRuntimeSnapshotContextUsage(decodedValue, value),
                            value,
                          ),
                          value,
                        ),
                        value,
                      ),
                      value,
                    ),
                    value,
                  ),
                  value,
                ),
              ),
              value,
            ),
            value,
          ),
          value,
        ),
        value,
        value,
        value,
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
    browserVaultSkip?: boolean;
    uiBlocks?: boolean;
    subagents?: boolean;
    promptMultiSelect?: boolean;
    videoGeneration?: boolean;
    contextUsage?: boolean;
    backgroundWork?: boolean;
    usageTertiary?: boolean;
    usageGroups?: boolean;
    usageReadFailed?: boolean;
    agentPendingRuntime?: boolean;
    memoryChanges?: boolean;
    queueHold?: boolean;
    queueHoldSignIn?: boolean;
  } = {},
): string | null {
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
  const backgroundWork = options.backgroundWork === true && event.type === "runtime-snapshot";
  const usageTertiary = options.usageTertiary === true && event.type === "usage-changed";
  const usageGroups = options.usageGroups === true && event.type === "usage-changed";
  const usageReadFailed = options.usageReadFailed === true && event.type === "usage-changed";
  const pendingRuntime = options.agentPendingRuntime === true && event.type === "agents-changed";
  const queueHold = options.queueHold === true && event.type === "queue-changed";
  if (
    !encoded ||
    (!options.preserveBrowserSecrets &&
      !options.browserSignIn &&
      !options.browserVaultSkip &&
      !eventConversationKey(event.type) &&
      !promptMultiSelect &&
      !contextUsage &&
      !backgroundWork &&
      !usageTertiary &&
      !usageGroups &&
      !usageReadFailed &&
      !pendingRuntime &&
      !queueHold)
  )
    return encoded;
  const withPlans = withEventConversationPlans(
    JSON.parse(encoded),
    wireValue,
    options.uiBlocks ? currentValue : null,
    options.subagents ? currentValue : null,
    options.videoGeneration ? currentValue : null,
    options.memoryChanges ? currentValue : null,
  );
  const withMultiSelect = promptMultiSelect ? withEventPromptMultiSelect(withPlans, currentValue) : withPlans;
  const withContext = contextUsage
    ? withRuntimeSnapshotContextUsage(withMultiSelect, wireValue, true)
    : withMultiSelect;
  const withWork = backgroundWork ? withRuntimeSnapshotBackgroundWork(withContext, wireValue, true) : withContext;
  const withUsage = usageTertiary ? withUsageEventTertiary(withWork, wireValue, true) : withWork;
  const withGroups = usageGroups ? withUsageEventGroups(withUsage, wireValue, true) : withUsage;
  const withReadFailed = usageReadFailed ? withUsageEventReadFailed(withGroups, wireValue, true) : withGroups;
  const withPending = pendingRuntime ? withEventAgentPendingRuntimes(withReadFailed, wireValue, true) : withReadFailed;
  const output = queueHold
    ? withQueueEventHold(withPending, wireValue, true, options.queueHoldSignIn === true)
    : withPending;
  const withSecrets = options.preserveBrowserSecrets ? restoreBrowserSecretMetadata(output, wireValue) : output;
  const withReason = options.browserSignIn ? restoreBrowserTakeoverReason(withSecrets, wireValue) : withSecrets;
  return JSON.stringify(options.browserVaultSkip ? restoreBrowserVaultSkip(withReason, wireValue) : withReason);
}

function withEventConversationPlans(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  uiBlockSource: unknown,
  subagentSource: unknown,
  videoSource: unknown,
  memorySource: unknown,
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
  const withSubagents = isDynamicRecord(subagentSource)
    ? withConversationSubagents(withBlocks, subagentSource[key])
    : withBlocks;
  const withVideo = isDynamicRecord(videoSource)
    ? withConversationVideoGeneration(withSubagents, videoSource[key])
    : withSubagents;
  return {
    ...projected,
    [key]: isDynamicRecord(memorySource) ? withConversationMemoryChanges(withVideo, memorySource[key]) : withVideo,
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
