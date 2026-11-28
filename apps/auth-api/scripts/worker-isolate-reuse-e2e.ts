import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ACCOUNT_BOOKMARK_HEADER } from "@openbot/contracts/account-bookmark";
import { plugin } from "bun";
import { Schema } from "effect";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", process.env.WORKER_ISOLATE_REUSE_REPORT ?? "worker-isolate-reuse-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const API = "https://account.openbot.test";
const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = "account-session-token-0001";
const MACHINE_TOKEN = "host-machine-token-0001";
const SESSION = "remote-session-1";
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/iu;
const AUTH_SQL = /\b(auth_sessions|users)\b/u;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

type Instance = "primary" | "replica";
interface Query {
  instance: Instance;
  write: boolean;
  batch: number | null;
  sql: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function bookmarkAt(version: number): string {
  return `${version.toString(16).padStart(8, "0")}-00000000-00000000-${"0".repeat(32)}`;
}

function versionOf(bookmark: string): number {
  return Number.parseInt(bookmark.slice(0, 8), 16);
}

function sqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new Error("Invalid binding");
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  return database;
}

class World {
  readonly primary = migratedDatabase();
  readonly replica = migratedDatabase();
  primaryVersion = 1;
  replicaVersion = 1;
  batches = 0;
  activeBatch: number | null = null;
  readonly queries: Query[] = [];

  both(sql: string, ...values: SQLInputValue[]): void {
    this.primary.prepare(sql).run(...values);
    this.replica.prepare(sql).run(...values);
  }

  primaryOnly(sql: string, ...values: SQLInputValue[]): void {
    this.primary.prepare(sql).run(...values);
    this.primaryVersion += 1;
  }

  replicaOnly(sql: string, ...values: SQLInputValue[]): void {
    this.replica.prepare(sql).run(...values);
  }
}

let world = new World();

function statement(
  sql: string,
  values: SQLInputValue[],
  pick: (write: boolean) => Instance,
  advance: (instance: Instance) => void,
): D1PreparedStatement {
  const execute = async <T>(call: (prepared: D1PreparedStatement) => Promise<T>): Promise<T> => {
    const write = WRITE_SQL.test(sql);
    const instance = pick(write);
    world.queries.push({
      instance,
      write,
      batch: world.activeBatch,
      sql: sql.trim().replace(/\s+/gu, " ").slice(0, 70),
    });
    const result = await call(
      sqliteD1(instance === "primary" ? world.primary : world.replica)
        .prepare(sql)
        .bind(...values),
    );
    if (write) world.primaryVersion += 1;
    advance(instance);
    return result;
  };
  return {
    bind: (...input: unknown[]) => statement(sql, input.map(sqlValue), pick, advance),
    first<T>(column?: string): Promise<T | null> {
      return execute((prepared) => (column === undefined ? prepared.first<T>() : prepared.first<T>(column)));
    },
    all: <T>() => execute((prepared) => prepared.all<T>()),
    run: <T>() => execute((prepared) => prepared.run<T>()),
    raw: () => {
      throw new Error("Unused raw");
    },
  };
}

async function batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
  world.batches += 1;
  world.activeBatch = world.batches;
  const results: D1Result<T>[] = [];
  try {
    for (const entry of statements) results.push(await entry.all<T>());
  } finally {
    world.activeBatch = null;
  }
  return results;
}

function session(constraint: string): D1DatabaseSession {
  let bookmark: string | null = constraint.startsWith("first-") ? null : constraint;
  const pick = (write: boolean): Instance => {
    if (write || constraint === "first-primary") return "primary";
    if (bookmark === null) return "replica";
    return world.replicaVersion >= versionOf(bookmark) ? "replica" : "primary";
  };
  const advance = (instance: Instance) => {
    const reached = bookmarkAt(instance === "primary" ? world.primaryVersion : world.replicaVersion);
    if (bookmark === null || reached > bookmark) bookmark = reached;
  };
  return {
    prepare: (sql) => statement(sql, [], pick, advance),
    batch,
    getBookmark: () => bookmark,
  };
}

const DB: D1Database = {
  prepare: (sql) =>
    statement(
      sql,
      [],
      () => "primary",
      () => undefined,
    ),
  batch,
  exec: () => Promise.reject(new Error("Unused")),
  withSession: (constraint) => session(constraint ?? "first-unconstrained"),
  dump: () => Promise.reject(new Error("Unused")),
};

