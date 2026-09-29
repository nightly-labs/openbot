import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

const BOAT_API_URL = "https://boat.dev/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * boat gives the sandbox `env` to its tool environment and to the create-time setup script, not to
 * systemd. The template's helper copies the two hosted variables to a file that the OpenBot service
 * waits for. See `scripts/hosting/openbot-hosted-env`.
 */
const HOSTED_SERVER_SETUP_SCRIPT = "exec /opt/OpenBot/hosted/openbot-hosted-env\n";

export type BoatSandboxType = "small" | "default" | "large";

export type BoatSandboxState =
  | "init"
  | "provisioning"
  | "provisioned"
  | "cloning"
  | "ready"
  | "idle"
  | "running"
  | "archiving"
  | "archived"
  | "error"
  | "cancelled";

const BOAT_STATES: readonly BoatSandboxState[] = [
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
];

export interface BoatSandbox {
  id: string;
  state: BoatSandboxState;
}

/** A boat failure with its status and code. The provider message is not kept: it can name internal data. */
export class BoatApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`boat request failed: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

export type BoatFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface BoatClientOptions {
  apiKey: string;
  fetch?: BoatFetch | undefined;
  baseUrl?: string;
}

export class BoatClient {
  readonly #apiKey: string;
  readonly #fetch: BoatFetch;
  readonly #baseUrl: string;

  constructor(options: BoatClientOptions) {
    this.#apiKey = options.apiKey;
    // workerd throws `Illegal invocation` when global fetch runs with this object as its receiver.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#baseUrl = options.baseUrl ?? BOAT_API_URL;
  }

  async createSandbox(input: {
    type: BoatSandboxType;
    from: string;
    env: Record<string, string>;
    ttlSeconds: number;
    idempotencyKey: string;
  }): Promise<BoatSandbox> {
    const body = await this.#request("POST", "/sandboxes", {
      body: {
        type: input.type,
        from: input.from,
        env: input.env,
        noEnv: true,
        ttlSeconds: input.ttlSeconds,
        setupScript: HOSTED_SERVER_SETUP_SCRIPT,
      },
      headers: { "Idempotency-Key": input.idempotencyKey },
    });
    return parseSandbox(body);
  }

  async getSandbox(sandboxId: string): Promise<BoatSandbox> {
    return parseSandbox(await this.#request("GET", `/sandboxes/${encodeURIComponent(sandboxId)}`));
  }

  /**
   * Resumes an archived sandbox. With a type, boat restores the disk on a machine of that size. boat
   * refuses a smaller machine that cannot hold the data (`409 type_too_small`) and keeps the sandbox.
   * boat stops the sandbox again `ttlSeconds` after the resume.
   */
  async resumeSandbox(sandboxId: string, ttlSeconds: number, type?: BoatSandboxType): Promise<void> {
    await this.#request("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/resume`, {
      body: type === undefined ? { ttlSeconds } : { ttlSeconds, type },
    });
  }

  /** boat stops the sandbox `ttlSeconds` from now, in place of its earlier stop time. */
  async extendSandbox(sandboxId: string, ttlSeconds: number): Promise<void> {
    await this.#request("PATCH", `/sandboxes/${encodeURIComponent(sandboxId)}`, { body: { ttlSeconds } });
  }

  /** Sets the name that the boat dashboard shows. It is not an address and does not need to be unique. */
  async renameSandbox(sandboxId: string, name: string): Promise<void> {
    await this.#request("PATCH", `/sandboxes/${encodeURIComponent(sandboxId)}`, { body: { name } });
  }

  /**
   * Stops and archives the sandbox. boat saves the disk first and keeps the sandbox for a resume. When
   * that save fails, boat refuses the stop and the sandbox keeps running. This never forces a stop.
   */
  async stopSandbox(sandboxId: string): Promise<void> {
    await this.#request("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/stop`, { body: {} });
  }

  /** Deletes the sandbox and its data. A sandbox that is already gone counts as deleted. */
  async deleteSandbox(sandboxId: string): Promise<void> {
    try {
      await this.#request("DELETE", `/sandboxes/${encodeURIComponent(sandboxId)}`, {
        headers: { "X-Ascii-Confirm-Delete": sandboxId },
      });
    } catch (error) {
      if (error instanceof BoatApiError && error.status === 404) return;
      throw error;
    }
  }

  async #request(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BoatApiError(503, "network_error");
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const code = isDynamicRecord(payload) && isString(payload.code) ? payload.code : "http_error";
      throw new BoatApiError(response.status, code);
    }
    return payload;
  }
}

function parseSandbox(value: unknown): BoatSandbox {
  const record = isDynamicRecord(value) && isDynamicRecord(value.sandbox) ? value.sandbox : value;
  if (!isDynamicRecord(record) || !isString(record.id) || !isBoatState(record.state)) {
    throw new BoatApiError(502, "invalid_response");
  }
  return { id: record.id, state: record.state };
}

export function isBoatState(value: unknown): value is BoatSandboxState {
  return BOAT_STATES.some((state) => state === value);
}

/** Checks a boat webhook signature: hex HMAC-SHA256 of `delivery.timestamp.body`. */
export async function verifyBoatWebhookSignature(input: {
  secret: string;
  deliveryId: string;
  timestamp: string;
  signature: string;
  body: string;
  now: number;
}): Promise<boolean> {
  const seconds = Number(input.timestamp);
  if (!Number.isInteger(seconds) || Math.abs(input.now - seconds * 1_000) > 5 * 60_000) return false;
  const provided = input.signature.startsWith("v1=") ? input.signature.slice(3) : "";
  if (!/^[0-9a-f]{64}$/iu.test(provided)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1)
    bytes[index] = Number.parseInt(provided.slice(index * 2, index * 2 + 2), 16);
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(`${input.deliveryId}.${input.timestamp}.${input.body}`),
  );
}
