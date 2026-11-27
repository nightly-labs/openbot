import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { Cause, Effect, Exit } from "effect";
import { AuthService } from "../src/server/auth-service";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { d1OverloadedRecently, observedD1 } from "../src/server/observed-d1";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "d1-overload-writes-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SOURCE_IP = "203.0.113.7";
const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i;

const QUEUED_FOR_TOO_LONG = "D1_ERROR: D1 DB is overloaded. Requests queued for too long.";
const TOO_MANY_QUEUED = "D1_ERROR: D1 DB is overloaded. Too many requests queued.";
const RESOURCE_WINDOW = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window.";
const ACCOUNT_THROTTLE =
  "D1_ERROR: Your account is generating too much load on D1 DBs. Please back off and try again later.";
const CONSTRAINT = "D1_ERROR: UNIQUE constraint failed: team_auth_tickets.ticket_hash";

type CallKind = "read" | "write";

interface Refusal {
  kind: CallKind;
  message: string;
  remaining: number;
  attempts: number;
  sql: string | null;
  passed: boolean;
}

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  return database;
}

function refusingD1(database: DatabaseSync) {
  const base = sqliteD1(database);
  const sources = new WeakMap<D1PreparedStatement, { source: D1PreparedStatement; sql: string }>();
  let refusal: Refusal | null = null;
  const kindOf = (sql: string): CallKind => (READ_ONLY_SQL.test(sql) ? "read" : "write");
  const refuse = (kind: CallKind, sql: string) => {
    if (!refusal || refusal.kind !== kind || refusal.passed) return;
    if (refusal.sql === null) refusal.sql = sql;
    if (refusal.sql !== sql) return;
    refusal.attempts += 1;
    if (refusal.remaining <= 0) {
      refusal.passed = true;
      return;
    }
    refusal.remaining -= 1;
    throw new Error(refusal.message);
  };
  const statement = (source: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const kind = kindOf(sql);
    const wrapped: D1PreparedStatement = {
      bind: (...values: unknown[]) => statement(source.bind(...values), sql),
      first: async <T>(column?: string) => {
        refuse(kind, sql);
        return column === undefined ? source.first<T>() : source.first<T>(column);
      },
      run: async <T>() => {
        refuse(kind, sql);
        return source.run<T>();
      },
      all: async <T>() => {
        refuse(kind, sql);
        return source.all<T>();
      },
      raw: source.raw.bind(source),
    };
    sources.set(wrapped, { source, sql });
    return wrapped;
  };
  const d1: D1Database = {
    withSession: (constraintOrBookmark) => base.withSession(constraintOrBookmark),
    dump: () => base.dump(),
    prepare: (sql: string) => statement(base.prepare(sql), sql),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const inner = statements.map((entry) => sources.get(entry) ?? { source: entry, sql: "" });
      const sql = inner.map((entry) => entry.sql).join(";");
      refuse(inner.every((entry) => kindOf(entry.sql) === "read") ? "read" : "write", sql);
      return base.batch<T>(inner.map((entry) => entry.source));
    },
    exec: async (query: string) => {
      refuse("write", query);
      return base.exec(query);
    },
  };
  return {
    d1,
    refuseNext(kind: CallKind, message: string, times: number): Refusal {
      refusal = { kind, message, remaining: times, attempts: 0, sql: null, passed: false };
      return refusal;
    },
    stop() {
      refusal = null;
    },
  };
}

async function outcome<A>(effect: Effect.Effect<A, unknown>) {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { ok: true as const, value: exit.value };
  const error = Cause.squash(exit.cause);
  return {
    ok: false as const,
    error: isTagged(error) ? error._tag : error instanceof Error ? error.name : typeof error,
  };
}

function isTagged(value: unknown): value is { _tag: string } {
  return typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string";
}

