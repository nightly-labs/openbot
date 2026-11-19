import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Context, Effect, Layer, Schema } from "effect";
import { hexToBytes, importHmacSha256Key } from "./crypto";

const BOAT_API_URL = "https://boat.dev/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const HOSTED_SERVER_SETUP_SCRIPT = "exec /opt/OpenBot/hosted/openbot-hosted-env\n";

export type BoatSandboxType = "small" | "default" | "large";

const BoatSandboxState = Schema.Literals([
  "init",
  "provisioning",
  "provisioned",
  "cloning",
  "ready",
  "idle",
  "running",
  "archiving",
  "archived",
  "error",
  "cancelled",
]);
export type BoatSandboxState = typeof BoatSandboxState.Type;
const BoatSandbox = Schema.Struct({ id: Schema.String, state: BoatSandboxState });
const isFailingStop = Schema.is(Schema.Struct({ status: Schema.Literal("failing") }));
const BoatCommandResult = Schema.Struct({ exitCode: Schema.NullOr(Schema.Number), stdout: Schema.String });

export class BoatApiError extends Schema.TaggedError<BoatApiError>()("BoatApiError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string) {
    super({ status, code, message: `boat request failed: ${status} ${code}` });
  }
}

export type BoatFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface BoatClientOptions {
  apiKey: string;
  fetch?: BoatFetch | undefined;
  baseUrl?: string;
}

class BoatTransport extends Context.Service<
  BoatTransport,
  {
    fetch: BoatFetch;
    apiKey: string;
    baseUrl: string;
  }
>()("@openbot/auth-api/BoatTransport") {}

const boatRequest = Effect.fn("BoatClient.request")(function* (
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const transport = yield* BoatTransport;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${transport.apiKey}`,
    Accept: "application/json",
    ...options.headers,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      transport.fetch(`${transport.baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      }),
    catch: () => new BoatApiError(503, "network_error"),
  });
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: () => new BoatApiError(503, "network_error"),
  });
  const payload = text
    ? yield* Effect.try({ try: (): unknown => JSON.parse(text), catch: () => null }).pipe(
        Effect.catch(() => Effect.succeed(null)),
      )
    : null;
  if (!response.ok) {
    const code = isDynamicRecord(payload) && isString(payload.code) ? payload.code : "http_error";
    return yield* new BoatApiError(response.status, code);
  }
  return payload;
});

const parseSandbox = Effect.fn("BoatClient.decodeSandbox")((value: unknown) => {
  const sandbox = isDynamicRecord(value) && isDynamicRecord(value.sandbox) ? value.sandbox : value;
  return Schema.decodeUnknownEffect(BoatSandbox)(sandbox).pipe(
    Effect.map((decoded) => ({ ...decoded, stopFailing: isDynamicRecord(sandbox) && isFailingStop(sandbox.stop) })),
    Effect.mapError(() => new BoatApiError(502, "invalid_response")),
  );
});

export class BoatClient {
  readonly #transport: Layer.Layer<BoatTransport>;

  constructor(options: BoatClientOptions) {
    this.#transport = Layer.succeed(BoatTransport)({
      apiKey: options.apiKey,
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      baseUrl: options.baseUrl ?? BOAT_API_URL,
    });
  }

  createSandbox(input: {
    type: BoatSandboxType;
    from: string;
    env: Record<string, string>;
    ttlSeconds: number;
    idempotencyKey: string;
  }) {
    return boatRequest("POST", "/sandboxes", {
      body: {
        type: input.type,
        from: input.from,
        env: input.env,
        noEnv: true,
        ttlSeconds: input.ttlSeconds,
        setupScript: HOSTED_SERVER_SETUP_SCRIPT,
      },
      headers: { "Idempotency-Key": input.idempotencyKey },
    })
      .pipe(Effect.flatMap(parseSandbox))
      .pipe(Effect.provide(this.#transport));
  }

  getSandbox(sandboxId: string) {
    return boatRequest("GET", `/sandboxes/${encodeURIComponent(sandboxId)}`)
      .pipe(Effect.flatMap(parseSandbox))
      .pipe(Effect.provide(this.#transport));
  }

  resumeSandbox(sandboxId: string, ttlSeconds: number, type?: BoatSandboxType) {
    return boatRequest("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/resume`, {
      body: type === undefined ? { ttlSeconds } : { ttlSeconds, type },
    })
      .pipe(Effect.map((payload) => isDynamicRecord(payload) && payload.status === "running"))
      .pipe(Effect.provide(this.#transport));
  }

  runCommand(sandboxId: string, command: string, timeoutSeconds: number) {
    return boatRequest("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/commands`, {
      body: { command, timeoutSeconds },
    })
      .pipe(
        Effect.flatMap((payload) =>
          Schema.decodeUnknownEffect(BoatCommandResult)(payload).pipe(
            Effect.mapError(() => new BoatApiError(502, "invalid_response")),
          ),
        ),
      )
      .pipe(Effect.provide(this.#transport));
  }

  extendSandbox(sandboxId: string, ttlSeconds: number) {
    return boatRequest("PATCH", `/sandboxes/${encodeURIComponent(sandboxId)}`, { body: { ttlSeconds } })
      .pipe(Effect.asVoid)
      .pipe(Effect.provide(this.#transport));
  }

  renameSandbox(sandboxId: string, name: string) {
    return boatRequest("PATCH", `/sandboxes/${encodeURIComponent(sandboxId)}`, { body: { name } })
      .pipe(Effect.asVoid)
      .pipe(Effect.provide(this.#transport));
  }

  stopSandbox(sandboxId: string) {
    return boatRequest("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/stop`, { body: {} })
      .pipe(Effect.asVoid)
      .pipe(Effect.provide(this.#transport));
  }

  deleteSandbox(sandboxId: string) {
    return boatRequest("DELETE", `/sandboxes/${encodeURIComponent(sandboxId)}`, {
      headers: { "X-Ascii-Confirm-Delete": sandboxId },
    })
      .pipe(
        Effect.asVoid,
        Effect.catch((error) => (error.status === 404 ? Effect.void : Effect.fail(error))),
      )
      .pipe(Effect.provide(this.#transport));
  }
}

export const isBoatState = Schema.is(BoatSandboxState);

export const verifyBoatWebhookSignature = Effect.fn("verifyBoatWebhookSignature")(function* (input: {
  secret: string;
  deliveryId: string;
  timestamp: string;
  signature: string;
  body: string;
  now: number;
}) {
  const seconds = Number(input.timestamp);
  if (!Number.isInteger(seconds) || Math.abs(input.now - seconds * 1_000) > 5 * 60_000) return false;
  const provided = input.signature.startsWith("v1=") ? input.signature.slice(3) : "";
  if (!/^[0-9a-f]{64}$/iu.test(provided)) return false;
  const key = yield* Effect.tryPromise({
    try: () => importHmacSha256Key(input.secret, "verify"),
    catch: () => new BoatApiError(502, "signature_verification_failed"),
  });
  const bytes = hexToBytes(provided);
  return yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.verify(
        "HMAC",
        key,
        bytes,
        new TextEncoder().encode(`${input.deliveryId}.${input.timestamp}.${input.body}`),
      ),
    catch: () => new BoatApiError(502, "signature_verification_failed"),
  });
});
