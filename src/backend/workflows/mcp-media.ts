/**
 * The parts that the media services of the canvas share when they make a file with the tools of an
 * MCP server, on a sign-in that the user made in Apps: the connection with one retry on a new token,
 * the tool calls, the upload of an input picture and the download of the result. Sunra
 * (`sunra-media.ts`) and Higgsfield (`higgsfield-media.ts`) own their tools and their words.
 */

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import type { WorkflowMediaKind } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { type Duration, Effect, Schema } from "effect";
import { readLimitedBody } from "../limited-body";
import { secureOAuthFetch } from "../mcp-oauth-provider";
import { hostAddresses, isPublicAddress, systemAddressLookup } from "../network-address";

/** The sign-in of a media service row: its address and its OAuth token. Never logged. */
export interface McpMediaSignIn {
  url: string;
  token: () => Effect.Effect<string | null, unknown>;
  /** A new token after the service refused `rejected`, or null. */
  refresh: (rejected: string) => Effect.Effect<string | null, unknown>;
}

/** What a media service needs from the host: its sign-in, the input pictures, and Storage. */
export interface McpMediaDependencies {
  signIn: () => McpMediaSignIn | null;
  resolveAttachment: (attachmentId: string) => Effect.Effect<{ path: string; mimeType: string } | null, unknown>;
  store: (input: {
    bytes: Uint8Array;
    kind: WorkflowMediaKind;
    name: string;
    mimeType: string;
  }) => Effect.Effect<{ id: string }, unknown>;
}

/** A failure whose `message` the user reads. It never holds a token. */
export class McpMediaFailed extends Schema.TaggedError<McpMediaFailed>()("McpMediaFailed", {
  message: Schema.String,
}) {}

export const mediaFail = (message: string) => new McpMediaFailed({ message });
export const mediaFailed = () => mediaFail(sourceText("error.workflow.mediaFailed"));

/** Finds the file of each input picture. A missing file or a file that is not a picture fails the step. */
export const resolveMediaInputs = Effect.fnUntraced(function* <Role>(
  dependencies: McpMediaDependencies,
  images: readonly { role: Role; attachmentId: string }[],
) {
  const files: { role: Role; path: string; mimeType: string }[] = [];
  for (const image of images) {
    const file = yield* dependencies
      .resolveAttachment(image.attachmentId)
      .pipe(Effect.mapError(() => mediaFail(sourceText("error.workflow.mediaInputMissing"))));
    if (!file) return yield* mediaFail(sourceText("error.workflow.mediaInputMissing"));
    if (!file.mimeType.startsWith("image/")) return yield* mediaFail(sourceText("error.workflow.mediaInputNotImage"));
    files.push({ role: image.role, ...file });
  }
  return files;
});

/** The longest reason from a service that an error quotes. */
const REASON_LIMIT = 300;
/** How many redirects the download of a file follows, each on the service's file hosts. */
const DOWNLOAD_REDIRECTS = 3;

