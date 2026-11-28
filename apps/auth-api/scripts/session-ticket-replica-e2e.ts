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
const OUT = join(ROOT, ".openbot-build", process.env.SESSION_TICKET_REPLICA_REPORT ?? "session-ticket-replica-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const API = "https://account.openbot.test";
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOKEN = "browser-session-token-0001";
const OTHER_TOKEN = "browser-session-token-0002";
const SESSION = "remote-session-1";
const CLIENT_KEY = "client-public-key-0001";
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/iu;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

type Instance = "primary" | "replica";
interface Query {
  instance: Instance;
  write: boolean;
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
    world.queries.push({ instance, write, sql: sql.trim().replace(/\s+/gu, " ").slice(0, 60) });
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
    batch: <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map((entry) => entry.all<T>())),
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
  batch: <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map((entry) => entry.all<T>())),
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
const ticketKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
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
  REMOTE_SIGNAL_URL: "wss://signal.openbot.test",
  REMOTE_TICKET_KEY_ID: "ticket-1",
  REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
    ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.privateKey)),
    kid: "ticket-1",
  }),
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
    keys: [{ ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.publicKey)), kid: "ticket-1" }],
  }),
};

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
const v2Ticket: LoadedRoute = await import(join(SRC, "routes/v2/remote/sessions/$sessionId/ticket.ts"));
const browser: LoadedRoute = await import(join(SRC, "routes/api/browser/$.ts"));
const me: LoadedRoute = await import(join(SRC, "routes/v1/me.ts"));
const { createWorkerHandler } = await import(join(SRC, "server/worker-handler.ts"));

function handlerOf(route: LoadedRoute, method: string): Handler {
  const handler = route.Route.options.server.handlers[method];
  if (!handler) throw new Error(`Missing ${method} handler`);
  return handler;
}

const app = createWorkerHandler((request: Request) => {
  const url = new URL(request.url);
  const ticket = /^\/v2\/remote\/sessions\/([^/]+)\/ticket$/u.exec(url.pathname);
  if (ticket?.[1] && request.method === "POST")
    return handlerOf(v2Ticket, "POST")({ request, params: { sessionId: decodeURIComponent(ticket[1]) } });
  if (url.pathname.startsWith("/api/browser/")) return handlerOf(browser, "ANY")({ request, params: {} });
  if (url.pathname === "/v1/me" && request.method === "GET") return handlerOf(me, "GET")({ request, params: {} });
  return new Response("not found", { status: 404 });
});

interface Outcome {
  status: number;
  code: string | null;
  claims: TicketClaims | null;
  user: string | null;
  name: string | null;
  bookmark: string | null;
  queries: { primaryReads: number; replicaReads: number; primaryWrites: number; tables: string[] };
}

