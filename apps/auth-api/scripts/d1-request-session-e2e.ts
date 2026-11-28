import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ACCOUNT_BOOKMARK_HEADER } from "@openbot/contracts/account-bookmark";
import { ACCOUNT_ACCESS_TOKEN_PATH } from "@openbot/team-client/account-access-token";
import { accountBookmarkHeaders, rememberAccountBookmark } from "@openbot/team-client/account-bookmark";
import { RemoteTeamDirectoryClient } from "@openbot/team-client/remote-directory";
import { Effect, Schema } from "effect";
import { CentralAuthTransport } from "../../../src/main/central-auth-effects";
import { sessionReadsFor } from "../src/server/auth-service";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { runApiEffect } from "../src/server/effect-runtime";
import { observedD1 } from "../src/server/observed-d1";
import type { SessionReads } from "../src/server/types";
import { createWorkerHandler } from "../src/server/worker-handler";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "d1-request-session-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const API = "https://account.openbot.test";
const OTHER_API = "https://other.openbot.test";
const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = "session-token";
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/iu;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

type Instance = "primary" | "replica";

interface Route {
  request: string;
  sql: string;
  instance: Instance;
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)")
    .run("user", "email:user", "user@example.test", "Old name");
  database
    .prepare(
      "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("session", "user", createHash("sha256").update(TOKEN).digest("base64url"), NOW + DAY_MS, NOW, NOW);
  return database;
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

const NamesBody = Schema.Struct({ names: Schema.Array(Schema.NullOr(Schema.String)) });

async function namesOf(response: Response): Promise<readonly (string | null)[]> {
  return Schema.decodeUnknownSync(Schema.fromJsonString(NamesBody))(await response.text()).names;
}

class ReplicatedD1 {
  readonly routes: Route[] = [];
  readonly sessions: string[] = [];
  readonly #pending: { sql: string; values: SQLInputValue[] }[] = [];
  readonly #primary = migratedDatabase();
  readonly #replica = migratedDatabase();
  #primaryVersion = 1;
  #replicaVersion = 1;
  #currentRequest = "outside";

  get primaryBookmark(): string {
    return bookmarkAt(this.#primaryVersion);
  }

  forRequest(name: string): void {
    this.#currentRequest = name;
  }

  syncReplica(): void {
    for (const write of this.#pending.splice(0)) this.#replica.prepare(write.sql).run(...write.values);
    this.#replicaVersion = this.#primaryVersion;
  }

  database(): D1Database {
    return {
      prepare: (sql) => this.#statement(sql, [], () => "primary", "raw"),
      batch: <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.all<T>())),
      exec: () => Promise.reject(new Error("Unused")),
      withSession: (constraint) => this.#session(constraint ?? "first-unconstrained"),
      dump: () => Promise.reject(new Error("Unused")),
    };
  }

  #session(constraint: string): D1DatabaseSession {
    this.sessions.push(constraint);
    let bookmark: string | null = constraint.startsWith("first-") ? null : constraint;
    let first = true;
    const pick = (write: boolean): Instance => {
      const firstQuery = first;
      first = false;
      if (write) return "primary";
      if (firstQuery && constraint === "first-primary") return "primary";
      if (bookmark === null) return "replica";
      return this.#replicaVersion >= versionOf(bookmark) ? "replica" : "primary";
    };
    const advance = (instance: Instance) => {
      const reached = bookmarkAt(instance === "primary" ? this.#primaryVersion : this.#replicaVersion);
      if (bookmark === null || reached > bookmark) bookmark = reached;
    };
    return {
      prepare: (sql) => this.#statement(sql, [], pick, "session", advance),
      batch: <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.all<T>())),
      getBookmark: () => bookmark,
    };
  }

  #statement(
    sql: string,
    values: SQLInputValue[],
    pick: (write: boolean) => Instance,
    kind: string,
    advance: (instance: Instance) => void = () => undefined,
  ): D1PreparedStatement {
    const execute = async <T>(call: (statement: D1PreparedStatement) => Promise<T>): Promise<T> => {
      const write = WRITE_SQL.test(sql);
      const instance = pick(write);
      this.routes.push({ request: this.#currentRequest, sql: `${kind}: ${sql.trim().slice(0, 40)}`, instance });
      const target = sqliteD1(instance === "primary" ? this.#primary : this.#replica);
      const result = await call(target.prepare(sql).bind(...values));
      if (write) {
        this.#primaryVersion += 1;
        this.#pending.push({ sql, values });
      }
      advance(instance);
      return result;
    };
    const prepared: D1PreparedStatement = {
      bind: (...input: unknown[]) => this.#statement(sql, input.map(sqlValue), pick, kind, advance),
      first<T>(column?: string): Promise<T | null> {
        return execute((statement) => (column === undefined ? statement.first<T>() : statement.first<T>(column)));
      },
      all: <T>() => execute((statement) => statement.all<T>()),
      run: <T>() => execute((statement) => statement.run<T>()),
      raw: () => {
        throw new Error("Unused raw");
      },
    };
    return prepared;
  }
}

const replicated = new ReplicatedD1();
const DB = replicated.database();
const repository = new D1AuthRepository(observedD1(DB));

const accountApp = (request: Request): Promise<Response> =>
  runApiEffect(
    Effect.gen(function* () {
      const url = new URL(request.url);
      if (url.pathname === ACCOUNT_ACCESS_TOKEN_PATH) return Response.json({ error: "not_found" }, { status: 404 });
      const token = request.headers.get("Authorization")?.replace(/^Bearer /u, "") ?? "";
      const reads: SessionReads = url.searchParams.has("primary-session") ? "primary" : sessionReadsFor(request);
      const user = yield* repository.authenticate(token, NOW, reads);
      if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
      yield* Effect.yieldNow;
      if (request.method === "GET") {
        const row = yield* Effect.promise(() =>
          observedD1(DB).prepare("SELECT name FROM users WHERE id = ?").bind(user.id).first<{ name: string }>(),
        );
        yield* Effect.sleep(5);
        const again = yield* Effect.promise(() =>
          observedD1(DB).prepare("SELECT name FROM users WHERE id = ?").bind(user.id).first<{ name: string }>(),
        );
        if (url.pathname === "/v2/remote/hosts/") return Response.json({ hosts: [], names: [row?.name, again?.name] });
        return Response.json({ names: [row?.name ?? null, again?.name ?? null] });
      }
      const name = url.searchParams.get("name") ?? "New name";
      yield* Effect.promise(() =>
        observedD1(DB).prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run(),
      );
      return Response.json({ ok: true });
    }).pipe(Effect.orDie),
  );

const handler = createWorkerHandler(accountApp);
const bindings: Parameters<typeof handler.fetch>[1] = {
  DB,
  MARKETPLACE_INGRESS_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

async function send(name: string, path: string, init: RequestInit = {}): Promise<Response> {
  replicated.forRequest(name);
  return handler.fetch(new Request(new URL(path, API), init), bindings);
}

function routesOf(name: string): Route[] {
  return replicated.routes.filter((route) => route.request === name);
}

function onPrimary(name: string, write = false): Route[] {
  return routesOf(name).filter(
    (route) => route.instance === "primary" && WRITE_SQL.test(route.sql.split(": ")[1] ?? "") === write,
  );
}

const auth = { Authorization: `Bearer ${TOKEN}` };

async function main() {
  const oldClient = await send("old-client-get", "/v1/me", { headers: auth });
  const oldBookmark = oldClient.headers.get(ACCOUNT_BOOKMARK_HEADER);
  check(
    "a GET without a bookmark reads its first query from the primary, as before, and gets a bookmark back",
    oldClient.status === 200 && oldBookmark !== null && onPrimary("old-client-get").length >= 1,
    { bookmark: oldBookmark, routes: routesOf("old-client-get") },
  );

  const write = await send("write", "/v1/me?name=New%20name", { method: "POST", headers: auth });
  const writeBookmark = write.headers.get(ACCOUNT_BOOKMARK_HEADER);
  check(
    "a POST sends every statement to the primary and returns the bookmark of its write",
    write.status === 200 &&
      routesOf("write").every((route) => route.instance === "primary") &&
      writeBookmark === replicated.primaryBookmark,
    { bookmark: writeBookmark, routes: routesOf("write") },
  );

  const lagging = await send("read-own-write", "/v1/me", {
    headers: { ...auth, [ACCOUNT_BOOKMARK_HEADER]: writeBookmark ?? "" },
  });
  const laggingNames = await namesOf(lagging);
  check(
    "a GET with the bookmark of a write reads that write while the replica lags",
    laggingNames.length === 2 && laggingNames.every((name) => name === "New name"),
    { names: laggingNames, routes: routesOf("read-own-write") },
  );

  replicated.syncReplica();
  const replicaGet = await send("replica-get", "/v1/me", {
    headers: { ...auth, [ACCOUNT_BOOKMARK_HEADER]: writeBookmark ?? "" },
  });
  const replicaNames = await namesOf(replicaGet);
  check(
    "a GET with a bookmark reads only from the replica when the replica has caught up",
    replicaNames.length === 2 &&
      replicaNames.every((name) => name === "New name") &&
      routesOf("replica-get").every((route) => route.instance === "replica"),
    { routes: routesOf("replica-get") },
  );

  const forged = await send("forged-bookmark", "/v1/me", {
    headers: { ...auth, [ACCOUNT_BOOKMARK_HEADER]: "not-a-bookmark'; DROP TABLE users" },
  });
  check(
    "a GET with an invalid bookmark is served as a GET without a bookmark",
    forged.status === 200 && replicated.sessions.includes("first-primary") && onPrimary("forged-bookmark").length >= 1,
    { routes: routesOf("forged-bookmark") },
  );

  const anonymous = await send("anonymous", "/v1/me");
  check(
    "a response to a request that is not from an account client has no bookmark header",
    anonymous.status === 401 && !anonymous.headers.has(ACCOUNT_BOOKMARK_HEADER),
  );

  await send("second-write", "/v1/me?name=Newest%20name", { method: "POST", headers: auth });
  const [oldReader, newReader] = await Promise.all([
    send("concurrent-old", "/v1/me", { headers: { ...auth, [ACCOUNT_BOOKMARK_HEADER]: writeBookmark ?? "" } }),
    send("concurrent-new", "/v1/me", {
      headers: { ...auth, [ACCOUNT_BOOKMARK_HEADER]: replicated.primaryBookmark },
    }),
  ]);
  const oldNames = await namesOf(oldReader);
  const newNames = await namesOf(newReader);
  check(
    "two requests that run at the same time keep their own D1 session through Effect yields and sleeps",
    oldNames.length === 2 &&
      newNames.length === 2 &&
      oldNames.every((name) => name === "New name") &&
      newNames.every((name) => name === "Newest name"),
    { oldNames, newNames },
  );

  replicated.syncReplica();
  const replicaReadyBookmark = replicated.primaryBookmark;
  replicated.forRequest("other-device-sign-in");
  await DB.prepare(
    "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "other-device",
      "user",
      createHash("sha256").update("other-device-token").digest("base64url"),
      NOW + DAY_MS,
      NOW,
      NOW,
    )
    .run();
  const otherDevice = await send("other-device-get", "/v1/me", {
    headers: { Authorization: "Bearer other-device-token", [ACCOUNT_BOOKMARK_HEADER]: replicaReadyBookmark },
  });
  check(
    "a GET with an older bookmark still accepts a session that another device created while the replica lags",
    otherDevice.status === 200,
    { status: otherDevice.status, routes: routesOf("other-device-get") },
  );

  replicated.forRequest("transferred-sign-in");
  await DB.prepare(
    "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "transferred",
      "user",
      createHash("sha256").update("transferred-token").digest("base64url"),
      NOW + DAY_MS,
      NOW,
      NOW,
    )
    .run();
  const transferred = await send("transferred-get", "/v1/me?primary-session", {
    headers: { Authorization: "Bearer transferred-token", [ACCOUNT_BOOKMARK_HEADER]: replicaReadyBookmark },
  });
  const transferredLookup = routesOf("transferred-get")[0];
  check(
    "a GET whose route checks the session on the primary ignores the bookmark for that check",
    transferred.status === 200 && transferredLookup?.instance === "primary",
    { status: transferred.status, routes: routesOf("transferred-get") },
  );

  const store = {
    first: accountBookmarkHeaders(API),
    afterOld: (() => {
      rememberAccountBookmark(API, new Response(null, { headers: { [ACCOUNT_BOOKMARK_HEADER]: bookmarkAt(9) } }));
      rememberAccountBookmark(API, new Response(null, { headers: { [ACCOUNT_BOOKMARK_HEADER]: bookmarkAt(3) } }));
      return accountBookmarkHeaders(API)[ACCOUNT_BOOKMARK_HEADER];
    })(),
    otherOrigin: accountBookmarkHeaders(OTHER_API),
    afterFailure: (() => {
      rememberAccountBookmark(API, new Response(null, { status: 500 }));
      return accountBookmarkHeaders(API);
    })(),
  };
  check(
    "the client keeps the newest bookmark for each account origin and drops it after a server failure",
    Object.keys(store.first).length === 0 &&
      store.afterOld === bookmarkAt(9) &&
      Object.keys(store.otherOrigin).length === 0 &&
      Object.keys(store.afterFailure).length === 0,
    store,
  );

  const sent: (string | null)[] = [];
  let tokenIssues = 0;
  const throughWorker = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === ACCOUNT_ACCESS_TOKEN_PATH) tokenIssues += 1;
      else sent.push(request.headers.get(ACCOUNT_BOOKMARK_HEADER));
      replicated.forRequest(`client-${sent.length}`);
      return handler.fetch(request, bindings);
    },
    { preconnect: fetch.preconnect },
  );
  const directory = new RemoteTeamDirectoryClient({
    apiUrl: API,
    token: TOKEN,
    fetch: throughWorker,
    verifyHostKeySignature: () => Effect.succeed(false),
  });
  await Effect.runPromise(directory.listHosts());
  const desktopTransport = CentralAuthTransport.layer(throughWorker);
  const desktopWrite = await Effect.runPromise(
    CentralAuthTransport.use((transport) =>
      transport.fetch(new URL("/v1/me?name=Desktop%20name", API), { method: "POST", headers: auth }),
    ).pipe(Effect.provide(desktopTransport)),
  );
  await Effect.runPromise(directory.listHosts());
  const clientRoutes = routesOf(`client-${sent.length}`);
  check(
    "the team client and the desktop transport send the newest bookmark, so a list after a desktop write reads it",
    sent[0] === null &&
      sent[1] !== null &&
      sent[2] === desktopWrite.headers.get(ACCOUNT_BOOKMARK_HEADER) &&
      clientRoutes.some((route) => route.instance === "primary") &&
      tokenIssues === 1,
    { sent, tokenIssues, clientRoutes },
  );

  const passed = checks.every((entry) => entry.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
  if (!passed) {
    for (const entry of checks.filter((item) => !item.passed)) console.log(JSON.stringify(entry.detail, null, 2));
    process.exit(1);
  }
}

await main();