const bucket = {
  get: async () => null,
  put: async () => null,
  delete: async () => undefined,
};
const limiter = { limit: async () => ({ success: true }) };
const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", keyPair.privateKey)), kid: "ticket-1" });
const publicJwks = JSON.stringify({
  keys: [{ ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "ticket-1" }],
});
const env = {
  DB,
  AVATARS: bucket,
  SKILLS: bucket,
  SITES: bucket,
  MARKETPLACE_INGRESS_RATE_LIMITER: limiter,
  MARKETPLACE_MUTATION_RATE_LIMITER: limiter,
  MARKETPLACE_UPLOAD_RATE_LIMITER: limiter,
  SITE_REPORT_RATE_LIMITER: limiter,
  GITHUB_TOKEN_RATE_LIMITER: limiter,
  AUTH_EXPOSE_DEVELOPMENT_CODE: "true",
  STRIPE_SECRET_KEY: "sk_test_isolate_reuse",
  REMOTE_SIGNAL_URL: "wss://signal.openbot.test",
  REMOTE_SIGNAL_HOMES: "eu=wss://eu.signal.openbot.test,us=wss://us.signal.openbot.test",
  REMOTE_TICKET_KEY_ID: "ticket-1",
  REMOTE_TICKET_PRIVATE_JWK: privateJwk,
  REMOTE_TICKET_PUBLIC_JWKS: publicJwks,
  SLACK_ROUTE_KEY_ID: "ticket-1",
  SLACK_ROUTE_PRIVATE_JWK: privateJwk,
  DISCORD_ROUTE_KEY_ID: "ticket-1",
  DISCORD_ROUTE_PRIVATE_JWK: privateJwk,
  TELEGRAM_BOT_ID: "123456",
};

let stripeCalls = 0;
globalThis.fetch = Object.assign(
  async () => {
    stripeCalls += 1;
    return new Response(JSON.stringify({ error: { message: "offline" } }), { status: 503 });
  },
  { preconnect: () => undefined },
);

let jwksParses = 0;
const parseJson = JSON.parse.bind(JSON);
Object.defineProperty(JSON, "parse", {
  configurable: true,
  value: (...input: Parameters<typeof parseJson>) => {
    if (input[0] === publicJwks) jwksParses += 1;
    return parseJson(...input);
  },
});

let keyImports = 0;
const subtle = crypto.subtle;
const importKey = subtle.importKey.bind(subtle);
Object.defineProperty(subtle, "importKey", {
  configurable: true,
  value: (...input: Parameters<typeof importKey>) => {
    keyImports += 1;
    return importKey(...input);
  },
});

plugin({
  name: "worker-route-modules",
  setup(build) {
    build.module("cloudflare:workers", () => ({
      exports: { env, waitUntil: (promise: Promise<unknown>) => void promise.catch(() => undefined) },
      loader: "object",
    }));
    build.module("@tanstack/solid-router", () => ({
      exports: { createFileRoute: (path: string) => (options: unknown) => ({ path, options }) },
      loader: "object",
    }));
  },
});

type Handler = (input: { request: Request; params: Record<string, string> }) => Promise<Response>;
interface LoadedRoute {
  Route: { options: { server: { handlers: Record<string, Handler> } } };
}
const SRC = join(ROOT, "apps", "auth-api", "src");
const sessionTicket: LoadedRoute = await import(join(SRC, "routes/v2/remote/sessions/$sessionId/ticket.ts"));
const slackRoute: LoadedRoute = await import(join(SRC, "routes/v2/remote/hosts/$hostId/slack-route.ts"));
const discordRoute: LoadedRoute = await import(join(SRC, "routes/v2/remote/hosts/$hostId/discord-route.ts"));
const browser: LoadedRoute = await import(join(SRC, "routes/api/browser/$.ts"));
const credits: LoadedRoute = await import(join(SRC, "routes/v1/me/credits/index.ts"));
const { createWorkerHandler } = await import(join(SRC, "server/worker-handler.ts"));
const { requireWorkerBindings } = await import(join(SRC, "server/types.ts"));

let controlPlaneBuilds = 0;
Object.defineProperty(requireWorkerBindings(env), "TELEGRAM_BOT_USERNAME", {
  configurable: true,
  enumerable: true,
  get: () => {
    controlPlaneBuilds += 1;
    return "openbot_test_bot";
  },
});

function handlerOf(route: LoadedRoute, method: string): Handler {
  const handler = route.Route.options.server.handlers[method];
  if (!handler) throw new Error(`Missing ${method} handler`);
  return handler;
}