const Claims = Schema.Struct({
  sessionId: Schema.String,
  hostId: Schema.String,
  userId: Schema.String,
  membershipId: Schema.String,
  role: Schema.String,
  authEpoch: Schema.Number,
  sessionExpiresAt: Schema.Number,
  clientPublicKey: Schema.optional(Schema.String),
  signal: Schema.optional(Schema.String),
});
const Body = Schema.Struct({
  error: Schema.optional(Schema.Struct({ code: Schema.String })),
  ticket: Schema.optional(Schema.String),
  user: Schema.optional(Schema.Struct({ id: Schema.String, name: Schema.NullOr(Schema.String) })),
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

type TicketClaims = Omit<typeof Claims.Type, "sessionExpiresAt"> & { sessionExpiresAtMatches: boolean };

function ticketClaims(ticket: string | undefined): TicketClaims | null {
  const payload = ticket?.split(".")[1];
  if (!payload) return null;
  const { sessionExpiresAt, ...claims } = Schema.decodeUnknownSync(Schema.fromJsonString(Claims))(
    Buffer.from(payload, "base64url").toString(),
  );
  return { ...claims, sessionExpiresAtMatches: sessionExpiresAt === Math.floor((NOW + DAY_MS) / 1_000) };
}

async function send(path: string, init: RequestInit): Promise<Outcome> {
  world.queries.length = 0;
  const response = await app.fetch(new Request(new URL(path, API), init), env);
  const body = Schema.decodeUnknownSync(Schema.fromJsonString(Body))(await response.text());
  const user = body.user ?? { id: body.id ?? null, name: body.name ?? null };
  return {
    status: response.status,
    code: body.error?.code ?? null,
    claims: ticketClaims(body.ticket),
    user: user.id,
    name: user.name,
    bookmark: response.headers.get(ACCOUNT_BOOKMARK_HEADER),
    queries: {
      primaryReads: world.queries.filter((query) => query.instance === "primary" && !query.write).length,
      replicaReads: world.queries.filter((query) => query.instance === "replica").length,
      primaryWrites: world.queries.filter((query) => query.write).length,
      tables: world.queries.map((query) => `${query.instance}${query.write ? ":write" : ""}: ${query.sql}`),
    },
  };
}

type Client = "v2" | "browser";

function ticketRequest(client: Client, token: string | null, body: unknown = { clientPublicKey: CLIENT_KEY }) {
  const path =
    client === "v2" ? `/v2/remote/sessions/${SESSION}/ticket` : `/api/browser/v2/remote/sessions/${SESSION}/ticket`;
  const headers: Record<string, string> =
    client === "v2"
      ? { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      : {
          "Content-Type": "application/json",
          Origin: API,
          "X-OpenBot-Browser": "1",
          ...(token ? { Cookie: `__Host-openbot-web=${token}` } : {}),
        };
  return send(path, { method: "POST", headers, body: JSON.stringify(body) });
}

function sessionRequest(client: "me" | "browser", bookmark: string | null) {
  const headers: Record<string, string> = {
    ...(client === "me" ? { Authorization: `Bearer ${TOKEN}` } : { Cookie: `__Host-openbot-web=${TOKEN}` }),
    ...(bookmark ? { [ACCOUNT_BOOKMARK_HEADER]: bookmark } : {}),
  };
  return send(client === "me" ? "/v1/me" : "/api/browser/session", { headers });
}

interface Seed {
  lastUsedAt?: number;
  boundTo?: string | null;
}

function seededWorld(seed: Seed = {}): World {
  const next = new World();
  next.both(
    "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES ('user', 'email:user', 'user@example.test', 'Old name', 1, 1)",
  );
  next.both(
    "INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner', 'owner@example.test', 1, 1)",
  );
  for (const [id, token] of [
    ["auth-1", TOKEN],
    ["auth-2", OTHER_TOKEN],
  ] as const) {
    next.both(
      "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, 'user', ?, ?, ?, ?)",
      id,
      tokenHash(token),
      NOW + DAY_MS,
      NOW,
      seed.lastUsedAt ?? NOW,
    );
  }
  next.both(
    "INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at) VALUES ('host-1', 'owner', 'Host', 3, 1, 1)",
  );
  next.both(
    "INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES ('membership-1', 'host-1', 'user', 'member', 'active', 1, 1)",
  );
  const boundTo = seed.boundTo === undefined ? TOKEN : seed.boundTo;
  next.both(
    "INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash) VALUES (?, 'host-1', 'user', 'membership-1', 1, ?, ?)",
    SESSION,
    NOW + DAY_MS,
    boundTo === null ? null : tokenHash(boundTo),
  );
  return next;
}

const REVOKE_AUTH = "UPDATE auth_sessions SET revoked_at = 1 WHERE id = 'auth-1'";
const EXPIRE_AUTH = "UPDATE auth_sessions SET expires_at = 1 WHERE id = 'auth-1'";
const REVOKE_MEMBERSHIP = "UPDATE remote_memberships SET status = 'revoked' WHERE membership_id = 'membership-1'";
const END_SESSION = "UPDATE remote_sessions SET ended_at = 1 WHERE session_id = ?";

interface TicketCase {
  name: string;
  seed?: Seed;
  token?: string | null;
  body?: unknown;
  setup?: (current: World) => void;
}

const TICKET_CASES: TicketCase[] = [
  { name: "valid session" },
  { name: "valid session with an hourly activity write", seed: { lastUsedAt: NOW - 2 * HOUR_MS } },
  { name: "no token", token: null },
  { name: "unknown token", token: "browser-session-token-9999" },
  { name: "missing client public key", body: {} },
  { name: "revoked account session", setup: (current) => current.both(REVOKE_AUTH) },
  { name: "expired account session", setup: (current) => current.both(EXPIRE_AUTH) },
  { name: "revoked membership", setup: (current) => current.both(REVOKE_MEMBERSHIP) },
  {
    name: "missing remote session",
    setup: (current) => current.both("DELETE FROM remote_sessions WHERE session_id = ?", SESSION),
  },
  { name: "ended remote session", setup: (current) => current.both(END_SESSION, SESSION) },
  { name: "session of an older client with no account binding", seed: { boundTo: null } },
  { name: "session that another account session started", seed: { boundTo: OTHER_TOKEN } },
  {
    name: "just-created account session missing on the replica",
    setup: (current) => {
      current.replicaOnly("DELETE FROM remote_sessions WHERE session_id = ?", SESSION);
      current.replicaOnly("DELETE FROM auth_sessions WHERE id = 'auth-1'");
    },
  },
  {
    name: "just-created remote session missing on the replica",
    setup: (current) => current.replicaOnly("DELETE FROM remote_sessions WHERE session_id = ?", SESSION),
  },
  {
    name: "stale replica still shows a revoked membership that is active again",
    setup: (current) => current.replicaOnly(REVOKE_MEMBERSHIP),
  },
  {
    name: "stale replica still shows an ended session",
    setup: (current) => current.replicaOnly(END_SESSION, SESSION),
  },
  {
    name: "stale replica does not show the account session revocation",
    setup: (current) => current.primaryOnly(REVOKE_AUTH),
  },
  {
    name: "stale replica does not show the membership revocation",
    setup: (current) => current.primaryOnly(REVOKE_MEMBERSHIP),
  },
  {
    name: "stale replica does not show the end of the session",
    setup: (current) => current.primaryOnly(END_SESSION, SESSION),
  },
];

const LAG_CASES = new Set([
  "stale replica does not show the account session revocation",
  "stale replica does not show the membership revocation",
  "stale replica does not show the end of the session",
]);

const EXPECTED: Record<string, Record<Client, [number, string | null]>> = {
  "valid session": { v2: [200, null], browser: [200, null] },
  "valid session with an hourly activity write": { v2: [200, null], browser: [200, null] },
  "no token": { v2: [401, "unauthorized"], browser: [401, "sign_in_required"] },
  "unknown token": { v2: [401, "unauthorized"], browser: [401, "sign_in_required"] },
  "missing client public key": { v2: [400, "invalid_remote_request"], browser: [400, "invalid_browser_request"] },
  "revoked account session": { v2: [401, "unauthorized"], browser: [401, "sign_in_required"] },
  "expired account session": { v2: [401, "unauthorized"], browser: [401, "sign_in_required"] },
  "revoked membership": { v2: [403, "session_inactive"], browser: [403, "session_inactive"] },
  "missing remote session": { v2: [403, "session_inactive"], browser: [403, "session_inactive"] },
  "ended remote session": { v2: [403, "session_inactive"], browser: [403, "session_inactive"] },
  "session of an older client with no account binding": { v2: [200, null], browser: [403, "session_inactive"] },
  "session that another account session started": { v2: [200, null], browser: [403, "session_inactive"] },
  "just-created account session missing on the replica": { v2: [200, null], browser: [200, null] },
  "just-created remote session missing on the replica": { v2: [200, null], browser: [200, null] },
  "stale replica still shows a revoked membership that is active again": { v2: [200, null], browser: [200, null] },
  "stale replica still shows an ended session": { v2: [200, null], browser: [200, null] },
  "stale replica does not show the account session revocation": { v2: [200, null], browser: [200, null] },
  "stale replica does not show the membership revocation": { v2: [200, null], browser: [200, null] },
  "stale replica does not show the end of the session": { v2: [200, null], browser: [200, null] },
};

function expectedClaims(claims: TicketClaims | null): boolean {
  return (
    claims?.sessionId === SESSION &&
    claims.hostId === "host-1" &&
    claims.userId === "user" &&
    claims.membershipId === "membership-1" &&
    claims.role === "member" &&
    claims.authEpoch === 3 &&
    claims.clientPublicKey === CLIENT_KEY &&
    claims.signal === undefined &&
    claims.sessionExpiresAtMatches
  );
}

const results: Record<string, Outcome> = {};

async function ticketCases() {
  for (const entry of TICKET_CASES) {
    for (const client of ["v2", "browser"] as const) {
      world = seededWorld(entry.seed);
      entry.setup?.(world);
      const outcome = await ticketRequest(
        client,
        entry.token === undefined ? TOKEN : entry.token,
        entry.body ?? { clientPublicKey: CLIENT_KEY },
      );
      const key = `${client} ticket: ${entry.name}`;
      results[key] = outcome;
      const expected = EXPECTED[entry.name]?.[client];
      const claimsMatch = outcome.status !== 200 || expectedClaims(outcome.claims);
      check(
        `${key} gives ${expected?.join(" ")}${LAG_CASES.has(entry.name) ? " for the replica lag" : ""}`,
        expected !== undefined && outcome.status === expected[0] && outcome.code === expected[1] && claimsMatch,
        outcome,
      );
    }
  }

  for (const client of ["v2", "browser"] as const) {
    const valid = results[`${client} ticket: valid session`];
    check(
      `${client} ticket: a valid session makes one replica query and no primary query`,
      valid?.queries.replicaReads === 1 && valid.queries.primaryReads === 0 && valid.queries.primaryWrites === 0,
      valid?.queries,
    );
    const activity = results[`${client} ticket: valid session with an hourly activity write`];
    check(
      `${client} ticket: the hourly activity write still goes to the primary`,
      activity?.queries.primaryWrites === 1,
      activity?.queries,
    );
    for (const name of [
      "just-created account session missing on the replica",
      "just-created remote session missing on the replica",
      "stale replica still shows a revoked membership that is active again",
      "stale replica still shows an ended session",
      "revoked membership",
      "ended remote session",
    ]) {
      const outcome = results[`${client} ticket: ${name}`];
      check(
        `${client} ticket: ${name} reads the primary once after the replica`,
        outcome?.queries.replicaReads === 1 && outcome.queries.primaryReads === 1,
        outcome?.queries,
      );
    }
  }
}

async function sessionCases() {
  for (const client of ["me", "browser"] as const) {
    const label = client === "me" ? "GET /v1/me" : "GET /api/browser/session";

    world = seededWorld();
    const plain = await sessionRequest(client, null);
    results[`${label}: no bookmark`] = plain;
    check(
      `${label} with no bookmark reads the primary as before`,
      plain.status === 200 &&
        plain.user === "user" &&
        plain.queries.primaryReads === 1 &&
        plain.queries.replicaReads === 0,
      plain,
    );

    world = seededWorld();
    const caughtUp = await sessionRequest(client, bookmarkAt(world.primaryVersion));
    results[`${label}: bookmark the replica has`] = caughtUp;
    check(
      `${label} with a bookmark that the replica has reads only the replica`,
      caughtUp.status === 200 && caughtUp.queries.replicaReads === 1 && caughtUp.queries.primaryReads === 0,
      caughtUp,
    );

    world = seededWorld();
    world.primaryOnly("UPDATE users SET name = 'New name' WHERE id = 'user'");
    const ownWrite = await sessionRequest(client, bookmarkAt(world.primaryVersion));
    results[`${label}: bookmark of a profile write`] = ownWrite;
    check(
      `${label} with the bookmark of a profile write reads that write while the replica lags`,
      ownWrite.status === 200 && ownWrite.name === "New name",
      ownWrite,
    );

    world = seededWorld();
    world.replicaOnly("DELETE FROM auth_sessions WHERE id = 'auth-1'");
    world.primaryVersion += 1;
    const signedIn = await sessionRequest(client, bookmarkAt(world.primaryVersion));
    results[`${label}: bookmark of a fresh sign-in`] = signedIn;
    check(
      `${label} with the bookmark of a fresh sign-in finds the new account session`,
      signedIn.status === 200 && signedIn.user === "user",
      signedIn,
    );

    world = seededWorld();
    world.both(REVOKE_AUTH);
    const revoked = await sessionRequest(client, bookmarkAt(world.primaryVersion));
    results[`${label}: revoked account session`] = revoked;
    check(`${label} refuses a revoked account session`, revoked.status === 401, revoked);

    world = seededWorld();
    world.both(EXPIRE_AUTH);
    const expired = await sessionRequest(client, bookmarkAt(world.primaryVersion));
    results[`${label}: expired account session`] = expired;
    check(`${label} refuses an expired account session`, expired.status === 401, expired);

    world = seededWorld();
    const before = bookmarkAt(world.primaryVersion);
    world.primaryOnly(REVOKE_AUTH);
    const lag = await sessionRequest(client, before);
    results[`${label}: stale replica does not show the revocation`] = lag;
    check(
      `${label} with an older bookmark accepts a revoked account session for the replica lag`,
      lag.status === 200,
      lag,
    );
    world = seededWorld();
    world.primaryOnly(REVOKE_AUTH);
    const lagNoBookmark = await sessionRequest(client, null);
    results[`${label}: stale replica, no bookmark`] = lagNoBookmark;
    check(
      `${label} with no bookmark refuses a revoked account session that the replica does not show`,
      lagNoBookmark.status === 401,
      lagNoBookmark,
    );
  }
}

try {
  await ticketCases();
  await sessionCases();
} catch (error) {
  check("scenario", false, { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
}

await mkdir(OUT, { recursive: true });
const report = { passed: checks.length > 0 && checks.every((entry) => entry.passed), checks, results };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exitCode = 1;
