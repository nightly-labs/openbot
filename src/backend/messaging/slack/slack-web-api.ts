import { open, rm } from "node:fs/promises";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { MessagingAdapterError, MessagingConnectionError } from "../messaging-types";

const SLACK_API_ORIGIN = "https://slack.com";

/** Slack's error codes that mean the token no longer works. */
const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"]);
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_NOTICE_MS = 5_000;
const REDIRECT_LIMIT = 3;

const SlackEnvelope = Schema.Record(Schema.String, Schema.Unknown);
type SlackResponse = typeof SlackEnvelope.Type & { ok: true };

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
  }
}

export interface SlackWebApiOptions {
  token: string;
  /** Only tests change this. The token is never sent to another origin. */
  origin?: string | undefined;
  rateLimited?(retryAt: string): void;
  /** Waits between rate-limit retries. Only tests replace it. */
  delay?(milliseconds: number): Promise<void>;
}

/**
 * The Slack Web API over `fetch`, with one token. A form-encoded body works for every method, so
 * each call uses it and sends a nested value as JSON text. Nothing here logs a request or a response:
 * both carry message text, and a failure names only the method and Slack's error code.
 */
export class SlackWebApi {
  readonly #token: string;
  readonly #origin: string;
  readonly #rateLimited: (retryAt: string) => void;
  readonly #delay: ((milliseconds: number) => Promise<void>) | undefined;

  constructor(options: SlackWebApiOptions) {
    this.#token = options.token;
    this.#origin = options.origin ?? SLACK_API_ORIGIN;
    this.#rateLimited = options.rateLimited ?? (() => undefined);
    this.#delay = options.delay;
  }