async function main() {
  const database = migratedDatabase();
  const fake = refusingD1(database);
  const service = new AuthService({
    repository: new D1AuthRepository(observedD1(fake.d1)),
    delivery: null,
    exposeDevelopmentCode: true,
  });

  const started = await Effect.runPromise(service.startEmailSignIn("owner@example.test", SOURCE_IP));
  const signedIn = await Effect.runPromise(
    service.verifyEmailCode({
      challengeId: started.challengeId,
      code: started.developmentCode ?? "",
      sourceIp: SOURCE_IP,
      surface: "desktop",
    }),
  );
  const token = signedIn.sessionToken;
  const userId = signedIn.user.id;

  const deviceKey = "device-public-key";
  const host: MobileConnectHostBinding = {
    hostId: randomUUID(),
    fingerprint: createHash("sha256").update(deviceKey).digest("base64url"),
  };
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(host.hostId, userId, "Computer", deviceKey, Date.now(), Date.now());

  const first = await outcome(service.issueMobileAuthTicket(token, SOURCE_IP, host));
  const ticket = first.ok ? first.value.ticket : "";
  const paired = await outcome(
    service.redeemMobileAuthTicket(ticket, { id: randomUUID(), name: "Phone", platform: "ios" }, SOURCE_IP),
  );
  const phoneSessionId = String(
    database.prepare("SELECT session_id FROM mobile_auth_sessions LIMIT 1").get()?.session_id ?? "",
  );
  check("a phone pairs while the database answers", first.ok && paired.ok && phoneSessionId.length > 0);

  const newCode = fake.refuseNext("write", QUEUED_FOR_TOO_LONG, 1);
  const newCodeResult = await outcome(service.issueMobileAuthTicket(token, SOURCE_IP, host));
  check(
    "New code works when the database refuses a write once as queued for too long",
    newCodeResult.ok && newCode.attempts === 2,
    { result: newCodeResult.ok ? "ok" : newCodeResult.error, attempts: newCode.attempts },
  );

  const link = fake.refuseNext("write", TOO_MANY_QUEUED, 1);
  const linkResult = await outcome(service.createMobileConnectLink(token, SOURCE_IP, host));
  const activeLinks = Number(
    database
      .prepare("SELECT COUNT(*) AS count FROM mobile_connect_links WHERE host_id = ? AND revoked_at IS NULL")
      .get(host.hostId)?.count,
  );
  check(
    "Permanent link works when the database refuses a write once with too many queued requests",
    linkResult.ok && link.attempts === 2 && activeLinks === 1,
    { result: linkResult.ok ? "ok" : linkResult.error, attempts: link.attempts, activeLinks },
  );

  const disconnect = fake.refuseNext("write", QUEUED_FOR_TOO_LONG, 1);
  const disconnectResult = await outcome(service.revokeMobileAuthDevice(token, phoneSessionId));
  fake.stop();
  const phonesLeft = await outcome(service.listMobileAuthDevices(token, host.hostId));
  check(
    "Disconnect works when the database refuses a write once, and the phone leaves the list",
    disconnectResult.ok && disconnect.attempts === 2 && phonesLeft.ok && phonesLeft.value.length === 0,
    {
      result: disconnectResult.ok ? "ok" : disconnectResult.error,
      attempts: disconnect.attempts,
      phones: phonesLeft.ok ? phonesLeft.value.length : phonesLeft.error,
    },
  );
  check(
    "a write that succeeds on its retry does not mark the database as overloaded",
    !d1OverloadedRecently(Date.now()),
  );

  const throttledRead = fake.refuseNext("read", ACCOUNT_THROTTLE, 1);
  const throttledReadResult = await outcome(service.listMobileAuthDevices(token, host.hostId));
  check(
    "a read refused by the account load throttle gets its retry",
    throttledReadResult.ok && throttledRead.attempts === 2,
    { result: throttledReadResult.ok ? "ok" : throttledReadResult.error, attempts: throttledRead.attempts },
  );

  const overloadedBeforeThrottle = d1OverloadedRecently(Date.now());
  for (const [name, message] of [
    ["the account load throttle", ACCOUNT_THROTTLE],
    ["the 10 second resource window", RESOURCE_WINDOW],
    ["a constraint failure", CONSTRAINT],
  ] as const) {
    const refused = fake.refuseNext("write", message, 1);
    const result = await outcome(service.issueMobileAuthTicket(token, SOURCE_IP, host));
    check(`a write refused by ${name} is not sent again`, !result.ok && refused.attempts === 1, {
      result: result.ok ? "ok" : result.error,
      attempts: refused.attempts,
    });
    if (message === ACCOUNT_THROTTLE) {
      check(
        "the account load throttle marks the database as overloaded, so the answer gets Retry-After",
        !overloadedBeforeThrottle && d1OverloadedRecently(Date.now()),
      );
    }
  }

  const twice = fake.refuseNext("write", QUEUED_FOR_TOO_LONG, 2);
  const twiceResult = await outcome(service.issueMobileAuthTicket(token, SOURCE_IP, host));
  check(
    "a write refused two times fails after one retry and marks the database as overloaded",
    !twiceResult.ok &&
      twiceResult.error === "AuthOperationError" &&
      twice.attempts === 2 &&
      d1OverloadedRecently(Date.now()),
    { result: twiceResult.ok ? "ok" : twiceResult.error, attempts: twice.attempts },
  );

  const execRefusal = fake.refuseNext("write", QUEUED_FOR_TOO_LONG, 1);
  const execResult = await observedD1(fake.d1)
    .exec("CREATE TABLE IF NOT EXISTS overload_probe (id INTEGER)")
    .then(
      () => "ok",
      () => "failed",
    );
  check("an exec call is never sent again", execResult === "failed" && execRefusal.attempts === 1, {
    result: execResult,
    attempts: execRefusal.attempts,
  });
  fake.stop();

  const recovered = await outcome(service.issueMobileAuthTicket(token, SOURCE_IP, host));
  check("New code works again when the database answers", recovered.ok);

  const passed = checks.every((entry) => entry.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
  if (!passed) process.exit(1);
}

await main();
