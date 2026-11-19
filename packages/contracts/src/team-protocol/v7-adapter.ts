import { decodeAgentAnalytics } from "../ipc-agent-analytics";
import { BROWSER_SECRET_RESPONSE_PATH, parseBrowserSecretResponse } from "../ipc-browser-secret";
import { decodeHostAnalytics } from "../ipc-host-analytics";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "../runtime-values";
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
import { decodeMessageClientId } from "./message-client-id-v1";
import { decodeProfileV7Request, decodeProfileV7Response } from "./profile-v7";
import { withConversationPromptMultiSelect } from "./prompt-multi-select-v1";
import { decodeQueueEditRequest, isQueueEditRoute } from "./queue-edit-v1";
import {
  decodeRemoteDesktopSetupRequest,
  decodeRemoteDesktopSetupResponse,
  isRemoteDesktopSetupRoute,
} from "./remote-desktop-setup-v1";
import { withConversationSubagents } from "./subagents-v1";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import { decodeTeamProtocolV7HttpRequest, decodeTeamProtocolV7HttpResponse } from "./v7";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";
import {
  decodeTeamProtocolV7BaseCurrentHttpRequest,
  decodeTeamProtocolV7BaseCurrentHttpResponse,
  encodeTeamProtocolV7BaseCurrentHttpRequest,
  encodeTeamProtocolV7BaseCurrentHttpResponse,
} from "./v7-base-adapter";
import { withConversationVideoGeneration } from "./video-generation-v1";

const QUEUE_MARKS = { editing: "Invalid queue edit mark.", expectsReply: "Invalid queue reply mark." } as const;

function withQueueMarks(projected: TeamProtocolV7BaseJsonValue, source: unknown): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.deliveries)) return projected;
  if (!isDynamicRecord(source) || !Array.isArray(source.deliveries)) return projected;
  const marks = new Map<string, TeamProtocolV7BaseJsonObject>();
  for (const delivery of source.deliveries) {
    if (!isDynamicRecord(delivery)) continue;
    const present: TeamProtocolV7BaseJsonObject = {};
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

function messageTimezone(source: unknown): TeamProtocolV7BaseJsonObject {
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
  decodeRequest: decodeProfileV7Request,
  decodeResponse: decodeProfileV7Response,
});

export function encodeTeamProtocolV7CurrentHttpRequest(
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
      const projected = JSON.parse(encodeTeamProtocolV7BaseCurrentHttpRequest(method, path, value, options));
      return JSON.stringify({ ...projected, ...decodeAgentCreateModel(value) });
    }
    if (isAgentMessageRoute(method, path)) {
      const projected = JSON.parse(encodeTeamProtocolV7BaseCurrentHttpRequest(method, path, value, options));
      return JSON.stringify({ ...projected, ...messageTimezone(value), ...decodeMessageClientId(value) });
    }
    return encodeTeamProtocolV7BaseCurrentHttpRequest(method, path, value, options);
  }
  const currentValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV7HttpRequest(method, path, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV7CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
): TeamProtocolV7BaseJsonObject {
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
      ? decodeTeamProtocolV7BaseCurrentHttpRequest(method, path, value)
      : decodeTeamProtocolV7BaseCurrentHttpRequest(
          method,
          path,
          JSON.parse(encodeTeamProtocolV7BaseCurrentHttpRequest(method, path, value)),
        );
    if (isAgentCreateRoute(method, path) && options.agentCreateModel) {
      return { ...decoded, ...decodeAgentCreateModel(value) };
    }
    if (isAgentMessageRoute(method, path))
      return { ...decoded, ...messageTimezone(value), ...decodeMessageClientId(value) };
    return decoded;
  }
  return toCurrentAgentKeysObjectForPath(path, structuredClone(decodeTeamProtocolV7HttpRequest(method, path, value)));
}

