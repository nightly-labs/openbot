// Putting one Team API call on the wire, and reading what came back off it.
//
// HTTP uses the adapter for the negotiated protocol: V6 adds Cursor and Cline, V5 adds Gemini and
// custom ACP agents, V4 adds OpenCode, V3 adds duplication, and V1 serves older hosts. The WebRTC
// transport retains its released V2 framing.
//
// Nothing here knows a server exists. It takes a URL, a token and a protocol number, and it either
// returns a decoded value or throws one of `remote-server-errors.ts`. Deciding what a throw means for
// the user is `remote-server-connection-status.ts`; deciding which server to ask is the caller's.

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { decodeTeamProtocolV1CurrentHttpResponse } from "@openbot/contracts/team-protocol/v1-adapter";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import type { ResponseDecoder } from "./remote-host-decoding";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";

export const REMOTE_REQUEST_TIMEOUT_MS = 15_000;

export interface RemoteJsonRequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  protocol?: number;
  appVersion?: string;
  capabilities?: readonly TeamCurrentCapability[];
  preserveSemanticTags?: boolean;
  agentCreateModel?: boolean;
  timeoutMs?: number;
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
        ...(options.capabilities ? { [TEAM_CAPABILITIES_HEADER]: options.capabilities.join(",") } : {}),
      },
      body:
        options.body === undefined
          ? undefined
          : sideRoute
            ? JSON.stringify(sideRoute.request(path, options.body))
            : codec.encodeRequest(method, path, options.body, {
                preserveSemanticTags: options.preserveSemanticTags,
                agentCreateModel: options.agentCreateModel,
              }),
    },
    options.timeoutMs,
  );
  let value: unknown;
  if (response.status !== 204) {
    const decoded = yield* Effect.result(
      Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new RemoteProtocolError("protocol_error", sourceText("error.remote.invalidData"), null, { cause }),
      }),
    );
    if (Result.isFailure(decoded)) {
      if (response.ok) return yield* Effect.fail(decoded.failure);
    } else value = decoded.success;
  }
  if (value !== undefined) {
    const input = value;
    value = yield* Effect.try({
      try: () =>
        sideRoute
          ? sideRoute.response(path, response.status, input)
          : codec.decodeResponse(method, path, response.status, input),
      catch: (cause) =>
        new RemoteProtocolError("protocol_error", sourceText("error.remote.unsafeData"), null, { cause }),
    });
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

export function webRtcRequestBody(
  body: RequestInit["body"],
  contentType: string | undefined,
): RequestInit["body"] | TeamProtocolV2Json {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!body || (mimeType !== "application/json" && !mimeType?.endsWith("+json"))) return body;
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

// The `!response.ok` half of a raw fetch, split out so the authenticated fetch in the manager and
// `requestJson` above agree on what a failing host response means. A host that answers with a JSON
// error envelope produces a `RemoteRequestError` carrying its own message and code; a host that
// claims JSON and does not send it is a protocol failure, not a request failure.
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
