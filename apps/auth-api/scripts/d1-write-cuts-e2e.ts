import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { getPlatformProxy } from "wrangler";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "d1-write-cuts-e2e");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const SIGNAL_EVENTS_URL = "https://signal.test/internal/auth-events";
const SECRET = "webhook-secret";
const ENTRY_URL = "wss://signal.test/v1/signal";
const HOME_URLS = { au: "wss://signal-au.test/v1/signal", us: "wss://signal-us.test/v1/signal" } as const;
const HOMES = `au=${HOME_URLS.au}, us=${HOME_URLS.us}`;
const HOME_LOCATIONS = "au=-33.87:151.21, us=37.34:-121.89";
const SYDNEY = { latitude: -33.87, longitude: 151.21 };
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/iu;
const DAY_MS = 24 * 60 * 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const EXPIRED_RATE_LIMITS = 2_500;
const LIVE_RATE_LIMITS = 10;
const SCAN_ROWS = 300;

type PlaneModule = typeof import("../src/server/remote-control-plane");
type SiteServerModule = typeof import("../src/server/hosted-site-server");
type RetentionModule = typeof import("../src/server/auth-data-retention");
type SideName = "before" | "after";

interface Statement {
  sql: string;
  rowsRead: number;
  rowsWritten: number;
  changes: number;
}

interface StepSummary {
  queries: number;
  writeQueries: number;
  rowsRead: number;
  rowsWritten: number;
  statements: Statement[];
}

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const steps: Record<string, Record<string, Partial<Record<SideName, StepSummary>>>> = {};
type Fact = string[] | { homeWrites: number; homeUrls: string[]; healthRequests: number };
const facts: Record<string, Partial<Record<SideName, Fact>>> = {};
function fact(name: string, side: SideName, value: Fact) {
  facts[name] = { ...facts[name], [side]: value };
}

function shortSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim().slice(0, 120);
}

class Recorder {
  readonly #statements: Statement[] = [];
  readonly #sources = new WeakMap<D1PreparedStatement, { source: D1PreparedStatement; sql: string }>();

  take(): StepSummary {
    const statements = this.#statements.splice(0);
    return {
      queries: statements.length,
      writeQueries: statements.filter((statement) => WRITE_SQL.test(statement.sql)).length,
      rowsRead: statements.reduce((total, statement) => total + statement.rowsRead, 0),
      rowsWritten: statements.reduce((total, statement) => total + statement.rowsWritten, 0),
      statements,
    };
  }

  #note(sql: string, meta: D1Meta) {
    this.#statements.push({
      sql: shortSql(sql),
      rowsRead: meta.rows_read ?? 0,
      rowsWritten: meta.rows_written ?? 0,
      changes: meta.changes ?? 0,
    });
  }

  #statement(source: D1PreparedStatement, sql: string): D1PreparedStatement {
    const note = (meta: D1Meta) => this.#note(sql, meta);
    const prepared: D1PreparedStatement = {
      bind: (...values: unknown[]) => this.#statement(source.bind(...values), sql),
      async first<T>(column?: string): Promise<T | null> {
        if (column === undefined) {
          const result = await source.all<T>();
          note(result.meta);
          return result.results[0] ?? null;
        }
        const result = await source.all<Record<string, T>>();
        note(result.meta);
        return result.results[0]?.[column] ?? null;
      },
      async all<T>() {
        const result = await source.all<T>();
        note(result.meta);
        return result;
      },
      async run<T>() {
        const result = await source.run<T>();
        note(result.meta);
        return result;
      },
      raw: () => {
        throw new Error("Unused raw");
      },
    };
    this.#sources.set(prepared, { source, sql });
    return prepared;
  }

  #batch(target: D1Database | D1DatabaseSession) {
    return async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
      const known = statements.map((statement) => this.#sources.get(statement));
      const results = await target.batch<T>(statements.map((statement, index) => known[index]?.source ?? statement));
      for (const [index, result] of results.entries()) this.#note(known[index]?.sql ?? "?", result.meta);
      return results;
    };
  }

  wrap(database: D1Database): D1Database {
    return {
      prepare: (sql) => this.#statement(database.prepare(sql), sql),
      batch: this.#batch(database),
      exec: (sql) => database.exec(sql),
      withSession: (constraint) => {
        const session = database.withSession(constraint);
        return {
          prepare: (sql: string) => this.#statement(session.prepare(sql), sql),
          batch: this.#batch(session),
          getBookmark: () => session.getBookmark(),
        };
      },
      dump: () => database.dump(),
    };
  }
}