export function encodeTeamProtocolV7CurrentHttpResponse(
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
  } = {},
): string {
  const { historyExtent, uiBlocks, subagents, promptMultiSelect, videoGeneration, ...frozen } = options;
  const encoded = encodeFrozenResponse(method, path, status, value, frozen);
  if (status >= 400) return encoded;
  const withExtent = historyExtent && isHistoryExtentRoute(method, path);
  const withBlocks = uiBlocks && isConversationRoute(method, path);
  const withSubagents = subagents && isConversationRoute(method, path);
  const withMultiSelect = promptMultiSelect && isConversationRoute(method, path);
  const withVideo = videoGeneration && isConversationRoute(method, path);
  if (!withExtent && !withBlocks && !withSubagents && !withMultiSelect && !withVideo) return encoded;
  let output: TeamProtocolV7BaseJsonValue = JSON.parse(encoded);
  if (withExtent) output = withPageHistoryExtent(output, value);
  if (withBlocks) output = withConversationUiBlocks(output, value);
  if (withSubagents) output = withConversationSubagents(output, value);
  if (withMultiSelect) output = withConversationPromptMultiSelect(output, value);
  if (withVideo) output = withConversationVideoGeneration(output, value);
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
      encodeTeamProtocolV7BaseCurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value, options),
      value,
    );
  if (isQueueSnapshotRoute(method, path) && status < 400)
    return encodeQueueSnapshot(
      encodeTeamProtocolV7BaseCurrentHttpResponse(method, path, status, value, options),
      value,
    );
  if (isConversationRoute(method, path) && status < 400)
    return JSON.stringify(
      withConversationSenders(
        withConversationPlans(
          withExchangeExpectsReply(
            JSON.parse(encodeTeamProtocolV7BaseCurrentHttpResponse(method, path, status, value, options)),
            value,
          ),
          value,
        ),
        value,
      ),
    );
  if (isConversationUnreadRoute(method, path))
    return encodeTeamProtocolV7BaseCurrentHttpResponse(method, readPath(path), status, value, options);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return encodeTeamProtocolV7BaseCurrentHttpResponse(method, "/v1/agents/usage", status, value, options);
  }
  if (!duplicateRoute(method, path)) {
    return encodeTeamProtocolV7BaseCurrentHttpResponse(method, path, status, value, options);
  }
  const currentValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV7HttpResponse(method, path, status, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV7CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV7BaseJsonValue {
  const decoded = decodeFrozenResponse(method, path, status, value);
  if (status >= 400) return decoded;
  const withExtent = isHistoryExtentRoute(method, path) ? withPageHistoryExtent(decoded, value) : decoded;
  if (!isConversationRoute(method, path)) return withExtent;
  return withConversationVideoGeneration(
    withConversationPromptMultiSelect(
      withConversationSubagents(withConversationUiBlocks(withExtent, value), value),
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
): TeamProtocolV7BaseJsonValue {
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
    return withQueueMarks(
      decodeTeamProtocolV7BaseCurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value),
      value,
    );
  if (isQueueSnapshotRoute(method, path) && status < 400)
    return withQueueMarks(decodeTeamProtocolV7BaseCurrentHttpResponse(method, path, status, value), value);
  if (isConversationRoute(method, path) && status < 400)
    return withConversationSenders(
      withConversationPlans(
        withExchangeExpectsReply(decodeTeamProtocolV7BaseCurrentHttpResponse(method, path, status, value), value),
        value,
      ),
      value,
    );
  if (isConversationUnreadRoute(method, path))
    return decodeTeamProtocolV7BaseCurrentHttpResponse(method, readPath(path), status, value);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return decodeTeamProtocolV7BaseCurrentHttpResponse(method, "/v1/agents/usage", status, value);
  }
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV7BaseCurrentHttpResponse(method, path, status, value);
  return toCurrentAgentKeys(structuredClone(decodeTeamProtocolV7HttpResponse(method, path, status, value)));
}

const V7_AGENT_PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "acp",
  "cursor",
  "cline",
  "pi",
  "muse",
] as const;
export const V7_AGENT_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u;
const V7_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function decodeAgentCreateModel(value: unknown): TeamProtocolV7BaseJsonObject {
  if (!isDynamicRecord(value)) throw new Error("Invalid agent creation request.");
  const result: TeamProtocolV7BaseJsonObject = {};
  if (value.provider !== undefined) {
    if (!isOneOf(V7_AGENT_PROVIDERS, value.provider)) throw new Error("Invalid agent provider.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isString(value.model) || !V7_AGENT_MODEL.test(value.model)) throw new Error("Invalid agent model.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isOneOf(V7_REASONING_EFFORTS, value.reasoningEffort)) throw new Error("Invalid reasoning effort.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}
