import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";

export const NEAR_INTENTS_RELAY_PREFIX = "/v1/near";
const DEFAULT_UPSTREAM = "https://api.agentsonintents.com";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_WALLETS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60_000;
const UPSTREAM_TIMEOUT_MS = 160_000;
const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "x-grant-token"] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after"] as const;
const AGENT_ID = "([0-9a-f]{64})";
const PARTNER_KEY_ERROR_CODES = new Set(["invalid_api_key", "api_key_retired", "unauthorized"]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

type RelayScope = "open" | "intent" | "status" | "agent";

interface RelayRoute {
  method: "GET" | "POST";
  pattern: RegExp;
  scope: RelayScope;
}

const ROUTES: readonly RelayRoute[] = [
  { method: "POST", pattern: /^\/v1\/generate-intent$/u, scope: "intent" },
  { method: "POST", pattern: /^\/v1\/submit-intent$/u, scope: "status" },
  { method: "GET", pattern: /^\/v1\/status$/u, scope: "status" },
  { method: "GET", pattern: /^\/v1\/tokens$/u, scope: "open" },
  { method: "GET", pattern: new RegExp(`^/v1/agents/${AGENT_ID}(?:/(?:policy|balances))?$`, "u"), scope: "agent" },
  {
    method: "POST",
    pattern: new RegExp(`^/v1/agents/${AGENT_ID}/(?:deposit|transfer|withdraw)$`, "u"),
    scope: "agent",
  },
];

type RelayFetch = (input: URL, init: RequestInit) => Promise<Response>;

export type NearIntentsOwner = { kind: "server"; serverId: string } | { kind: "user"; userId: string };

export interface NearIntentsRelayConfig {
  database: D1Database;
  partnerKey: string | undefined;
  upstream: string | undefined;
  fetch?: RelayFetch;
  now?: () => number;
}

export class NearIntentsRelayError extends Schema.TaggedError<NearIntentsRelayError>()("NearIntentsRelayError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export function nearIntentsRelayErrorResponse(error: NearIntentsRelayError): Response {
  return Response.json(
    {
      errors: [
        { code: error.code, title: error.message, detail: error.message, meta: { retryable: error.status >= 500 } },
      ],
    },
    { status: error.status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

const unavailable = () =>
  new NearIntentsRelayError(503, "wallet_service_unavailable", "The crypto wallet service is not available.");
const notFound = () =>
  new NearIntentsRelayError(404, "wallet_not_found", "This wallet does not belong to this account.");

function ownerKey(owner: NearIntentsOwner): string {
  return owner.kind === "server" ? `server:${owner.serverId}` : `user:${owner.userId}`;
}

function relayIo<A>(operation: () => Promise<A>): Effect.Effect<A, NearIntentsRelayError> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => {
      console.error("near-intents: a relay step failed", cause instanceof Error ? cause.name : typeof cause);
      return unavailable();
    },
  });
}

function matchRoute(method: string, path: string): { route: RelayRoute; agentId: string | null } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) return { route, agentId: match[1] ?? null };
  }
  return null;
}

function stringField(value: unknown, key: string): string | null {
  if (!isDynamicRecord(value)) return null;
  const field = value[key];
  return isString(field) ? field : null;
}

interface JsonFacts {
  type: string | null;
  agentId: string | null;
}

function readFacts(text: string | null): JsonFacts {
  const none: JsonFacts = { type: null, agentId: null };
  if (!text) return none;
  try {
    const value = JSON.parse(text);
    if (!isDynamicRecord(value)) return none;
    return {
      type: stringField(value, "type"),
      agentId: stringField(value, "agent_id") ?? stringField(value.details, "agent_id"),
    };
  } catch {
    return none;
  }
}

function refusesPartnerKey(status: number, text: string): boolean {
  if (status !== 401 && status !== 403) return false;
  try {
    const value = JSON.parse(text);
    const errors = isDynamicRecord(value) ? value.errors : null;
    const first = Array.isArray(errors) ? errors[0] : null;
    const code = stringField(first, "code");
    return code === null || PARTNER_KEY_ERROR_CODES.has(code) || stringField(first, "layer") === "auth";
  } catch {
    return true;
  }
}

