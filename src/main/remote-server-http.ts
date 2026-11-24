import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type TeamCurrentCapability, teamCapabilityHeaders } from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import {
  addPromptQuestionDetails,
  TEAM_PROMPT_DETAIL_CAPABILITY,
} from "@openbot/contracts/team-protocol/prompt-detail-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { addSkillSuggestionNames, SKILL_LEARNING_CAPABILITY } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { TEAM_APP_VERSION_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { decodeTeamProtocolV1CurrentHttpResponse } from "@openbot/contracts/team-protocol/v1-adapter";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { startRemoteRequest } from "@openbot/team-client/sync-profile";
import { Effect, Result, Schema } from "effect";
import type { ResponseDecoder } from "./remote-host-decoding";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";

const REMOTE_REQUEST_TIMEOUT_MS = 15_000;

export interface RemoteJsonRequestOptions {
  method?: string | undefined;
  body?: unknown;
  token?: string | undefined;
  protocol?: number | undefined;
  appVersion?: string | undefined;
  capabilities?: readonly TeamCurrentCapability[] | undefined;
  preserveSemanticTags?: boolean | undefined;
  agentCreateModel?: boolean | undefined;
  timeoutMs?: number | undefined;
}

export const requestJson = Effect.fn("RemoteHttp.requestJson")(function* <T>(
  apiUrl: string,
  path: string,
  decoder: ResponseDecoder<T>,
  options: RemoteJsonRequestOptions = {},
) {
  const controller = yield* Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (controller) => Effect.sync(() => controller.abort()),
  );
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const sideRoute = teamSideRouteCodec(path);
  const codec = teamHttpCodec(options.protocol);
  const body =
    options.body === undefined
      ? undefined
      : sideRoute
        ? JSON.stringify(
            sideRoute.request(path, options.body, {
              channelIsolation: true,
              channelPicture: true,
              channelBrowser: true,
              providerManyAccounts: true,
            }),
          )
        : codec.encodeRequest(method, path, options.body, {
            ...(options.preserveSemanticTags === undefined
              ? {}
              : { preserveSemanticTags: options.preserveSemanticTags }),
            ...(options.agentCreateModel === undefined ? {} : { agentCreateModel: options.agentCreateModel }),
          });
  const profile = yield* Effect.acquireRelease(
    Effect.sync(() => startRemoteRequest(method, path, body ?? "", "http")),
    (profile, exit) => Effect.sync(() => profile?.end(exit)),
  );
  const response = yield* remoteFetch(
    new URL(path, apiUrl),
    {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.protocol ? { [TEAM_PROTOCOL_VERSION_HEADER]: String(options.protocol) } : {}),
        ...(options.appVersion ? { [TEAM_APP_VERSION_HEADER]: options.appVersion } : {}),
        ...(options.capabilities ? teamCapabilityHeaders(options.protocol, options.capabilities) : {}),
      },
      ...(body === undefined ? {} : { body }),
    },
    options.timeoutMs,
  );
  if (profile)
    profile.responded(
      yield* Effect.tryPromise(() => response.clone().arrayBuffer()).pipe(
        Effect.match({ onFailure: () => 0, onSuccess: (buffer) => buffer.byteLength }),
      ),
    );
  let value: unknown;
  if (response.status !== 204) {
    const decoded = yield* Effect.result(
      Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          isJsonContentType(response.headers.get("content-type"))
            ? new RemoteProtocolError("protocol_error", sourceText("error.remote.invalidData"), null, { cause })
            : new RemoteTransportError({ cause: new TypeError("The reply did not come from the host.", { cause }) }),
      }),
    );
    if (Result.isFailure(decoded)) {
      if (response.ok) return yield* Effect.fail(decoded.failure);
    } else value = decoded.success;
  }
  if (value !== undefined) {
    const input = value;
    const decodedValue = yield* Effect.try({
      try: () =>
        sideRoute
          ? sideRoute.response(path, response.status, input, {
              historyExtent: true,
              channelAttention: true,
              agentTaskUiBlocks: true,
              channelIsolation: true,
              channelPicture: true,
              channelBrowser: true,
              channelSeenSubtasks: true,
              channelTaskWaits: true,
              mcpManyServers: true,
              providerManyAccounts: true,
              routineResultsWhatsApp: true,
              storageWorkflowFiles: true,
            })
          : codec.decodeResponse(method, path, response.status, input),
      catch: (cause) =>
        new RemoteProtocolError("protocol_error", sourceText("error.remote.unsafeData"), null, { cause }),
    });
    if (options.capabilities?.includes(SKILL_LEARNING_CAPABILITY)) addSkillSuggestionNames(decodedValue, input);
    if (options.capabilities?.includes(TEAM_PROMPT_DETAIL_CAPABILITY)) addPromptQuestionDetails(decodedValue, input);
    value = decodedValue;
  }
  if (!response.ok) {
    const message =
      isDynamicRecord(value) && isString(value.error)
        ? value.error
        : sourceText("error.remote.requestFailedStatus", { status: response.status });
    const code = isDynamicRecord(value) && isString(value.code) ? value.code : null;
    return yield* Effect.fail(new RemoteRequestError(response.status, message, code));
  }
  return yield* Effect.try({
    try: () => decoder(value),
    catch: (cause) => new RemoteProtocolError("protocol_error", sourceText("error.remote.unsafeData"), null, { cause }),
  });
}, Effect.scoped);

