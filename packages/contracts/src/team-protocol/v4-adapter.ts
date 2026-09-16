import { decodeAgentAnalytics } from "../ipc-agent-analytics";
import { isAgentModel, isReasoningEffort } from "../ipc-agent-identity";
import {
  decodeAgentProfileDraft,
  decodeSaveAgentProfileResult,
  parseGenerateAgentProfile,
  parseSaveAgentProfile,
} from "../ipc-agent-profile";
import { isAgentProvider } from "../ipc-agent-status";
import { decodeHostAnalytics } from "../ipc-host-analytics";
import { isBoolean, isDynamicRecord, isString } from "../runtime-values";
import { decodeAnalyticsV1Response } from "./analytics-v1";
import {
  isAgentAnalyticsRoute,
  isAgentCreateRoute,
  isAgentProfileRoute,
  isConversationUnreadRoute,
  isHostAnalyticsRoute,
  isQueueSnapshotRoute,
} from "./current";
import { toCurrentAgentKeys, toCurrentAgentKeysObjectForPath, toWireAgentKeys } from "./current-agent-keys";
import { decodeHostAnalyticsV1Response } from "./host-analytics-v1";
import { decodeProfileV4Request, decodeProfileV4Response } from "./profile-v4";
import { decodeQueueEditRequest, isQueueEditRoute } from "./queue-edit-v1";
import { decodeTeamProtocolV4HttpRequest, decodeTeamProtocolV4HttpResponse } from "./v4";
import type { TeamProtocolV4BaseJsonObject, TeamProtocolV4BaseJsonValue } from "./v4-base";
import {
  decodeTeamProtocolV4BaseCurrentHttpRequest,
  decodeTeamProtocolV4BaseCurrentHttpResponse,
  encodeTeamProtocolV4BaseCurrentHttpRequest,
  encodeTeamProtocolV4BaseCurrentHttpResponse,
} from "./v4-base-adapter";

/**
 * `editing` rides beside the frozen queue projection: the shipped key lists drop it, so a client on
 * protocol 1-3 reads the queue exactly as it did before, and only the current protocol carries the
 * mark that another editor holds a message.
 */
function withQueueEditing(projected: TeamProtocolV4BaseJsonValue, source: unknown): TeamProtocolV4BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.deliveries)) return projected;
  if (!isDynamicRecord(source) || !Array.isArray(source.deliveries)) return projected;
  const marks = new Map<string, boolean>();
  for (const delivery of source.deliveries) {
    if (isDynamicRecord(delivery) && isString(delivery.id) && isBoolean(delivery.editing))
      marks.set(delivery.id, delivery.editing);
  }
  if (marks.size === 0) return projected;
  return {
    ...projected,
    deliveries: projected.deliveries.map((delivery) =>
      isDynamicRecord(delivery) && isString(delivery.id) && marks.has(delivery.id)
        ? { ...delivery, editing: marks.get(delivery.id) ?? false }
        : delivery,
    ),
  };
}

function encodeQueueSnapshot(json: string, source: unknown): string {
  return JSON.stringify(withQueueEditing(JSON.parse(json), source));
}