  readonly call = Effect.fnUntraced(function* (this: SlackWebApi, method: string, params: DynamicRecord = {}) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      body.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const { payload } = yield* this.#send(method, body);
    return payload;
  });

  readonly upload = Effect.fnUntraced(function* (
    this: SlackWebApi,
    method: string,
    params: Record<string, string>,
    file: { field: string; name: string; type: string; bytes: Uint8Array },
  ) {
    const body = new FormData();
    for (const [key, value] of Object.entries(params)) body.set(key, value);
    body.set(file.field, new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    return yield* slackRequest(
      `${this.#origin}/api/${method}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.#token}` },
        body,
        redirect: "error",
      },
      (response) => slackPayload(method, response),
    );
  });

  readonly authTest = Effect.fnUntraced(function* (this: SlackWebApi) {
    const { payload, response } = yield* this.#send("auth.test", new URLSearchParams());
    const scopes = (response.headers.get("x-oauth-scopes") ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    return { payload, scopes };
  });

  readonly #send = Effect.fnUntraced(function* (this: SlackWebApi, method: string, body: URLSearchParams) {
    for (let attempt = 0; ; attempt += 1) {
      const result = yield* slackRequest(
        `${this.#origin}/api/${method}`,
        {
          method: "POST",
          headers: {
            ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
            "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          },
          body,
          redirect: "error",
        },
        (response) =>
          Effect.gen(function* () {
            if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
              const waitMs = Math.max(1, Number(response.headers.get("retry-after") ?? "1")) * 1000;
              yield* slackIo(async () => {
                await response.body?.cancel();
              });
              return { retry: true as const, waitMs };
            }
            const payload = yield* slackPayload(method, response);
            return { retry: false as const, payload, response };
          }),
      );
      if (!result.retry) return { payload: result.payload, response: result.response };
      if (result.waitMs > RATE_LIMIT_NOTICE_MS) this.#rateLimited(new Date(Date.now() + result.waitMs).toISOString());
      const delay = this.#delay;
      yield* delay ? slackIo(() => delay(result.waitMs)) : Effect.sleep(result.waitMs);
    }
  });

  readonly uploadBytes = Effect.fnUntraced(function* (
    this: SlackWebApi,
    uploadUrl: string,
    bytes: Uint8Array,
    mimeType: string,
  ) {
    if (!this.#trusted(uploadUrl))
      return yield* slackFailure(new SlackApiError("files.upload", "untrusted_upload_url"));
    yield* slackRequest(
      uploadUrl,
      {
        method: "POST",
        headers: { "content-type": mimeType || "application/octet-stream" },
        body: new Uint8Array(bytes),
        redirect: "error",
      },
      (response) =>
        Effect.gen(function* () {
          yield* slackIo(async () => {
            await response.body?.cancel();
          });
          if (!response.ok) return yield* slackFailure(new SlackApiError("files.upload", `http_${response.status}`));
        }),
    );
  });

  readonly download = Effect.fnUntraced(function* (
    this: SlackWebApi,
    url: string,
    destination: string,
    maxBytes: number,
  ) {
    let current = url;
    for (let redirects = 0; ; redirects += 1) {
      if (!this.#trusted(current))
        return yield* slackFailure(new SlackApiError("files.download", "untrusted_file_url"));
      const next = yield* slackRequest(
        current,
        {
          headers: { authorization: `Bearer ${this.#token}` },
          redirect: "manual",
        },
        (response) =>
          Effect.gen(function* () {
            if (response.status >= 300 && response.status < 400) {
              yield* slackIo(async () => {
                await response.body?.cancel();
              });
              const location = response.headers.get("location");
              if (!location || redirects >= REDIRECT_LIMIT)
                return yield* slackFailure(new SlackApiError("files.download", "redirect"));
              return new URL(location, current).toString();
            }
            if (!response.ok || !response.body)
              return yield* slackFailure(new SlackApiError("files.download", `http_${response.status}`));
            if (Number(response.headers.get("content-length") ?? "0") > maxBytes)
              return yield* slackFailure(new SlackApiError("files.download", "too_large"));
            const reader = response.body.getReader();
            let opened = false;
            yield* Effect.acquireUseRelease(
              Effect.succeed(reader),
              () =>
                Effect.acquireUseRelease(
                  slackIo(() => open(destination, "w", 0o600)).pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        opened = true;
                      }),
                    ),
                  ),
                  (file) =>
                    Effect.gen(function* () {
                      let received = 0;
                      for (;;) {
                        const { done, value } = yield* slackIo(() => reader.read());
                        if (done) return;
                        received += value.byteLength;
                        if (received > maxBytes)
                          return yield* slackFailure(new SlackApiError("files.download", "too_large"));
                        yield* slackIo(() => file.write(value));
                      }
                    }),
                  (file) => Effect.promise(() => file.close()),
                ).pipe(
                  Effect.onError(() =>
                    opened ? slackIo(() => rm(destination, { force: true })).pipe(Effect.orDie) : Effect.void,
                  ),
                ),
              () => slackIo(() => reader.cancel()).pipe(Effect.catch(() => Effect.void)),
            );
            return null;
          }),
      );
      if (next === null) return;
      current = next;
    }
  });

  /** A Slack https host, or the test origin this client was built for. */
  #trusted(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (this.#origin !== SLACK_API_ORIGIN) return url.origin === new URL(this.#origin).origin;
    return url.protocol === "https:" && (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"));
  }
}

// These operations deliberately have no tracing span: provider payloads and URLs can contain secrets.
function slackIo<A>(run: () => Promise<A>): Effect.Effect<A, MessagingAdapterError> {
  return Effect.tryPromise({ try: run, catch: (cause) => new MessagingAdapterError({ cause }) });
}

function slackFailure(cause: Error): Effect.Effect<never, MessagingAdapterError> {
  return Effect.fail(new MessagingAdapterError({ cause }));
}

const slackPayload = Effect.fnUntraced(function* (
  method: string,
  response: Response,
): Effect.fn.Return<SlackResponse, MessagingAdapterError> {
  const payload = yield* slackIo((): Promise<unknown> => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(SlackEnvelope)),
    Effect.mapError(() => new MessagingAdapterError({ cause: new SlackApiError(method, `http_${response.status}`) })),
  );
  if (payload.ok !== true) {
    const code = isString(payload.error) ? payload.error : `http_${response.status}`;
    return yield* slackFailure(
      AUTH_ERRORS.has(code) ? new MessagingConnectionError("invalid_token") : new SlackApiError(method, code),
    );
  }
  return { ...payload, ok: true as const };
});

function slackRequest<A>(
  url: string,
  init: RequestInit,
  use: (response: Response) => Effect.Effect<A, MessagingAdapterError>,
): Effect.Effect<A, MessagingAdapterError> {
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) => slackIo(() => fetch(url, { ...init, signal: controller.signal })).pipe(Effect.flatMap(use)),
    (controller) => Effect.sync(() => controller.abort()),
  );
}
