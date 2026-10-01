import { open, rm } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { MessagingConnectionError } from "../messaging-types";

const SLACK_API_ORIGIN = "https://slack.com";

/** Slack's error codes that mean the token no longer works. */
const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"]);
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_NOTICE_MS = 5_000;
const REDIRECT_LIMIT = 3;

export type SlackResponse = DynamicRecord & { ok: true };

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
  readonly #delay: (milliseconds: number) => Promise<void>;

  constructor(options: SlackWebApiOptions) {
    this.#token = options.token;
    this.#origin = options.origin ?? SLACK_API_ORIGIN;
    this.#rateLimited = options.rateLimited ?? (() => undefined);
    this.#delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async call(method: string, params: DynamicRecord = {}): Promise<SlackResponse> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      body.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const { payload } = await this.#send(method, body);
    return payload;
  }

  /** A method that takes a file, such as `apps.icon.set`, as a multipart form. */
  async upload(
    method: string,
    params: Record<string, string>,
    file: { field: string; name: string; type: string; bytes: Uint8Array },
  ): Promise<SlackResponse> {
    const body = new FormData();
    for (const [key, value] of Object.entries(params)) body.set(key, value);
    body.set(file.field, new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    const response = await fetch(`${this.#origin}/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#token}` },
      body,
      redirect: "error",
    });
    const payload = await response.json().catch(() => null);
    if (!isDynamicRecord(payload)) throw new SlackApiError(method, `http_${response.status}`);
    if (payload.ok !== true) {
      const code = isString(payload.error) ? payload.error : `http_${response.status}`;
      if (AUTH_ERRORS.has(code)) throw new MessagingConnectionError("invalid_token");
      throw new SlackApiError(method, code);
    }
    return { ...payload, ok: true };
  }

  /** `auth.test` with the granted scopes, which Slack sends only as a response header. */
  async authTest(): Promise<{ payload: SlackResponse; scopes: string[] }> {
    const { payload, response } = await this.#send("auth.test", new URLSearchParams());
    const scopes = (response.headers.get("x-oauth-scopes") ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    return { payload, scopes };
  }

  async #send(method: string, body: URLSearchParams): Promise<{ payload: SlackResponse; response: Response }> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${this.#origin}/api/${method}`, {
        method: "POST",
        headers: {
          // `oauth.v2.access` has no token: the client id and secret are in the body.
          ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body,
        redirect: "error",
      });
      if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const waitMs = Math.max(1, Number(response.headers.get("retry-after") ?? "1")) * 1000;
        if (waitMs > RATE_LIMIT_NOTICE_MS) this.#rateLimited(new Date(Date.now() + waitMs).toISOString());
        await response.body?.cancel();
        await this.#delay(waitMs);
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (!isDynamicRecord(payload)) throw new SlackApiError(method, `http_${response.status}`);
      if (payload.ok !== true) {
        const code = isString(payload.error) ? payload.error : `http_${response.status}`;
        if (AUTH_ERRORS.has(code)) throw new MessagingConnectionError("invalid_token");
        throw new SlackApiError(method, code);
      }
      return { payload: { ...payload, ok: true }, response };
    }
  }

  /** Uploads bytes to the URL that `files.getUploadURLExternal` gave. It must be a Slack URL. */
  async uploadBytes(uploadUrl: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    if (!this.#trusted(uploadUrl)) throw new SlackApiError("files.upload", "untrusted_upload_url");
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "content-type": mimeType || "application/octet-stream" },
      body: new Uint8Array(bytes),
      redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new SlackApiError("files.upload", `http_${response.status}`);
  }

  /**
   * Downloads a private Slack file to `destination`. The token goes only to Slack's own https hosts,
   * a redirect is followed only to another of them, and the body is cut off at `maxBytes`.
   */
  async download(url: string, destination: string, maxBytes: number): Promise<void> {
    let current = url;
    for (let redirects = 0; ; redirects += 1) {
      if (!this.#trusted(current)) throw new SlackApiError("files.download", "untrusted_file_url");
      const response = await fetch(current, {
        headers: { authorization: `Bearer ${this.#token}` },
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects >= REDIRECT_LIMIT) throw new SlackApiError("files.download", "redirect");
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new SlackApiError("files.download", `http_${response.status}`);
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        await response.body.cancel();
        throw new SlackApiError("files.download", "too_large");
      }
      const reader = response.body.getReader();
      const file = await open(destination, "w", 0o600);
      let received = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) throw new SlackApiError("files.download", "too_large");
          await file.write(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        await file.close();
        await rm(destination, { force: true });
        throw error;
      }
      await file.close();
      return;
    }
  }

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