function writesTo(summary: StepSummary, table: string): Statement[] {
  return summary.statements.filter(
    (statement) => WRITE_SQL.test(statement.sql) && new RegExp(`\\b${table}\\b`, "u").test(statement.sql),
  );
}

async function resetDirectory(path: string) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

const base = process.argv.find((argument) => argument.startsWith("--before="))?.slice("--before=".length) ?? null;
const head = (await run("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
const beforeRoot = join(OUT, "before");
await resetDirectory(OUT);

async function extractBefore(commit: string) {
  await mkdir(beforeRoot, { recursive: true });
  const archive = join(OUT, "before.tar");
  await run(
    "git",
    ["archive", "--format=tar", "-o", archive, commit, "apps/auth-api/src", "apps/auth-api/migrations"],
    { cwd: ROOT },
  );
  await run("tar", ["-xf", archive, "-C", beforeRoot]);
  await rm(archive);
}

const ticketKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const ticketKeys = {
  REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
    ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.privateKey)),
    kid: "ticket-1",
  }),
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
    keys: [{ ...(await crypto.subtle.exportKey("jwk", ticketKeyPair.publicKey)), kid: "ticket-1" }],
  }),
  REMOTE_TICKET_KEY_ID: "ticket-1",
};

async function localDatabase(side: SideName, migrations: string) {
  const work = join(OUT, `${side}-d1`);
  await resetDirectory(work);
  const state = join(work, "state");
  const config = join(work, "wrangler.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      name: `d1-write-cuts-${side}`,
      compatibility_date: "2026-08-18",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [
        {
          binding: "DB",
          database_name: "openbot-auth",
          database_id: `d1-write-cuts-${side}`,
          migrations_dir: migrations,
        },
      ],
    }),
  );
  await run(WRANGLER, ["d1", "migrations", "apply", "openbot-auth", "--local", "--persist-to", state, "-c", config], {
    cwd: work,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return getPlatformProxy<{ DB: D1Database }>({
    configPath: config,
    persist: { path: join(state, "v3") },
    envFiles: [],
  });
}

async function runSide(side: SideName, authRoot: string) {
  const proxy = await localDatabase(side, join(authRoot, "migrations"));
  const d1 = proxy.env.DB;
  const planeModule: PlaneModule = await import(join(authRoot, "src/server/remote-control-plane.ts"));
  const siteModule: SiteServerModule = await import(join(authRoot, "src/server/hosted-site-server.ts"));
  const retention: RetentionModule = await import(join(authRoot, "src/server/auth-data-retention.ts"));
  const recorder = new Recorder();
  const database = recorder.wrap(d1);
  let clock = Date.UTC(2026, 10, 28, 12);
  const signalBodies: string[] = [];
  const healthRequests: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === SIGNAL_EVENTS_URL) {
      signalBodies.push(String(init?.body));
      return new Response(null, { status: 204 });
    }
    if (new URL(url).pathname === "/health/ready") {
      healthRequests.push(url);
      return new Response("{}", { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const plane = new planeModule.RemoteControlPlane(
    {
      DB: database,
      ...ticketKeys,
      REMOTE_AUTH_WEBHOOK_URL: SIGNAL_EVENTS_URL,
      REMOTE_AUTH_WEBHOOK_SECRET: SECRET,
      REMOTE_SIGNAL_URL: ENTRY_URL,
      REMOTE_SIGNAL_HOMES: HOMES,
      REMOTE_SIGNAL_HOME_LOCATIONS: HOME_LOCATIONS,
    },
    { now: () => clock, fetch },
  );
  const step = async <A>(scenario: string, name: string, operation: () => Promise<A>): Promise<A> => {
    recorder.take();
    clock += 1_000;
    const result = await operation();
    const scenarioSteps = steps[scenario] ?? {};
    steps[scenario] = scenarioSteps;
    scenarioSteps[name] = { ...scenarioSteps[name], [side]: recorder.take() };
    return result;
  };
  const summary = (scenario: string, name: string): StepSummary => {
    const found = steps[scenario]?.[name]?.[side];
    if (!found) throw new Error(`Missing step ${scenario} ${name}`);
    return found;
  };

  await d1
    .prepare(
      "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES ('owner', 'email:owner', 'owner@example.test', 'Owner', 1, 1)",
    )
    .run();
  const user = {
    id: "owner",
    email: "owner@example.test",
    name: "Owner",
    avatarUrl: null,
    analyticsEnabled: null,
    chatColor: null,
  };

  const register = (input: { name: string; rotateCredential: boolean; machineToken?: string; hostId?: string }) =>
    Effect.runPromise(
      plane.registerHost(user, {
        hostId: input.hostId ?? "host-1",
        name: input.name,
        ownerMembershipId: `${input.hostId ?? "host-1"}:owner`,
        devicePublicKey: "device-key",
        rotateCredential: input.rotateCredential,
        ...(input.machineToken ? { machineToken: input.machineToken } : {}),
      }),
    );
  const first = await step("registerHost", "1 first registration", () =>
    register({ name: "Office", rotateCredential: true }),
  );
  const token = first.machineToken ?? "";
  const sentBeforeSame = signalBodies.length;
  await step("registerHost", "2 same name and key", () =>
    register({ name: "Office", rotateCredential: false, machineToken: token }),
  );
  await step("registerHost", "3 new name", () =>
    register({ name: "Office 2", rotateCredential: false, machineToken: token }),
  );
  const sentAfterMetadata = signalBodies.length;
  const epochBefore = await d1
    .prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = 'host-1'")
    .first<number>("auth_epoch");
  const rotated = await step("registerHost", "4 rotate credential", () =>
    register({ name: "Office 2", rotateCredential: true }),
  );
  const sentAfterRotate = signalBodies.length;
  await step("registerHost", "5 rotate credential again", () => register({ name: "Office 2", rotateCredential: true }));
  const epochAfter = await d1
    .prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = 'host-1'")
    .first<number>("auth_epoch");
  const outbox = await d1
    .prepare("SELECT COUNT(*) AS count FROM remote_auth_events WHERE next_attempt_at < ?")
    .bind(Number.MAX_SAFE_INTEGER)
    .first<number>("count");
  const host = await d1
    .prepare("SELECT name, device_public_key FROM remote_hosts WHERE host_id = 'host-1'")
    .first<{ name: string; device_public_key: string }>();
  const membership = await d1
    .prepare("SELECT role, status FROM remote_memberships WHERE host_id = 'host-1' AND user_id = 'owner'")
    .first<{ role: string; status: string }>();

  const same = summary("registerHost", "2 same name and key");
  const renamed = summary("registerHost", "3 new name");
  const rotate = summary("registerHost", "4 rotate credential");
  const rotateAgain = summary("registerHost", "5 rotate credential again");
  if (side === "after") {
    check("after: a registration with no change writes nothing", same.writeQueries === 0 && same.rowsWritten === 0, {
      writeQueries: same.writeQueries,
      rowsWritten: same.rowsWritten,
    });
    check(
      "after: a new name writes only the host row",
      writesTo(renamed, "remote_hosts").length === 1 && writesTo(renamed, "remote_memberships").length === 0,
      renamed.statements.filter((statement) => WRITE_SQL.test(statement.sql)),
    );
    check(
      "after: a rotation does not rewrite the active owner membership",
      writesTo(rotate, "remote_memberships").every((statement) => statement.changes === 0),
      writesTo(rotate, "remote_memberships"),
    );
    check(
      "after: each auth epoch event takes 2 outbox writes (insert, delivered mark)",
      writesTo(rotate, "remote_auth_events").length === 2 && writesTo(rotateAgain, "remote_auth_events").length === 2,
      { rotate: writesTo(rotate, "remote_auth_events"), again: writesTo(rotateAgain, "remote_auth_events") },
    );
  }
  check(`${side}: the metadata steps send no auth event`, sentAfterMetadata === sentBeforeSame, {
    sent: sentAfterMetadata - sentBeforeSame,
  });
  check(
    `${side}: each rotation sends one auth epoch event`,
    sentAfterRotate - sentAfterMetadata === 1 && signalBodies.length - sentAfterRotate === 1,
    {
      bodies: signalBodies.slice(sentAfterMetadata),
    },
  );
  check(`${side}: the rotations raise the auth epoch by 2`, Number(epochAfter) - Number(epochBefore) === 2, {
    epochBefore,
    epochAfter,
  });
  check(`${side}: no event waits for delivery after delivery`, Number(outbox) === 0, { outbox });
  check(
    `${side}: the host keeps the new name and key, and the owner stays active`,
    host?.name === "Office 2" &&
      host.device_public_key === "device-key" &&
      membership?.role === "owner" &&
      membership.status === "active" &&
      rotated.machineToken !== null,
    { host, membership },
  );

  const signalHost = "host-signal";
  const signalFirst = await register({ hostId: signalHost, name: "Signal host", rotateCredential: true });
  const signalToken = signalFirst.machineToken ?? "";
  const homeUrls: string[] = [];
  let failed: string | null = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const answer = await step("signalHome", `${attempt} host ticket`, () =>
      Effect.runPromise(
        plane.issueHostTicket(signalHost, signalToken, {
          signalHome: true,
          failedSignalUrl: failed,
          location: SYDNEY,
        }),
      ),
    );
    homeUrls.push(answer.signalUrl);
    failed = answer.signalUrl === HOME_URLS.au ? HOME_URLS.au : null;
  }
  const homeWrites = Object.values(steps.signalHome ?? {}).reduce((total, sides) => {
    const sideSteps = sides[side];
    return total + (sideSteps ? writesTo(sideSteps, "remote_hosts").filter((entry) => entry.changes > 0).length : 0);
  }, 0);
  fact("signal home writes in 6 tickets", side, { homeWrites, homeUrls, healthRequests: healthRequests.length });
  if (side === "before") {
    check(
      "before: a Sydney host that cannot reach the Sydney home moves back and forth on each ticket",
      homeWrites === 6,
      {
        homeWrites,
        homeUrls,
      },
    );
  } else {
    check(
      "after: the Sydney host stays on the San Jose home for the hold and writes the home 2 times",
      homeWrites === 2 && homeUrls.slice(1).every((url) => url === HOME_URLS.us),
      { homeWrites, homeUrls },
    );
  }

  const site = (id: string, serverId: string | null) =>
    d1
      .prepare(
        `INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, status, created_at, updated_at,
           expires_at, server_id)
         VALUES (?, 'owner', ?, 'Site', '', 'vanilla', 'active', 1, 1, ?, ?)`,
      )
      .bind(id, `${id}.example`, clock + DAY_MS, serverId)
      .run();
  const adopted = [];
  adopted.push(
    await step("adoptUnlinkedSites", "1 no unlinked site", () =>
      Effect.runPromise(siteModule.adoptUnlinkedHostedSites(database, "owner", "host-1", clock)),
    ),
  );
  await site("unlinked-site", null);
  adopted.push(
    await step("adoptUnlinkedSites", "2 one unlinked site", () =>
      Effect.runPromise(siteModule.adoptUnlinkedHostedSites(database, "owner", "host-1", clock)),
    ),
  );
  const adoptedServer = await d1
    .prepare("SELECT server_id FROM hosted_sites WHERE id = 'unlinked-site'")
    .first<string>("server_id");
  const noSite = summary("adoptUnlinkedSites", "1 no unlinked site");
  check(
    `${side}: the adopt links the unlinked site and only that one`,
    adopted[0] === 0 && adopted[1] === 1 && adoptedServer === "host-1",
    { adopted, adoptedServer },
  );
  if (side === "after") {
    check(
      "after: with no unlinked site the adopt sends 1 replica read and no write",
      noSite.queries === 1 && noSite.writeQueries === 0,
      noSite.statements,
    );
  }

  const rateLimit = (key: string, windowStart: number) =>
    d1
      .prepare("INSERT INTO auth_rate_limits(key_hash, window_start, attempts) VALUES (?, ?, 1)")
      .bind(key, windowStart);
  const released: Partial<Pick<RetentionModule, "pruneExpiredRateLimits">> &
    Pick<RetentionModule, "pruneExpiredAuthData"> = retention;
  const pruneRateLimits = () =>
    released.pruneExpiredRateLimits
      ? Effect.runPromise(released.pruneExpiredRateLimits(database, clock)).then(() => undefined)
      : Effect.runPromise(released.pruneExpiredAuthData(database, clock)).then(() => undefined);
  await step("rateLimitRetention", "1 no expired rows", pruneRateLimits);
  const expiredAt = clock - 2 * RATE_LIMIT_WINDOW_MS;
  const inserts = Array.from({ length: EXPIRED_RATE_LIMITS }, (_, index) => rateLimit(`expired-${index}`, expiredAt));
  for (let index = 0; index < LIVE_RATE_LIMITS; index += 1) inserts.push(rateLimit(`live-${index}`, clock));
  for (let offset = 0; offset < inserts.length; offset += 500) await d1.batch(inserts.slice(offset, offset + 500));
  await step("rateLimitRetention", "2 expired rows", pruneRateLimits);
  await step("rateLimitRetention", "3 daily retention", () =>
    Effect.runPromise(retention.pruneExpiredAuthData(database, clock)).then(() => undefined),
  );
  const left = await d1.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits").first<number>("count");
  const expiredRun = summary("rateLimitRetention", "2 expired rows");
  const rateDeletes = writesTo(expiredRun, "auth_rate_limits");
  check(
    `${side}: retention deletes every expired rate limit row and keeps the live window`,
    Number(left) === LIVE_RATE_LIMITS,
    {
      left,
    },
  );
  if (side === "after") {
    check(
      "after: the tick deletes expired rate limits in chunks of at most 1000 rows",
      rateDeletes.length === 3 && rateDeletes.every((statement) => statement.changes <= 1_000),
      rateDeletes,
    );
    check(
      "after: the daily retention batch does not touch auth_rate_limits",
      writesTo(summary("rateLimitRetention", "3 daily retention"), "auth_rate_limits").length === 0,
    );
  }

  const scanSeed: D1PreparedStatement[] = [];
  for (let index = 0; index < SCAN_ROWS; index += 1) {
    scanSeed.push(
      d1
        .prepare(
          `INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, status, created_at, updated_at,
             expires_at, current_deployment_id)
           VALUES (?, 'other', ?, 'Site', '', 'vanilla', 'active', 1, 1, ?, ?)`,
        )
        .bind(`scan-site-${index}`, `scan-${index}.example`, clock + DAY_MS, `scan-live-${index}`),
      d1
        .prepare(
          `INSERT INTO site_deployments(id, site_id, user_id, status, file_count, total_bytes, manifest_json, site_title,
             site_description, site_framework, site_spa_fallback, idempotency_key, request_hash, created_at,
             upload_expires_at)
           VALUES (?, ?, 'other', ?, 1, 1, '[]', 'Site', '', 'vanilla', 0, ?, 'hash', 1, ?)`,
        )
        .bind(
          `scan-live-${index}`,
          `scan-site-${index}`,
          index === 0 ? "activating" : "active",
          `live-${index}`,
          clock,
        ),
      d1
        .prepare(
          `INSERT INTO site_deployments(id, site_id, user_id, status, file_count, total_bytes, manifest_json, site_title,
             site_description, site_framework, site_spa_fallback, idempotency_key, request_hash, created_at,
             upload_expires_at)
           VALUES (?, ?, 'other', 'uploading', 1, 1, '[]', 'Site', '', 'vanilla', 0, ?, 'hash', 2, ?)`,
        )
        .bind(`scan-upload-${index}`, `scan-site-${index}`, `upload-${index}`, clock + DAY_MS),
      d1
        .prepare("INSERT INTO account_active_days(day, account_id) VALUES (?, 'other')")
        .bind(`day-${String(index).padStart(4, "0")}`),
      d1
        .prepare("INSERT INTO billing_webhook_events(event_id, type, received_at) VALUES (?, 'invoice.paid', ?)")
        .bind(`evt-${index}`, clock),
    );
  }
  await d1
    .prepare(
      "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES ('other', 'email:other', 'other@example.test', 'Other', 1, 1)",
    )
    .run();
  await d1
    .prepare(
      `INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, status, created_at, updated_at,
         expires_at)
       VALUES ('upload-site', 'owner', 'upload-site.example', 'Site', '', 'vanilla', 'uploading', 1, 1, ?)`,
    )
    .bind(clock + DAY_MS)
    .run();
  for (let offset = 0; offset < scanSeed.length; offset += 500) await d1.batch(scanSeed.slice(offset, offset + 500));
  const room = siteModule.bucketHasRoomSql({ kind: "unlinked", limit: 3 }, "owner", null, clock);
  const scans = {
    supersede: {
      sql: `UPDATE site_deployments SET status = 'superseded'
           WHERE site_id = ? AND id != ? AND status = 'active'
             AND EXISTS (SELECT 1 FROM site_deployments WHERE id = ? AND status = 'activating')
             AND EXISTS (
               SELECT 1 FROM hosted_sites WHERE id = ? AND user_id = ? AND status = 'active'
                 AND current_deployment_id = ?
             )`,
      binds: ["scan-site-0", "scan-live-0", "scan-live-0", "scan-site-0", "other", "scan-live-0"],
      index: "site_deployments_site_status",
    },
    siteSlots: {
      sql: `SELECT ${room.sql} AS room`,
      binds: room.binds,
      index: "site_deployments_site_status",
    },
    activeDays: {
      sql: "DELETE FROM account_active_days WHERE account_id = ?",
      binds: ["owner"],
      index: "account_active_days_account",
    },
    webhookRetention: {
      sql: "DELETE FROM billing_webhook_events WHERE received_at < ?",
      binds: [clock - 7 * DAY_MS],
      index: "billing_webhook_events_received_at",
    },
  };
  for (const [name, scan] of Object.entries(scans)) {
    const plan = await d1
      .prepare(`EXPLAIN QUERY PLAN ${scan.sql}`)
      .bind(...scan.binds)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);
    await step("scans", name, () =>
      database
        .prepare(scan.sql)
        .bind(...scan.binds)
        .run(),
    );
    const result = summary("scans", name);
    fact(`${name} query plan`, side, details);
    const usesIndex = details.some((detail) => detail.includes(scan.index));
    if (side === "after") {
      check(`after: ${name} uses ${scan.index} and reads fewer than 20 rows`, usesIndex && result.rowsRead < 20, {
        details,
        rowsRead: result.rowsRead,
      });
    } else {
      check(`before: ${name} reads at least ${SCAN_ROWS} rows`, !usesIndex && result.rowsRead >= SCAN_ROWS, {
        details,
        rowsRead: result.rowsRead,
      });
    }
  }
  await proxy.dispose();
}

if (base) {
  await extractBefore(base);
  await runSide("before", join(beforeRoot, "apps", "auth-api"));
}
await runSide("after", join(ROOT, "apps", "auth-api"));

const comparison = Object.entries(steps).flatMap(([scenario, scenarioSteps]) =>
  Object.entries(scenarioSteps).map(([name, sides]) => ({
    scenario,
    step: name,
    before: sides.before && {
      queries: sides.before.queries,
      writeQueries: sides.before.writeQueries,
      rowsRead: sides.before.rowsRead,
      rowsWritten: sides.before.rowsWritten,
    },
    after: sides.after && {
      queries: sides.after.queries,
      writeQueries: sides.after.writeQueries,
      rowsRead: sides.after.rowsRead,
      rowsWritten: sides.after.rowsWritten,
    },
  })),
);
const failed = checks.filter((entry) => !entry.passed);
const report = { base, head, passed: failed.length === 0, checks, comparison, facts, steps };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const entry of comparison) {
  const cell = (side?: { queries: number; writeQueries: number; rowsRead: number; rowsWritten: number }) =>
    side ? `${side.queries}q ${side.writeQueries}w ${side.rowsRead}r ${side.rowsWritten}rw` : "-";
  console.log(`${entry.scenario} | ${entry.step} | before ${cell(entry.before)} | after ${cell(entry.after)}`);
}
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (failed.length > 0) process.exit(1);