/** The reason that the service gave, short and on one line, or null. */
export function mediaReason(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (!text) return null;
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT - 1)}…` : text;
}

export const mediaText = (value: unknown) => (typeof value === "string" && value ? value : null);

const unauthorized = (cause: unknown) =>
  cause instanceof UnauthorizedError || (cause instanceof StreamableHTTPError && cause.code === 401);

/**
 * The SDK transport behind the SDK's own `Transport` type. The SDK class declares `sessionId` and its
 * callbacks without `undefined`, so `exactOptionalPropertyTypes` refuses the class itself.
 */
function forwardingTransport(inner: StreamableHTTPClientTransport): Transport {
  const transport: Transport = {
    start: () => inner.start(),
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion(version),
  };
  inner.onclose = () => transport.onclose?.();
  inner.onerror = (error) => transport.onerror?.(error);
  inner.onmessage = (message) => transport.onmessage?.(message);
  return transport;
}

/** A Client on the service's server with one token, closed when the scope ends. */
function connect(url: string, token: string) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async (signal) => {
        const client = new Client({ name: "openbot", version: "1" }, { capabilities: {} });
        const transport = new StreamableHTTPClientTransport(new URL(url), {
          fetch: secureOAuthFetch({ resource: url, mcpTraffic: true }),
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        await client.connect(forwardingTransport(transport), { signal });
        return client;
      },
      catch: (cause) => cause,
    }),
    (client) => Effect.promise(() => client.close().catch(() => undefined)),
  );
}

/** Connects with the current token, and once more with a new one when the service refuses it. */
export const connectSignedIn = Effect.fnUntraced(function* (signIn: McpMediaSignIn, notSignedIn: () => McpMediaFailed) {
  const token = yield* signIn.token().pipe(Effect.mapError(notSignedIn));
  if (!token) return yield* notSignedIn();
  return yield* connect(signIn.url, token).pipe(
    Effect.catch((cause) =>
      unauthorized(cause)
        ? signIn.refresh(token).pipe(
            Effect.mapError(notSignedIn),
            Effect.flatMap((next) =>
              next ? connect(signIn.url, next).pipe(Effect.mapError(notSignedIn)) : Effect.fail(notSignedIn()),
            ),
          )
        : Effect.fail(mediaFailed()),
    ),
  );
});

/**
 * The value of a tool result: its structured content, else the JSON of its first text block. An
 * `isError` result answers its reason: `error_hint`, `message` or `error`, else its text.
 */
function toolValue(result: unknown): { value: DynamicRecord | null; error: string | null } {
  if (!isDynamicRecord(result)) return { value: null, error: null };
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find(
    (block): block is { type: "text"; text: string } =>
      isDynamicRecord(block) && block.type === "text" && typeof block.text === "string",
  )?.text;
  const parsed = (() => {
    if (isDynamicRecord(result.structuredContent)) return result.structuredContent;
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      return isDynamicRecord(value) ? value : null;
    } catch {
      return null;
    }
  })();
  if (result.isError === true) {
    const reason = parsed ? (parsed.error_hint ?? parsed.message ?? parsed.error) : text;
    return { value: null, error: mediaReason(reason) ?? "" };
  }
  return { value: parsed, error: null };
}

/** One value in the arguments of a tool call. An absent value is left out of the JSON. */
type McpToolValue =
  | string
  | number
  | boolean
  | undefined
  | readonly McpToolValue[]
  | { readonly [name: string]: McpToolValue };

/** The arguments of one tool call. */
export interface McpToolArguments {
  readonly [name: string]: McpToolValue;
}

/** How one service's tool calls end: the time limit and the error for a refusal. */
export interface McpMediaTools {
  timeoutMs: number;
  /** The error for a refused call, from the service's reason, or null when it gave none. */
  refusal: (reason: string | null) => McpMediaFailed;
}

/** Calls one tool. A refused call fails with `tools.refusal`; a call with no value fails. */
export const callMediaTool = (client: Client, tools: McpMediaTools, name: string, args: McpToolArguments) =>
  Effect.tryPromise({
    try: (signal) => client.callTool({ name, arguments: { ...args } }, undefined, { signal, timeout: tools.timeoutMs }),
    catch: () => mediaFailed(),
  }).pipe(
    Effect.flatMap((result) => {
      const { value, error } = toolValue(result);
      if (error !== null) return Effect.fail(tools.refusal(error || null));
      return value ? Effect.succeed(value) : Effect.fail(mediaFailed());
    }),
  );

export function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Sends one input picture to the upload address that the service chose. The address must not point at
 * this computer or its local network, and a redirect is refused.
 */
export const uploadToService = Effect.fnUntraced(function* (
  target: { url: string; method: string; headers: Readonly<Record<string, string>>; body: Uint8Array<ArrayBuffer> },
  deadline: Duration.Input,
  timedOut: () => McpMediaFailed,
) {
  if (!isHttps(target.url)) return yield* mediaFailed();
  const addresses = yield* hostAddresses(new URL(target.url), systemAddressLookup).pipe(
    Effect.mapError(() => mediaFailed()),
  );
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) return yield* mediaFailed();
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(target.url, {
        method: target.method,
        headers: { ...target.headers },
        body: target.body,
        signal,
        redirect: "error",
      }),
    catch: () => mediaFailed(),
  }).pipe(Effect.timeoutOrElse({ duration: deadline, orElse: () => Effect.fail(timedOut()) }));
  yield* Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
  if (!response.ok) return yield* mediaFailed();
});

const MEDIA_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** The file type of an input picture, for the file name that a service asks for. */
export const pictureExtension = (mimeType: string) => MEDIA_TYPES[mimeType] ?? mimeType.split("/")[1] ?? "png";

/**
 * Downloads a result, with the size limit of a stored attachment. Each hop must be on the service's
 * file hosts (`allowed`) before OpenBot asks for it, so a redirect is followed here.
 */
export const downloadMedia = Effect.fnUntraced(function* (
  url: string,
  kind: WorkflowMediaKind,
  options: { allowed: (url: string) => boolean; deadline: Duration.Input; timedOut: () => McpMediaFailed },
) {
  const tooLarge = () =>
    mediaFail(
      sourceText(kind === "video" ? "error.backend.generatedVideoTooLarge" : "error.backend.generatedImageTooLarge"),
    );
  const { response, bytes } = yield* Effect.gen(function* () {
    let address = url;
    let response: Response | null = null;
    for (let hop = 0; hop <= DOWNLOAD_REDIRECTS; hop += 1) {
      if (!isHttps(address) || !options.allowed(address)) return yield* mediaFailed();
      const next = address;
      const answer = yield* Effect.tryPromise({
        try: (signal) => fetch(next, { signal, redirect: "manual" }),
        catch: () => mediaFailed(),
      });
      const location = answer.status >= 300 && answer.status < 400 ? answer.headers.get("location") : null;
      if (!location) {
        response = answer;
        break;
      }
      yield* Effect.promise(() => answer.body?.cancel().catch(() => undefined) ?? Promise.resolve());
      address = URL.canParse(location, next) ? new URL(location, next).href : "";
    }
    if (!response?.ok) return yield* mediaFailed();
    const bytes = yield* readLimitedBody(response, ATTACHMENT_LIMITS.fileBytes, (reason) =>
      reason === "too-large" ? tooLarge() : mediaFailed(),
    );
    return { response, bytes: new Uint8Array(bytes) };
  }).pipe(Effect.timeoutOrElse({ duration: options.deadline, orElse: () => Effect.fail(options.timedOut()) }));
  if (bytes.byteLength === 0) return yield* mediaFailed();
  const header = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeType = MEDIA_TYPES[header] ? header : kind === "video" ? "video/mp4" : "image/png";
  return { bytes, mimeType, extension: MEDIA_TYPES[mimeType] ?? (kind === "video" ? "mp4" : "png") };
});

/** A count of credits: a finite number that is not negative, rounded down. */
export function creditCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