function isJsonContentType(contentType: string | null | undefined): boolean {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType === "application/json" || mimeType?.endsWith("+json") === true;
}

export function webRtcRequestBody(
  body: RequestInit["body"],
  contentType: string | undefined,
): RequestInit["body"] | TeamProtocolV2Json {
  if (!body || !isJsonContentType(contentType)) return body;
  let text: string;
  if (isString(body)) text = body;
  else if (body instanceof ArrayBuffer) text = new TextDecoder().decode(body);
  else if (ArrayBuffer.isView(body)) {
    text = new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  } else return body;
  try {
    return decodeTeamProtocolV2Json(JSON.parse(text));
  } catch {
    return body;
  }
}

export const throwRemoteResponseError = Effect.fn("RemoteHttp.responseError")(function* (
  response: Response,
  method: string,
  path: string,
) {
  const body = yield* Effect.tryPromise({
    try: () => response.clone().json(),
    catch: (cause) =>
      response.headers.get("content-type")?.toLowerCase().includes("json")
        ? new RemoteProtocolError("protocol_error", sourceText("error.remote.unsafeData"), null, { cause })
        : new RemoteRequestError(
            response.status,
            sourceText("error.remote.requestFailedStatus", { status: response.status }),
          ),
  });
  const value = yield* Effect.try({
    try: () => decodeTeamProtocolV1CurrentHttpResponse(method, path, response.status, body),
    catch: (cause) => new RemoteProtocolError("protocol_error", sourceText("error.remote.unsafeData"), null, { cause }),
  });
  if (!isDynamicRecord(value) || !isString(value.error)) {
    return yield* Effect.fail(
      new RemoteProtocolError("protocol_error", sourceText("error.remote.unsafeData"), null, {
        cause: new Error("Invalid error envelope."),
      }),
    );
  }
  return yield* Effect.fail(
    new RemoteRequestError(response.status, value.error, isString(value.code) ? value.code : null),
  );
});

class RemoteTransportError extends Schema.TaggedError<RemoteTransportError>()("RemoteTransportError", {
  cause: Schema.Defect(),
}) {}

export const remoteFetch = Effect.fn("RemoteHttp.fetch")(
  (input: string | URL, init: RequestInit = {}, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS) =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]),
        }),
      catch: (cause) => new RemoteTransportError({ cause }),
    }),
);
