import { decodeAgentAnalytics } from "../ipc-agent-analytics";
import { BROWSER_SECRET_RESPONSE_PATH, parseBrowserSecretResponse } from "../ipc-browser-secret";
import { decodeHostAnalytics } from "../ipc-host-analytics";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "../runtime-values";
import { isAgentListRoute, withAgentPendingRuntimes } from "./agent-pending-runtime-v1";
import { decodeAnalyticsV1Response } from "./analytics-v1";
import {
  decodeBrowserDisplayResponse,
  decodeBrowserLoadRequest,
  isBrowserDisplayRoute,
  isBrowserLoadRoute,
} from "./browser-navigation-v1";
import {
  decodeBrowserViewSessionRequest,
  decodeBrowserViewSessionResponse,
  isBrowserViewSessionRoute,
  isBrowserViewSessionsRoute,
} from "./browser-view-v1";
import { withExchangeExpectsReply } from "./conversation-exchange-v7";
import { withConversationPlans } from "./conversation-plan-v4";
import { withConversationSenders } from "./conversation-sender-v5";
import {
  isAgentAnalyticsRoute,
  isAgentCreateRoute,
  isAgentMessageRoute,
  isAgentProfileRoute,
  isConversationRoute,
  isConversationUnreadRoute,
  isHostAnalyticsRoute,
  isQueueSnapshotRoute,
} from "./current";
import {
  currentProfileRoutes,
  decodeScopedUsageRequest,
  decodeUnreadRequest,
  duplicateRoute,
  readPath,
  scopedUsageRoute,
} from "./current-adapter-routes";
import { toCurrentAgentKeys, toCurrentAgentKeysObjectForPath, toWireAgentKeys } from "./current-agent-keys";
import { isHistoryExtentRoute, withPageHistoryExtent } from "./history-extent-v1";
import { decodeHostAnalyticsV1Response } from "./host-analytics-v1";
import { withConversationMemoryChanges } from "./memory-changes-v1";
import { decodeMessageClientId } from "./message-client-id-v1";
import { decodeProfileV8Request, decodeProfileV8Response } from "./profile-v8";
import { withConversationPromptMultiSelect } from "./prompt-multi-select-v1";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";
import { decodeQueueEditRequest, isQueueEditRoute } from "./queue-edit-v1";
import { withQueueHold } from "./queue-hold-v1";
import { TEAM_REASONING_EFFORTS } from "./reasoning-efforts-v1";
import { withConversationRemoteSender } from "./remote-agent-bridge-v1";
import {
  decodeRemoteDesktopSetupRequest,
  decodeRemoteDesktopSetupResponse,
  isRemoteDesktopSetupRoute,
} from "./remote-desktop-setup-v1";
import { withConversationSubagents } from "./subagents-v1";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import { isUsageRoute, withUsageTertiary } from "./usage-tertiary-v1";
import { decodeTeamProtocolV8HttpRequest, decodeTeamProtocolV8HttpResponse } from "./v8";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";
import {
  decodeTeamProtocolV8BaseCurrentHttpRequest,
  decodeTeamProtocolV8BaseCurrentHttpResponse,
  encodeTeamProtocolV8BaseCurrentHttpRequest,
  encodeTeamProtocolV8BaseCurrentHttpResponse,
} from "./v8-base-adapter";
import { withConversationVideoGeneration } from "./video-generation-v1";

const QUEUE_MARKS = { editing: "Invalid queue edit mark.", expectsReply: "Invalid queue reply mark." } as const;

function withQueueMarks(projected: TeamProtocolV8BaseJsonValue, source: unknown): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.deliveries)) return projected;
  if (!isDynamicRecord(source) || !Array.isArray(source.deliveries)) return projected;
  const marks = new Map<string, TeamProtocolV8BaseJsonObject>();
  for (const delivery of source.deliveries) {
    if (!isDynamicRecord(delivery)) continue;
    const present: TeamProtocolV8BaseJsonObject = {};
    for (const [key, error] of Object.entries(QUEUE_MARKS)) {
      const mark = delivery[key];
      if (mark === undefined) continue;
      if (!isBoolean(mark)) throw new Error(error);
      present[key] = mark;
    }
    if (isString(delivery.id) && Object.keys(present).length > 0) marks.set(delivery.id, present);
  }
  if (marks.size === 0) return projected;
  return {
    ...projected,
    deliveries: projected.deliveries.map((delivery) =>
      isDynamicRecord(delivery) && isString(delivery.id) && marks.has(delivery.id)
        ? { ...delivery, ...marks.get(delivery.id) }
        : delivery,
    ),
  };
}

