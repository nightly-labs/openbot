import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { runApiEffect } from "../src/server/effect-runtime";
import { sqliteD1 } from "./sqlite-d1";

const MIGRATIONS = join(resolve(import.meta.dirname, ".."), "migrations");
const ACCESS_LIFETIME_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const USER = { id: "user-1", email: "user@example.test", name: "User", avatarUrl: null };
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/iu;

type IssueMode = "present" | "missing" | "failing";
type BearerKind = "session" | "access" | "none" | "unknown";

interface D1Count {
  reads: number;
  writes: number;
}

interface SentRequest {
  method: string;
  path: string;
  bearer: BearerKind;
  status: number;
  d1Reads: number;
  d1Writes: number;
}

function countingD1(base: D1Database, count: D1Count): D1Database {
  const tally = (sql: string) => {
    if (WRITE_SQL.test(sql)) count.writes += 1;
    else count.reads += 1;
  };
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => ({
    bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
    first<T>(column?: string): Promise<T | null> {
      tally(sql);
      return column === undefined ? statement.first<T>() : statement.first<T>(column);
    },
    all<T>() {
      tally(sql);
      return statement.all<T>();
    },
    run<T>() {
      tally(sql);
      return statement.run<T>();
    },
    raw: () => {
      throw new Error("Unused raw");
    },
  });
  const prepare = (sql: string) => wrap(base.prepare(sql), sql);
  const batch = <T>(statements: D1PreparedStatement[]) => base.batch<T>(statements);
  return {
    prepare,
    batch,
    exec: (sql: string) => base.exec(sql),
    withSession: () => ({ prepare, batch, getBookmark: () => null }),
    dump: () => base.dump(),
  };
}

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");
for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
database
  .prepare("INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)")
  .run(USER.id, `email:${USER.email}`, USER.email, USER.name);
const base = sqliteD1(database);

const secret = randomBytes(32);
const sessionTokens = new Set<string>();
const sent: SentRequest[] = [];
const issued: string[] = [];
const state: { mode: IssueMode; expireNextAccess: boolean; refuseNextAccess: boolean; clock: number | null } = {
  mode: "present",
  expireNextAccess: false,
  refuseNextAccess: false,
  clock: null,
};
const now = () => state.clock ?? Date.now();

function addSession(token: string) {
  sessionTokens.add(token);
  database
    .prepare(
      "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(`session-${sessionTokens.size}`, USER.id, hashOf(token), now() + DAY_MS, now(), now());
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function mint(sessionHash: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ sid: sessionHash.slice(0, 16), exp: expiresAt })).toString("base64url");
  return `oba1.${payload}.${sign(`oba1.${payload}`)}`;
}

function accessExpiry(token: string): number | null {
  const [prefix, payload, signature] = token.split(".");
  if (prefix !== "oba1" || !payload || !signature) return null;
  const expected = Buffer.from(sign(`oba1.${payload}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  return isDynamicRecord(claims) && isNumber(claims.exp) ? claims.exp : null;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

async function control(request: Request): Promise<Response> {
  const body = await request.json();
  if (!isDynamicRecord(body)) return Response.json(errorBody("invalid", "Invalid control."), { status: 400 });
  if (body.mode === "present" || body.mode === "missing" || body.mode === "failing") state.mode = body.mode;
  if (typeof body.expireNextAccess === "boolean") state.expireNextAccess = body.expireNextAccess;
  if (typeof body.refuseNextAccess === "boolean") state.refuseNextAccess = body.refuseNextAccess;
  if (isNumber(body.clock) || body.clock === null) state.clock = body.clock;
  if (Array.isArray(body.addSessions)) for (const token of body.addSessions) if (isString(token)) addSession(token);
  return Response.json({ ok: true });
}

async function account(request: Request, url: URL): Promise<Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const bearer: BearerKind =
    token === "" ? "none" : token.startsWith("oba1.") ? "access" : sessionTokens.has(token) ? "session" : "unknown";
  const count: D1Count = { reads: 0, writes: 0 };
  const repository = new D1AuthRepository(countingD1(base, count));
  const answer = (status: number, body: unknown) => {
    sent.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      bearer,
      status,
      d1Reads: count.reads,
      d1Writes: count.writes,
    });
    return Response.json(body, { status, headers: { Date: new Date(now()).toUTCString() } });
  };
  const sessionUser = () => runApiEffect(repository.authenticate(token, now()).pipe(Effect.orDie));
  if (url.pathname === "/v1/auth/access-token" && request.method === "POST") {
    if (state.mode === "missing") return answer(404, errorBody("not_found", "Not found."));
    if (state.mode === "failing") return answer(503, errorBody("unavailable", "Unavailable."));
    if (bearer !== "session" || !(await sessionUser())) return answer(401, errorBody("unauthorized", "Sign in again."));
    const expiresAt = now() + ACCESS_LIFETIME_MS;
    const accessToken = mint(hashOf(token), expiresAt);
    issued.push(accessToken);
    return answer(200, { accessToken, expiresAt });
  }
  if (bearer === "access") {
    const expiry = accessExpiry(token);
    if (state.refuseNextAccess) {
      state.refuseNextAccess = false;
      return answer(401, errorBody("unauthorized", "Sign in again."));
    }
    if (expiry === null || state.expireNextAccess || expiry <= now()) {
      state.expireNextAccess = false;
      return answer(401, errorBody("access_token_expired", "The access token expired."));
    }
  } else if (bearer !== "session" || !(await sessionUser())) {
    return answer(401, errorBody("unauthorized", "Sign in again."));
  }
  if (url.pathname === "/v1/auth/logout" && request.method === "POST") {
    await runApiEffect(repository.revokeSession(token, now()).pipe(Effect.orDie));
    sessionTokens.delete(token);
    return answer(200, { ok: true });
  }
  if (url.pathname === "/v1/me") return answer(200, USER);
  if (url.pathname === "/v2/remote/hosts/") return answer(200, { hosts: [] });
  if (url.pathname.startsWith("/v1/me/") || url.pathname.startsWith("/v1/mobile-auth/"))
    return answer(200, { ok: true });
  return answer(404, errorBody("not_found", "Not found."));
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__control" && request.method === "POST") return control(request);
    if (url.pathname === "/__log") return Response.json({ sent, issued });
    if (url.pathname === "/health/live") return Response.json({ status: "ok" });
    return account(request, url);
  },
});
process.stdout.write(`${JSON.stringify({ port: server.port })}\n`);
process.on("SIGTERM", () => {
  server.stop(true);
  database.close();
  process.exit(0);
});