export function encodeTeamProtocolV4CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
): string {
  if (isQueueEditRoute(method, path)) return JSON.stringify(decodeQueueEditRequest(value));
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path))
    return JSON.stringify(decodeScopedUsageRequest(value));
  if (isAgentProfileRoute(method, path)) return JSON.stringify(encodeProfileRequest(path, value));
  if (isConversationUnreadRoute(method, path)) return JSON.stringify(decodeUnreadRequest(value));
  if (scopedUsageRoute(method, path)) {
    return JSON.stringify(decodeScopedUsageRequest(value));
  }
  if (!duplicateRoute(method, path)) {
    // The frozen base projection names no provider or model, so a chosen pair rides beside it:
    // only a host behind the capability reads them, and anything older drops unknown keys.
    if (isAgentCreateRoute(method, path) && options.agentCreateModel) {
      const projected = JSON.parse(
        encodeTeamProtocolV4BaseCurrentHttpRequest(method, path, value, {
          preserveSemanticTags: options.preserveSemanticTags,
        }),
      );
      return JSON.stringify({ ...projected, ...decodeAgentCreateModel(value) });
    }
    return encodeTeamProtocolV4BaseCurrentHttpRequest(method, path, value, options);
  }
  // The duplicate route reaches the frozen v3 codec directly, so the vocabulary swap happens here.
  const currentValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV4HttpRequest(method, path, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV4CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
): TeamProtocolV4BaseJsonObject {
  if (isQueueEditRoute(method, path)) return { ...decodeQueueEditRequest(value) };
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) return decodeScopedUsageRequest(value);
  if (isAgentProfileRoute(method, path))
    return profileRequest(path, decodeProfileV4Request(profileGeneration(path), value));
  if (isConversationUnreadRoute(method, path)) return decodeUnreadRequest(value);
  if (scopedUsageRoute(method, path)) {
    return decodeScopedUsageRequest(value);
  }
  if (!duplicateRoute(method, path)) {
    const decoded = options.preserveSemanticTags
      ? decodeTeamProtocolV4BaseCurrentHttpRequest(method, path, value)
      : decodeTeamProtocolV4BaseCurrentHttpRequest(
          method,
          path,
          // The encode call is only here to expand semantic tags, and it leaves the object in wire
          // vocabulary. Decoding its output is what brings the keys back to the current spelling the
          // handlers read.
          JSON.parse(encodeTeamProtocolV4BaseCurrentHttpRequest(method, path, value)),
        );
    // Read off the raw request, not the projection: the frozen base codec drops unknown keys, so
    // the pair is gone by the time `decoded` exists. A request without the capability takes the
    // host default exactly as before.
    if (isAgentCreateRoute(method, path) && options.agentCreateModel) {
      return { ...decoded, ...decodeAgentCreateModel(value) };
    }
    return decoded;
  }
  return toCurrentAgentKeysObjectForPath(path, structuredClone(decodeTeamProtocolV4HttpRequest(method, path, value)));
}

export function encodeTeamProtocolV4CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  if (isHostAnalyticsRoute(method, path) && status < 400)
    return JSON.stringify(decodeHostAnalyticsV1Response(decodeHostAnalytics(value)));
  if (isAgentAnalyticsRoute(method, path) && status < 400)
    return JSON.stringify(decodeAnalyticsV1Response(decodeAgentAnalytics(value)));
  if (isAgentProfileRoute(method, path) && status < 400) return JSON.stringify(encodeProfileResponse(path, value));
  if (isQueueEditRoute(method, path) && status === 204) return "{}";
  if (isQueueEditRoute(method, path))
    return encodeQueueSnapshot(
      encodeTeamProtocolV4BaseCurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value, options),
      value,
    );
  if (isQueueSnapshotRoute(method, path) && status < 400)
    return encodeQueueSnapshot(
      encodeTeamProtocolV4BaseCurrentHttpResponse(method, path, status, value, options),
      value,
    );
  if (isConversationUnreadRoute(method, path))
    return encodeTeamProtocolV4BaseCurrentHttpResponse(method, readPath(path), status, value, options);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return encodeTeamProtocolV4BaseCurrentHttpResponse(method, "/v1/agents/usage", status, value, options);
  }
  if (!duplicateRoute(method, path)) {
    return encodeTeamProtocolV4BaseCurrentHttpResponse(method, path, status, value, options);
  }
  // The duplicate route reaches the frozen v3 codec directly, so the vocabulary swap happens here.
  const currentValue: TeamProtocolV4BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV4HttpResponse(method, path, status, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV4CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV4BaseJsonValue {
  if (isHostAnalyticsRoute(method, path) && status < 400)
    return JSON.parse(JSON.stringify(decodeHostAnalytics(decodeHostAnalyticsV1Response(value))));
  if (isAgentAnalyticsRoute(method, path) && status < 400)
    return JSON.parse(JSON.stringify(decodeAgentAnalytics(decodeAnalyticsV1Response(value))));
  if (isAgentProfileRoute(method, path) && status < 400) return decodeProfileResponse(path, value);
  if (isQueueEditRoute(method, path) && status === 204) return {};
  if (isQueueEditRoute(method, path))
    return withQueueEditing(
      decodeTeamProtocolV4BaseCurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value),
      value,
    );
  if (isQueueSnapshotRoute(method, path) && status < 400)
    return withQueueEditing(decodeTeamProtocolV4BaseCurrentHttpResponse(method, path, status, value), value);
  if (isConversationUnreadRoute(method, path))
    return decodeTeamProtocolV4BaseCurrentHttpResponse(method, readPath(path), status, value);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return decodeTeamProtocolV4BaseCurrentHttpResponse(method, "/v1/agents/usage", status, value);
  }
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV4BaseCurrentHttpResponse(method, path, status, value);
  return toCurrentAgentKeys(structuredClone(decodeTeamProtocolV4HttpResponse(method, path, status, value)));
}