function messageTimezone(source: unknown): TeamProtocolV8BaseJsonObject {
  if (!isDynamicRecord(source) || source.timezone === undefined) return {};
  const timezone = source.timezone;
  if (!isString(timezone) || timezone.length > 128) throw new Error("Invalid message timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return {};
  }
  return { timezone };
}

function encodeQueueSnapshot(json: string, source: unknown): string {
  return JSON.stringify(withQueueMarks(JSON.parse(json), source));
}

const profile = currentProfileRoutes({
  decodeRequest: decodeProfileV8Request,
  decodeResponse: decodeProfileV8Response,
});

export function encodeTeamProtocolV8CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
): string {
  if (isRemoteDesktopSetupRoute(method, path)) return JSON.stringify(decodeRemoteDesktopSetupRequest(path, value));
  if (method === "POST" && path === BROWSER_SECRET_RESPONSE_PATH)
    return JSON.stringify(parseBrowserSecretResponse(value));
  if (isBrowserLoadRoute(method, path)) return JSON.stringify(decodeBrowserLoadRequest(value));
  if (isBrowserViewSessionsRoute(method, path)) return JSON.stringify(decodeBrowserViewSessionRequest(value));
  if (isQueueEditRoute(method, path)) return JSON.stringify(decodeQueueEditRequest(value));
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path))
    return JSON.stringify(decodeScopedUsageRequest(value));
  if (isAgentProfileRoute(method, path)) return JSON.stringify(profile.encodeRequest(path, value));
  if (isConversationUnreadRoute(method, path)) return JSON.stringify(decodeUnreadRequest(value));
  if (scopedUsageRoute(method, path)) {
    return JSON.stringify(decodeScopedUsageRequest(value));
  }
  if (!duplicateRoute(method, path)) {
    if (isAgentCreateRoute(method, path) && options.agentCreateModel) {
      const projected = JSON.parse(encodeTeamProtocolV8BaseCurrentHttpRequest(method, path, value, options));
      return JSON.stringify({ ...projected, ...decodeAgentCreateModel(value) });
    }
    if (isAgentMessageRoute(method, path)) {
      const projected = JSON.parse(encodeTeamProtocolV8BaseCurrentHttpRequest(method, path, value, options));
      return JSON.stringify({ ...projected, ...messageTimezone(value), ...decodeMessageClientId(value) });
    }
    return encodeTeamProtocolV8BaseCurrentHttpRequest(method, path, value, options);
  }
  const currentValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV8HttpRequest(method, path, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV8CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
): TeamProtocolV8BaseJsonObject {
  if (isRemoteDesktopSetupRoute(method, path)) return decodeRemoteDesktopSetupRequest(path, value);
  if (method === "POST" && path === BROWSER_SECRET_RESPONSE_PATH) return { ...parseBrowserSecretResponse(value) };
  if (isBrowserLoadRoute(method, path)) return { ...decodeBrowserLoadRequest(value) };
  if (isBrowserViewSessionsRoute(method, path)) return { ...decodeBrowserViewSessionRequest(value) };
  if (isQueueEditRoute(method, path)) return { ...decodeQueueEditRequest(value) };
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) return decodeScopedUsageRequest(value);
  if (isAgentProfileRoute(method, path)) return profile.decodeRequest(path, value);
  if (isConversationUnreadRoute(method, path)) return decodeUnreadRequest(value);
  if (scopedUsageRoute(method, path)) {
    return decodeScopedUsageRequest(value);
  }
  if (!duplicateRoute(method, path)) {
    const decoded = options.preserveSemanticTags
      ? decodeTeamProtocolV8BaseCurrentHttpRequest(method, path, value)
      : decodeTeamProtocolV8BaseCurrentHttpRequest(
          method,
          path,
          JSON.parse(encodeTeamProtocolV8BaseCurrentHttpRequest(method, path, value)),
        );
    if (isAgentCreateRoute(method, path) && options.agentCreateModel) {
      return { ...decoded, ...decodeAgentCreateModel(value) };
    }
    if (isAgentMessageRoute(method, path))
      return { ...decoded, ...messageTimezone(value), ...decodeMessageClientId(value) };
    return decoded;
  }
  return toCurrentAgentKeysObjectForPath(path, structuredClone(decodeTeamProtocolV8HttpRequest(method, path, value)));
}

