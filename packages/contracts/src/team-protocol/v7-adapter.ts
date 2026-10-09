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
import { decodeHostAnalyticsV1Response } from "./host-analytics-v1";
import { decodeMessageClientId } from "./message-client-id-v1";
import { decodeProfileV7Request, decodeProfileV7Response } from "./profile-v7";
import { decodeQueueEditRequest, isQueueEditRoute } from "./queue-edit-v1";
import {
  decodeRemoteDesktopSetupRequest,
  decodeRemoteDesktopSetupResponse,
  isRemoteDesktopSetupRoute,
} from "./remote-desktop-setup-v1";
import { decodeTeamProtocolV7HttpRequest, decodeTeamProtocolV7HttpResponse } from "./v7";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";
import {
  decodeTeamProtocolV7BaseCurrentHttpRequest,
  decodeTeamProtocolV7BaseCurrentHttpResponse,
  encodeTeamProtocolV7BaseCurrentHttpRequest,
  encodeTeamProtocolV7BaseCurrentHttpResponse,
} from "./v7-base-adapter";

/**
 * `editing` and `expectsReply` ride beside the frozen queue projection: the shipped key lists drop
 * them, so a client on protocol 1-3 reads the queue exactly as it did before, and only the current
 * protocol carries the mark that another editor holds a message, or that a teammate's message
 * needs no answer. A client uses the second mark to keep a teammate's answer out of the actions it
 * offers on queued messages.
 *
 * A present mark must be a boolean. The projection removes the key, so an unchecked `editing` would
 * reach the client as a message nobody holds, and enable the edit actions the hold disables; an
 * unchecked `expectsReply` would reach it as a question. Fail closed instead; an absent mark still
 * means an older host that never sends one: no hold, and an answer expected.
 */
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

/**
 * `expectsReply` rides beside the frozen conversation projection, in the way `editing` rides beside
 * the queue: the shipped key lists drop it, so a client on protocol 1-3 reads every exchange as a
 * request, and only the current protocol learns that the sender asked for no answer.
 *
 * A present mark must be a boolean. The projection removes the key, so an unchecked value would
 * reach the client as an exchange that needs no answer, and hide that a teammate is waiting for a
 * result. Fail closed instead; an absent mark still means an older host, and a request.
 */
function withExchangeExpectsReply(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const marks = new Map<string, boolean>();
  for (const message of [
    ...(Array.isArray(source.messages) ? source.messages : []),
    // A page names the messages its replies point at separately, and a reply to an exchange is
    // exactly where the mark is read.
    ...(isDynamicRecord(source.references) ? Object.values(source.references) : []),
  ]) {
    if (!isDynamicRecord(message) || !isDynamicRecord(message.exchange)) continue;
    const mark = message.exchange.expectsReply;
    if (mark === undefined) continue;
    if (!isBoolean(mark)) throw new Error("Invalid exchange reply mark.");
    if (isString(message.id)) marks.set(message.id, mark);
  }
  if (marks.size === 0) return projected;
  const withMark = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id) || !isDynamicRecord(message.exchange)) return message;
    const value = marks.get(message.id);
    return value === undefined ? message : { ...message, exchange: { ...message.exchange, expectsReply: value } };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withMark);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withMark(value)]),
    );
  }
  return result;
}

/**
 * The sender's `timezone` rides beside the frozen message projection: the shipped key list drops it,
 * so an older host never reads it and keeps its own zone for a routine the agent creates.
 *
 * A present value that is not a bounded string is malformed and fails closed. A string this runtime
 * cannot resolve is dropped instead: the client's time zone data can be newer than the host's, and
 * an unknown zone must not stop the message, only the schedule default it would give.
 */
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
    // The frozen base projection names no provider or model, so a chosen pair rides beside it:
    // only a host behind the capability reads them, and anything older drops unknown keys.
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
  // The duplicate route reaches the frozen v3 codec directly, so the vocabulary swap happens here.
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
          // The encode call is only here to expand semantic tags, and it leaves the object in wire
          // vocabulary. Decoding its output is what brings the keys back to the current spelling the
          // handlers read.
          JSON.parse(encodeTeamProtocolV7BaseCurrentHttpRequest(method, path, value)),
        );
    // Read off the raw request, not the projection: the frozen base codec drops unknown keys, so
    // the pair is gone by the time `decoded` exists. A request without the capability takes the
    // host default exactly as before.
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
  options: { preserveSemanticTags?: boolean } = {},
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
  // The tabs keep the released projection, and that projection names `ownerBotId`, so the swap the
  // base adapter does by path has to happen here too.
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
  // The duplicate route reaches the frozen v3 codec directly, so the vocabulary swap happens here.
  const currentValue: TeamProtocolV7BaseJsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV7HttpResponse(method, path, status, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV7CurrentHttpResponse(
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

/**
 * The providers, model ids and reasoning efforts v7 shipped with, as in the `v7-base.ts` agent
 * validator. They are not the app's lists: a value the app adds later is not part of this frozen
 * protocol, so a v7 request cannot name it.
 */
const V7_AGENT_PROVIDERS = ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"] as const;
export const V7_AGENT_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u;
const V7_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * The provider, model and reasoning effort of an agent creation request, validated and fail-closed:
 * a present field with the wrong shape rejects the request rather than silently starting the agent
 * on the host default. Absent fields stay absent, so the host default still applies.
 */
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