const app = createWorkerHandler((request: Request) => {
  const url = new URL(request.url);
  const ticket = /^\/v2\/remote\/sessions\/([^/]+)\/ticket$/u.exec(url.pathname);
  if (ticket?.[1] && request.method === "POST")
    return handlerOf(sessionTicket, "POST")({ request, params: { sessionId: decodeURIComponent(ticket[1]) } });
  const hostRoute = /^\/v2\/remote\/hosts\/([^/]+)\/(slack|discord)-route$/u.exec(url.pathname);
  if (hostRoute?.[1] && request.method === "POST")
    return handlerOf(
      hostRoute[2] === "slack" ? slackRoute : discordRoute,
      "POST",
    )({
      request,
      params: { hostId: decodeURIComponent(hostRoute[1]) },
    });
  if (url.pathname.startsWith("/api/browser/")) return handlerOf(browser, "ANY")({ request, params: {} });
  if (url.pathname === "/v1/me/credits" && request.method === "GET")
    return handlerOf(credits, "GET")({ request, params: {} });
  return new Response("not found", { status: 404 });
});

const Expiring = Schema.Struct({ credits: Schema.Number, expiresAt: Schema.Number });
const Body = Schema.Struct({
  error: Schema.optional(Schema.Struct({ code: Schema.String })),
  ticket: Schema.optional(Schema.String),
  available: Schema.optional(Schema.Boolean),
  currency: Schema.optional(Schema.String),
  balance: Schema.optional(Schema.Number),
  welcome: Schema.optional(Schema.Number),
  expiring: Schema.optional(Expiring),
  servers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        serverId: Schema.String,
        name: Schema.String,
        role: Schema.String,
        balance: Schema.Number,
        expiring: Schema.optional(Expiring),
      }),
    ),
  ),
  user: Schema.optional(Schema.Struct({ id: Schema.String })),
  hosts: Schema.optional(Schema.Array(Schema.Struct({ hostId: Schema.String }))),
});

interface Counts {
  statements: number;
  roundTrips: number;
  primaryReads: number;
  replicaReads: number;
  primaryWrites: number;
  authStatements: number;
  accountRoundTrips: number;
  controlPlaneBuilds: number;
  jwksParses: number;
  keyImports: number;
}

interface Outcome {
  status: number;
  code: string | null;
  ticket: boolean;
  credits: {
    available: boolean | null;
    balance: number | null;
    welcome: number | null;
    expiring: typeof Expiring.Type | null;
    servers: { serverId: string; role: string; balance: number }[] | null;
  } | null;
  counts: Counts;
  queries: string[];
}

function roundTrips(queries: readonly Query[]): number {
  return new Set(queries.map((query, index) => (query.batch === null ? `single-${index}` : `batch-${query.batch}`)))
    .size;
}

async function send(path: string, init: RequestInit): Promise<Outcome> {
  world.queries.length = 0;
  controlPlaneBuilds = 0;
  jwksParses = 0;
  keyImports = 0;
  const response = await app.fetch(new Request(new URL(path, API), init), env);
  const text = await response.text();
  const body = Schema.decodeUnknownSync(Schema.fromJsonString(Body))(text);
  const account = world.queries.filter((query) => !AUTH_SQL.test(query.sql) || query.batch !== null);
  return {
    status: response.status,
    code: body.error?.code ?? null,
    ticket: typeof body.ticket === "string" && body.ticket.split(".").length === 3,
    credits:
      body.balance === undefined
        ? null
        : {
            available: body.available ?? null,
            balance: body.balance,
            welcome: body.welcome ?? null,
            expiring: body.expiring ?? null,
            servers: body.servers?.map(({ serverId, role, balance }) => ({ serverId, role, balance })) ?? null,
          },
    counts: {
      statements: world.queries.length,
      roundTrips: roundTrips(world.queries),
      primaryReads: world.queries.filter((query) => query.instance === "primary" && !query.write).length,
      replicaReads: world.queries.filter((query) => query.instance === "replica").length,
      primaryWrites: world.queries.filter((query) => query.write).length,
      authStatements: world.queries.length - account.length,
      accountRoundTrips: roundTrips(account),
      controlPlaneBuilds,
      jwksParses,
      keyImports,
    },
    queries: world.queries.map(
      (query) =>
        `${query.instance}${query.write ? ":write" : ""}${query.batch === null ? "" : ` batch ${query.batch}`}: ${query.sql}`,
    ),
  };
}