function decodeUnreadRequest(value: unknown): TeamProtocolV4BaseJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new Error("Invalid conversation-unread request.");
  }
  return {};
}

/**
 * The provider, model and reasoning effort of an agent creation request, validated and fail-closed:
 * a present field with the wrong shape rejects the request rather than silently starting the agent
 * on the host default. Absent fields stay absent, so the host default still applies.
 */
function decodeAgentCreateModel(value: unknown): TeamProtocolV4BaseJsonObject {
  if (!isDynamicRecord(value)) throw new Error("Invalid agent creation request.");
  const result: TeamProtocolV4BaseJsonObject = {};
  if (value.provider !== undefined) {
    if (!isAgentProvider(value.provider)) throw new Error("Invalid agent provider.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new Error("Invalid agent model.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw new Error("Invalid reasoning effort.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}

function readPath(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname.replace(/\/unread$/u, "/read");
}

function scopedUsageRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return method === "GET" && /^\/v1\/agents\/[^/]+\/usage$/u.test(pathname);
}

function decodeScopedUsageRequest(value: unknown): TeamProtocolV4BaseJsonObject {
  if (!isDynamicRecord(value) || Object.keys(value).length > 0) {
    throw new Error("Invalid model-scoped usage request.");
  }
  return {};
}

function duplicateRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return method === "POST" && /^\/v1\/agents\/[^/]+\/duplicate$/u.test(pathname);
}

function profileRequest(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  const parsed = new URL(path, "http://openbot.invalid").pathname.endsWith("/generate")
    ? parseGenerateAgentProfile(value)
    : parseSaveAgentProfile(value);
  return JSON.parse(JSON.stringify(parsed));
}
function profileResponse(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  const parsed = new URL(path, "http://openbot.invalid").pathname.endsWith("/generate")
    ? decodeAgentProfileDraft(value)
    : decodeSaveAgentProfileResult(value);
  return JSON.parse(JSON.stringify(parsed));
}

function profileGeneration(path: string): boolean {
  return new URL(path, "http://openbot.invalid").pathname.endsWith("/generate");
}
function encodeProfileRequest(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  return decodeProfileV4Request(profileGeneration(path), profileRequest(path, value));
}

function encodeProfileResponse(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  const parsed = profileResponse(path, value);
  return decodeProfileV4Response(
    profileGeneration(path),
    profileGeneration(path)
      ? parsed
      : {
          agent: toWireAgentKeys(parsed.agent),
          layout: parsed.layout,
        },
  );
}
function decodeProfileResponse(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  const parsed = decodeProfileV4Response(profileGeneration(path), value);
  return profileResponse(
    path,
    profileGeneration(path)
      ? parsed
      : {
          agent: toCurrentAgentKeys(parsed.agent),
          layout: parsed.layout,
        },
  );
}