export function encodeTeamProtocolV8CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: {
    preserveSemanticTags?: boolean;
    historyExtent?: boolean;
    uiBlocks?: boolean;
    subagents?: boolean;
    promptMultiSelect?: boolean;
    videoGeneration?: boolean;
    remoteSender?: boolean;
    usageTertiary?: boolean;
    agentPendingRuntime?: boolean;
    memoryChanges?: boolean;
    queueHold?: boolean;
  } = {},
): string {
  const {
    historyExtent,
    uiBlocks,
    subagents,
    promptMultiSelect,
    videoGeneration,
    remoteSender,
    usageTertiary,
    agentPendingRuntime,
    memoryChanges,
    queueHold,
    ...frozen
  } = options;
  const encoded = encodeFrozenResponse(method, path, status, value, frozen);
  if (status >= 400) return encoded;
  if (queueHold && (isQueueSnapshotRoute(method, path) || isQueueEditRoute(method, path)))
    return JSON.stringify(withQueueHold(JSON.parse(encoded), value, true));
  const withUsage = usageTertiary && isUsageRoute(method, path);
  const withExtent = historyExtent && isHistoryExtentRoute(method, path);
  const withBlocks = uiBlocks && isConversationRoute(method, path);
  const withSubagents = subagents && isConversationRoute(method, path);
  const withMultiSelect = promptMultiSelect && isConversationRoute(method, path);
  const withVideo = videoGeneration && isConversationRoute(method, path);
  const withRemote = remoteSender && isConversationRoute(method, path);
  const withPending = agentPendingRuntime && isAgentListRoute(method, path);
  const withMemory = memoryChanges && isConversationRoute(method, path);
  if (
    !withUsage &&
    !withExtent &&
    !withBlocks &&
    !withSubagents &&
    !withMultiSelect &&
    !withVideo &&
    !withRemote &&
    !withPending &&
    !withMemory
  )
    return encoded;
  let output: TeamProtocolV8BaseJsonValue = JSON.parse(encoded);
  if (withUsage) output = withUsageTertiary(output, value, true);
  if (withExtent) output = withPageHistoryExtent(output, value);
  if (withBlocks) output = withConversationUiBlocks(output, value);
  if (withSubagents) output = withConversationSubagents(output, value);
  if (withMultiSelect) output = withConversationPromptMultiSelect(output, value);
  if (withVideo) output = withConversationVideoGeneration(output, value);
  if (withRemote) output = withConversationRemoteSender(output, value);
  if (withPending) output = withAgentPendingRuntimes(output, value, true);
  if (withMemory) output = withConversationMemoryChanges(output, value);
  return JSON.stringify(output);
}

function encodeFrozenResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean },
): string {
  if (isRemoteDesktopSetupRoute(method, path) && status < 400)
    return JSON.stringify(decodeRemoteDesktopSetupResponse(path, value));
  if (isHostAnalyticsRoute(method, path) && status < 400)
    return JSON.stringify(decodeHostAnalyticsV1Response(decodeHostAnalytics(value)));
  if (isAgentAnalyticsRoute(method, path) && status < 400)
    return JSON.stringify(decodeAnalyticsV1Response(decodeAgentAnalytics(value)));
  if (isAgentProfileRoute(method, path) && status < 400) return JSON.stringify(profile.encodeResponse(path, value));
  if (isBrowserLoadRoute(method, path) && status < 400) return "{}";
  if (path === BROWSER_SECRET_RESPONSE_PATH && status === 204) return "{}";
  if (isBrowserViewSessionRoute(method, path) && status < 400) return "{}";
  if (isBrowserViewSessionsRoute(method, path) && status < 400)
    return JSON.stringify(decodeBrowserViewSessionResponse(value));
  if (isBrowserDisplayRoute(method, path) && status < 400)
    return JSON.stringify(decodeBrowserDisplayResponse(toWireAgentKeys(JSON.parse(JSON.stringify(value ?? null)))));
  if (isQueueEditRoute(method, path) && status === 204) return "{}";
  if (isQueueEditRoute(method, path))
    return encodeQueueSnapshot(
      encodeTeamProtocolV8BaseCurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value, options),
      value,
    );
  if (isQueueSnapshotRoute(method, path) && status < 400)
    return encodeQueueSnapshot(
      encodeTeamProtocolV8BaseCurrentHttpResponse(method, path, status, value, options),
      value,
    );
  if (isConversationRoute(method, path) && status < 400)
    return JSON.stringify(
      withConversationSenders(
        withConversationPlans(
          withExchangeExpectsReply(
            JSON.parse(encodeTeamProtocolV8BaseCurrentHttpResponse(method, path, status, value, options)),
            value,
          ),
          value,
        ),
        value,
      ),
    );
  if (isConversationUnreadRoute(method, path))
    return encodeTeamProtocolV8BaseCurrentHttpResponse(method, readPath(path), status, value, options);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return encodeTeamProtocolV8BaseCurrentHttpResponse(method, "/v1/agents/usage", status, value, options);
  }
  if (!duplicateRoute(method, path)) {
    return encodeTeamProtocolV8BaseCurrentHttpResponse(method, path, status, value, options);
  }
  const currentValue: TeamProtocolV8BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV8HttpResponse(method, path, status, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV8CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV8BaseJsonValue {
  const decoded = decodeFrozenResponse(method, path, status, value);
  if (status >= 400) return decoded;
  if (isAgentListRoute(method, path)) return withAgentPendingRuntimes(decoded, value);
  const withUsage = isUsageRoute(method, path) ? withUsageTertiary(decoded, value) : decoded;
  const withExtent = isHistoryExtentRoute(method, path) ? withPageHistoryExtent(withUsage, value) : withUsage;
  if (!isConversationRoute(method, path)) return withExtent;
  return withConversationRemoteSender(
    withConversationMemoryChanges(
      withConversationVideoGeneration(
        withConversationPromptMultiSelect(
          withConversationSubagents(withConversationUiBlocks(withExtent, value), value),
          value,
        ),
        value,
      ),
      value,
    ),
    value,
  );
}

function decodeFrozenResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV8BaseJsonValue {
  if (isRemoteDesktopSetupRoute(method, path) && status < 400) return decodeRemoteDesktopSetupResponse(path, value);
  if (isHostAnalyticsRoute(method, path) && status < 400)
    return JSON.parse(JSON.stringify(decodeHostAnalytics(decodeHostAnalyticsV1Response(value))));
  if (isAgentAnalyticsRoute(method, path) && status < 400)
    return JSON.parse(JSON.stringify(decodeAgentAnalytics(decodeAnalyticsV1Response(value))));
  if (isAgentProfileRoute(method, path) && status < 400) return profile.decodeResponse(path, value);
  if (isBrowserLoadRoute(method, path) && status < 400) return {};
  if (path === BROWSER_SECRET_RESPONSE_PATH && status === 204) return {};
  if (isBrowserViewSessionRoute(method, path) && status < 400) return {};
  if (isBrowserViewSessionsRoute(method, path) && status < 400) return { ...decodeBrowserViewSessionResponse(value) };
  if (isBrowserDisplayRoute(method, path) && status < 400)
    return toCurrentAgentKeys(structuredClone(decodeBrowserDisplayResponse(value)));
  if (isQueueEditRoute(method, path) && status === 204) return {};
  if (isQueueEditRoute(method, path))
    return withQueueHold(
      withQueueMarks(
        decodeTeamProtocolV8BaseCurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value),
        value,
      ),
      value,
    );
  if (isQueueSnapshotRoute(method, path) && status < 400)
    return withQueueHold(
      withQueueMarks(decodeTeamProtocolV8BaseCurrentHttpResponse(method, path, status, value), value),
      value,
    );
  if (isConversationRoute(method, path) && status < 400)
    return withConversationSenders(
      withConversationPlans(
        withExchangeExpectsReply(decodeTeamProtocolV8BaseCurrentHttpResponse(method, path, status, value), value),
        value,
      ),
      value,
    );
  if (isConversationUnreadRoute(method, path))
    return decodeTeamProtocolV8BaseCurrentHttpResponse(method, readPath(path), status, value);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return decodeTeamProtocolV8BaseCurrentHttpResponse(method, "/v1/agents/usage", status, value);
  }
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV8BaseCurrentHttpResponse(method, path, status, value);
  return toCurrentAgentKeys(structuredClone(decodeTeamProtocolV8HttpResponse(method, path, status, value)));
}

const V8_AGENT_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u;
const V8_REASONING_EFFORTS = TEAM_REASONING_EFFORTS;

function decodeAgentCreateModel(value: unknown): TeamProtocolV8BaseJsonObject {
  if (!isDynamicRecord(value)) throw new Error("Invalid agent creation request.");
  const result: TeamProtocolV8BaseJsonObject = {};
  if (value.provider !== undefined) {
    if (!isString(value.provider) || !OPEN_PROVIDER_ID.test(value.provider)) throw new Error("Invalid agent provider.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isString(value.model) || !V8_AGENT_MODEL.test(value.model)) throw new Error("Invalid agent model.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isOneOf(V8_REASONING_EFFORTS, value.reasoningEffort)) throw new Error("Invalid reasoning effort.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}