function bearer(bookmark: string | null = null): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, ...(bookmark ? { [ACCOUNT_BOOKMARK_HEADER]: bookmark } : {}) };
}

function creditsRequest(bookmark: string | null = null) {
  return send("/v1/me/credits", { headers: bearer(bookmark) });
}

function ticketRequest() {
  return send(`/v2/remote/sessions/${SESSION}/ticket`, {
    method: "POST",
    headers: { ...bearer(), "Content-Type": "application/json" },
    body: JSON.stringify({ clientPublicKey: "client-public-key-0001" }),
  });
}

function hostRouteRequest(kind: "slack" | "discord") {
  return send(`/v2/remote/hosts/host-1/${kind}-route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machineToken: MACHINE_TOKEN }),
  });
}

function browserRequest(path: string) {
  return send(`/api/browser/${path}`, { headers: { Cookie: `__Host-openbot-web=${TOKEN}` } });
}

interface Seed {
  welcome?: boolean;
}

function seededWorld(seed: Seed = {}): World {
  const next = new World();
  next.both(
    "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES ('user', 'email:user', 'user@example.test', 'User', 1, 1)",
  );
  next.both(
    "INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner', 'owner@example.test', 1, 1)",
  );
  next.both(
    "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES ('auth-1', 'user', ?, ?, ?, ?)",
    tokenHash(TOKEN),
    NOW + DAY_MS,
    NOW,
    NOW,
  );
  next.both(
    "INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, auth_epoch, created_at, updated_at) VALUES ('host-1', 'owner', 'Host', ?, 3, 1, 1)",
    tokenHash(MACHINE_TOKEN),
  );
  next.both(
    "INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES ('membership-1', 'host-1', 'user', 'member', 'active', 1, 1)",
  );
  next.both(
    "INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash) VALUES (?, 'host-1', 'user', 'membership-1', 1, ?, ?)",
    SESSION,
    NOW + DAY_MS,
    tokenHash(TOKEN),
  );
  const ledger =
    "INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)";
  next.both(ledger, "purchase-1", "user", null, 500, "purchase", "purchase-1");
  next.both(ledger, "spend-1", "user", null, -120, "spend", "job-0");
  next.both(ledger, "grant:license-1", "user", null, 200, "grant", "license-1");
  next.both(ledger, "server-purchase-1", null, "host-1", 300, "purchase", "server-purchase-1");
  next.both(
    "INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, created_at) VALUES ('license-1', 'user', NULL, 200, 200, 'license', 'all', 1, ?, 1)",
    NOW + DAY_MS,
  );
  next.both(
    "INSERT INTO credit_holds(job_id, user_id, model_id, credits_tenths, created_at, check_at, expires_at) VALUES ('job-1', 'user', 'model', 30, 1, ?, ?)",
    NOW + DAY_MS,
    NOW + DAY_MS,
  );
  if (seed.welcome !== false) {
    next.both(
      "INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, created_at) VALUES ('welcome:user', 'user', NULL, 100, 100, 'welcome', 'welcome', 1, ?, 1)",
      Date.UTC(9999, 11, 31),
    );
    next.both(ledger, "grant:welcome:user", "user", null, 100, "grant", "welcome:user");
  }
  return next;
}

const REVOKE_AUTH = "UPDATE auth_sessions SET revoked_at = 1 WHERE id = 'auth-1'";
const EXPIRE_AUTH = "UPDATE auth_sessions SET expires_at = 1 WHERE id = 'auth-1'";
const REVOKE_MEMBERSHIP = "UPDATE remote_memberships SET status = 'revoked' WHERE membership_id = 'membership-1'";
const LATE_PURCHASE =
  "INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, reference, created_at) VALUES ('purchase-2', 'user', NULL, 1000, 'purchase', 'purchase-2', 2)";

const results: Record<string, Outcome> = {};
function record(name: string, outcome: Outcome): Outcome {
  results[name] = outcome;
  return outcome;
}

const SERVER = [{ serverId: "host-1", role: "member", balance: 30 }];
const EXPIRING = { credits: 20, expiresAt: NOW + DAY_MS };

function creditsAre(
  outcome: Outcome,
  expected: { balance: number; welcome: number | null; servers: typeof SERVER | [] },
): boolean {
  return (
    outcome.status === 200 &&
    outcome.credits?.available === false &&
    outcome.credits.balance === expected.balance &&
    outcome.credits.welcome === expected.welcome &&
    JSON.stringify(outcome.credits.expiring) === JSON.stringify(EXPIRING) &&
    JSON.stringify(outcome.credits.servers) === JSON.stringify(expected.servers)
  );
}

async function creditCases() {
  world = seededWorld();
  const valid = record("credits: valid session with the welcome grant", await creditsRequest());
  check(
    "credits: a valid session gets the exact balances",
    creditsAre(valid, { balance: 65, welcome: 10, servers: SERVER }),
    valid,
  );
  check(
    "credits: the account reads use one round trip and no welcome-grant SELECT",
    valid.counts.accountRoundTrips === 1 &&
      valid.counts.primaryWrites === 0 &&
      !valid.queries.some((query) => query.includes("SELECT 1 AS issued FROM credit_grants")),
    valid.counts,
  );
  check("credits: the route builds no control plane", valid.counts.controlPlaneBuilds === 0, valid.counts);

  world = seededWorld({ welcome: false });
  const first = record("credits: first visit issues the welcome grant", await creditsRequest());
  check(
    "credits: a first visit issues the welcome grant and shows it in the balance",
    creditsAre(first, { balance: 65, welcome: 10, servers: SERVER }) && first.counts.primaryWrites === 2,
    first,
  );
  const second = record("credits: second visit after the welcome grant", await creditsRequest());
  check(
    "credits: the next visit writes nothing and uses one account round trip",
    creditsAre(second, { balance: 65, welcome: 10, servers: SERVER }) &&
      second.counts.primaryWrites === 0 &&
      second.counts.accountRoundTrips === 1,
    second,
  );

  world = seededWorld();
  world.both(REVOKE_AUTH);
  const revoked = record("credits: revoked account session", await creditsRequest());
  check(
    "credits: a revoked account session gets 401",
    revoked.status === 401 && revoked.code === "unauthorized",
    revoked,
  );

  world = seededWorld();
  world.both(EXPIRE_AUTH);
  const expired = record("credits: expired account session", await creditsRequest());
  check(
    "credits: an expired account session gets 401",
    expired.status === 401 && expired.code === "unauthorized",
    expired,
  );

  world = seededWorld();
  world.both(REVOKE_MEMBERSHIP);
  const missing = record("credits: missing membership", await creditsRequest());
  check(
    "credits: a revoked membership hides the server wallet",
    creditsAre(missing, { balance: 65, welcome: 10, servers: [] }),
    missing,
  );

  world = seededWorld();
  world.replicaOnly("DELETE FROM auth_sessions WHERE id = 'auth-1'");
  world.primaryOnly("UPDATE auth_sessions SET last_used_at = last_used_at WHERE id = 'auth-1'");
  const fresh = record(
    "credits: just-created session missing on the replica",
    await creditsRequest(bookmarkAt(world.primaryVersion)),
  );
  check(
    "credits: a just-created session that the replica does not have reads the primary",
    creditsAre(fresh, { balance: 65, welcome: 10, servers: SERVER }) && fresh.counts.replicaReads === 0,
    fresh,
  );

  world = seededWorld();
  world.primaryOnly(LATE_PURCHASE);
  const staleOld = record("credits: stale replica with an older bookmark", await creditsRequest(bookmarkAt(1)));
  check(
    "credits: an older bookmark can read the stale replica, as before",
    creditsAre(staleOld, { balance: 65, welcome: 10, servers: SERVER }) && staleOld.counts.primaryReads === 0,
    staleOld,
  );
  const staleNew = record(
    "credits: stale replica with the newest bookmark",
    await creditsRequest(bookmarkAt(world.primaryVersion)),
  );
  check(
    "credits: the newest bookmark reads the primary and shows the late purchase",
    creditsAre(staleNew, { balance: 165, welcome: 10, servers: SERVER }) && staleNew.counts.replicaReads === 0,
    staleNew,
  );

  world = seededWorld({ welcome: false });
  world.primaryOnly(
    "INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, created_at) VALUES ('welcome:user', 'user', NULL, 100, 100, 'welcome', 'welcome', 1, ?, 1)",
    Date.UTC(9999, 11, 31),
  );
  world.primaryOnly(
    "INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, reference, created_at) VALUES ('grant:welcome:user', 'user', NULL, 100, 'grant', 'welcome:user', 1)",
  );
  const staleWelcome = record(
    "credits: stale replica does not show a welcome grant from another device",
    await creditsRequest(bookmarkAt(1)),
  );
  check(
    "credits: a welcome grant that only the primary has is not issued again",
    creditsAre(staleWelcome, { balance: 65, welcome: 10, servers: SERVER }) &&
      world.primary.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE reference = 'welcome:user'").get()
        ?.count === 1,
    staleWelcome,
  );
}

async function ticketCases() {
  const cases: { name: string; setup?: (current: World) => void; status: number; code: string | null }[] = [
    { name: "valid session", status: 200, code: null },
    {
      name: "revoked account session",
      setup: (current) => current.both(REVOKE_AUTH),
      status: 401,
      code: "unauthorized",
    },
    {
      name: "expired account session",
      setup: (current) => current.both(EXPIRE_AUTH),
      status: 401,
      code: "unauthorized",
    },
    {
      name: "missing membership",
      setup: (current) => current.both(REVOKE_MEMBERSHIP),
      status: 403,
      code: "session_inactive",
    },
    {
      name: "just-created session missing on the replica",
      setup: (current) => {
        current.replicaOnly("DELETE FROM remote_sessions WHERE session_id = ?", SESSION);
        current.replicaOnly("DELETE FROM auth_sessions WHERE id = 'auth-1'");
      },
      status: 200,
      code: null,
    },
    {
      name: "stale replica still shows a revoked membership",
      setup: (current) => current.replicaOnly(REVOKE_MEMBERSHIP),
      status: 200,
      code: null,
    },
  ];
  world = seededWorld();
  const cold = record("session ticket: first request in the isolate", await ticketRequest());
  check("session ticket: the first request in the isolate gets a ticket", cold.status === 200 && cold.ticket, cold);
  for (const entry of cases) {
    world = seededWorld();
    entry.setup?.(world);
    const outcome = record(`session ticket: ${entry.name}`, await ticketRequest());
    check(
      `session ticket: ${entry.name} gives ${entry.status} ${entry.code}`,
      outcome.status === entry.status && outcome.code === entry.code && (entry.status !== 200 || outcome.ticket),
      outcome,
    );
    check(
      `session ticket: ${entry.name} in a warm isolate parses no JWKS and imports no key`,
      outcome.counts.jwksParses === 0 && outcome.counts.keyImports === 0,
      outcome.counts,
    );
  }
}

async function hostRouteCases() {
  for (const kind of ["slack", "discord"] as const) {
    world = seededWorld();
    const first = record(`${kind} route: first request in the isolate`, await hostRouteRequest(kind));
    const next = [
      record(`${kind} route: second request`, await hostRouteRequest(kind)),
      record(`${kind} route: third request`, await hostRouteRequest(kind)),
    ];
    check(`${kind} route: the first request gets a route ticket`, first.status === 200 && first.ticket, first);
    check(
      `${kind} route: the next requests reuse the parsed JWKS and the imported key`,
      next.every(
        (outcome) =>
          outcome.status === 200 &&
          outcome.ticket &&
          outcome.counts.jwksParses === 0 &&
          outcome.counts.keyImports === 0,
      ),
      next.map((outcome) => outcome.counts),
    );
  }
  world = seededWorld();
  const wrong = record(
    "slack route: wrong machine token",
    await send("/v2/remote/hosts/host-1/slack-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineToken: "wrong-token" }),
    }),
  );
  check("slack route: a wrong machine token is refused", wrong.status === 401 && !wrong.ticket, wrong);
}

async function browserCases() {
  world = seededWorld();
  const sessionOutcome = record("browser: GET session", await browserRequest("session"));
  check(
    "browser: GET session builds no control plane",
    sessionOutcome.status === 200 && sessionOutcome.counts.controlPlaneBuilds === 0,
    sessionOutcome,
  );
  const hosts = record("browser: GET hosts", await browserRequest("v2/remote/hosts"));
  check(
    "browser: GET hosts builds the control plane one time",
    hosts.status === 200 && hosts.counts.controlPlaneBuilds === 1,
    hosts,
  );
  world = seededWorld();
  world.both(REVOKE_AUTH);
  const revoked = record("browser: GET session with a revoked account session", await browserRequest("session"));
  check("browser: a revoked account session gets 401", revoked.status === 401, revoked);
}

try {
  await creditCases();
  await ticketCases();
  await hostRouteCases();
  await browserCases();
} catch (error) {
  check("scenario", false, { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
}

await mkdir(OUT, { recursive: true });
const report = {
  passed: checks.length > 0 && checks.every((entry) => entry.passed),
  stripeCalls,
  checks,
  results,
};
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