async function readLimitedText(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export class NearIntentsRelay {
  readonly #config: NearIntentsRelayConfig;
  readonly #fetch: RelayFetch;
  readonly #now: () => number;

  constructor(config: NearIntentsRelayConfig) {
    this.#config = config;
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
    this.#now = config.now ?? Date.now;
  }

  readonly handle = Effect.fn("NearIntentsRelay.handle")(function* (
    this: NearIntentsRelay,
    request: Request,
    owner: NearIntentsOwner,
  ) {
    const partnerKey = this.#config.partnerKey?.trim();
    if (!partnerKey) return yield* unavailable();
    const url = new URL(request.url);
    const path = url.pathname.slice(NEAR_INTENTS_RELAY_PREFIX.length);
    const matched = matchRoute(request.method, path);
    if (!matched) return yield* new NearIntentsRelayError(404, "not_found", "This wallet request is not available.");
    const key = ownerKey(owner);
    const body = request.method === "POST" ? yield* this.#readBody(request) : null;
    const sent = readFacts(body);
    const creates = matched.route.scope === "intent" && sent.type === "agent_create";

    if (matched.route.scope === "agent" && matched.agentId) yield* this.#requireOwned(matched.agentId, key);
    if (creates) yield* this.#requireRoom(key);
    if (matched.route.scope === "intent" && !creates) {
      if (!sent.agentId)
        return yield* new NearIntentsRelayError(400, "invalid_request", "The wallet request is not valid.");
      yield* this.#requireOwned(sent.agentId, key);
    }

    const upstream = yield* this.#send(request, path, url.search, body, partnerKey);
    const text = yield* relayIo(() => upstream.text());
    if (refusesPartnerKey(upstream.status, text)) {
      console.error("near-intents: the partner key was refused", upstream.status);
      return yield* unavailable();
    }
    const received = upstream.ok ? readFacts(text) : null;
    if (creates && received?.agentId) yield* this.#record(received.agentId, key);
    if (matched.route.scope === "status" && received?.agentId) yield* this.#requireOwned(received.agentId, key);
    return this.#response(upstream, text);
  });

  readonly #readBody = Effect.fn("NearIntentsRelay.readBody")(function* (this: NearIntentsRelay, request: Request) {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return yield* tooLarge();
    const text = yield* relayIo(() => readLimitedText(request));
    if (text === null) return yield* tooLarge();
    return text;
  });

  readonly #requireOwned = Effect.fn("NearIntentsRelay.requireOwned")(function* (
    this: NearIntentsRelay,
    agentId: string,
    key: string,
  ) {
    const row = yield* relayIo(() =>
      this.#config.database
        .prepare("SELECT owner FROM near_wallet_agents WHERE agent_id = ?")
        .bind(agentId)
        .first<{ owner: string }>(),
    );
    if (row?.owner !== key) return yield* notFound();
  });

  readonly #requireRoom = Effect.fn("NearIntentsRelay.requireRoom")(function* (this: NearIntentsRelay, key: string) {
    const row = yield* relayIo(() =>
      this.#config.database
        .prepare("SELECT COUNT(*) AS count FROM near_wallet_agents WHERE owner = ? AND created_at > ?")
        .bind(key, this.#now() - DAY_MS)
        .first<{ count: number }>(),
    );
    if ((row?.count ?? 0) >= MAX_WALLETS_PER_DAY)
      return yield* new NearIntentsRelayError(429, "wallet_limit", "Too many new wallets today. Try again tomorrow.");
  });

  readonly #record = Effect.fn("NearIntentsRelay.record")(function* (
    this: NearIntentsRelay,
    agentId: string,
    key: string,
  ) {
    const result = yield* relayIo(() =>
      this.#config.database
        .prepare(
          "INSERT INTO near_wallet_agents (agent_id, owner, created_at) VALUES (?, ?, ?) ON CONFLICT (agent_id) DO NOTHING",
        )
        .bind(agentId, key, this.#now())
        .run(),
    );
    if (result.meta.changes === 0) yield* this.#requireOwned(agentId, key);
  });

  readonly #send = Effect.fn("NearIntentsRelay.send")(function* (
    this: NearIntentsRelay,
    request: Request,
    path: string,
    search: string,
    body: string | null,
    partnerKey: string,
  ) {
    const target = new URL(`${path}${search}`, this.#config.upstream?.trim() || DEFAULT_UPSTREAM);
    const headers = new Headers({ accept: "application/json", "x-api-key": partnerKey });
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = yield* relayIo(() =>
      this.#fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      }),
    );
    if (upstream.status >= 300 && upstream.status < 400) {
      console.error("near-intents: the Agent API sent a redirect", upstream.status);
      return yield* unavailable();
    }
    return upstream;
  });

  #response(upstream: Response, text: string): Response {
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const status = upstream.status === 401 ? 403 : upstream.status;
    return new Response(NULL_BODY_STATUSES.has(status) ? null : text, { status, headers });
  }
}

function tooLarge(): NearIntentsRelayError {
  return new NearIntentsRelayError(413, "payload_too_large", "The wallet request is too large.");
}
