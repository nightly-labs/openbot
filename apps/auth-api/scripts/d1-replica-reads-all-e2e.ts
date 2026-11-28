import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ACCOUNT_BOOKMARK_HEADER } from "@openbot/contracts/account-bookmark";
import { CREDIT_MEDIA_REQUEST_PART } from "@openbot/contracts/credit-media";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { plugin } from "bun";
import { getPlatformProxy } from "wrangler";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const SCRIPT = resolve(import.meta.filename);
const OUT_DIR = join(ROOT, ".openbot-build", "d1-replica-reads-all-e2e");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const API = "https://account.openbot.test";
const GATEWAY = "https://openbot-media-gateway.internal";
const REQUESTS_PER_TYPE = 10;
const DAY_MS = 86_400_000;
const NOW = Date.now();
const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/iu;
const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT)\b/iu;
const OWNER_TOKEN = "owner-session-token-0001";
const MEMBER_TOKEN = "member-session-token-0001";
const HOST_ID = "host-1";
const HOST_TOKEN = "host-machine-token-0001";
const SESSION_ID = "remote-session-1";
const WEBHOOK_SECRET = "remote-webhook-secret";
const LIVE_ACTIVITY_TOKEN = "a".repeat(64);
const PRODUCTION_REQUESTS_2026_11_27: Record<string, number> = {
  "Signal session ticket": 16_180,
  "host list": 7_877,
  "owner transfers": 5_612,
  "live activity": 3_986,
  "validate-batch": 3_533,
  "hosting servers": 2_725,
  "host ticket": 2_384,
  credits: 2_313,
  me: 2_308,
  "member list": 1_078,
  "host registration": 828,
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

type Instance = "primary" | "replica";
type Constraint = "none" | "first-primary" | "first-unconstrained" | "bookmark";

interface Statement {
  type: string;
  sql: string;
  constraint: Constraint;
  instance: Instance;
  write: boolean;
  ms: number;
}

interface TypeSummary {
  requests: number;
  statusCodes: Record<string, number>;
  primaryStatements: number;
  replicaStatements: number;
  primaryReads: number;
  writes: number;
  primaryMs: number;
  replicaMs: number;
  primaryTimeShare: number;
  constraints: Record<string, number>;
  primaryReadSql: Record<string, number>;
}

interface RunReport {
  source: string;
  passed: boolean;
  requestsPerType: number;
  types: Record<string, TypeSummary>;
  weighted: { primaryStatementShare: number; primaryTimeShare: number; types: string[] };
  checks: { name: string; passed: boolean; detail?: unknown }[];
}

if (argument("before") !== null) await compare(argument("before") ?? "");
else await measure();

async function compare(before: string) {
  const sha = (await run("git", ["rev-parse", "--verify", `${before}^{commit}`], { cwd: ROOT })).stdout.trim();
  const tree = join(OUT_DIR, "before", sha);
  await rm(tree, { recursive: true, force: true });
  await mkdir(tree, { recursive: true });
  const archive = join(tree, "source.tar");
  await run(
    "git",
    [
      "archive",
      "--format=tar",
      "-o",
      archive,
      sha,
      "apps/auth-api/src",
      "apps/auth-api/migrations",
      "apps/auth-api/tsconfig.json",
      "apps/site-router",
      "CHANGELOG.md",
      "package.json",
      "apps/mobile/CHANGELOG.md",
    ],
    { cwd: ROOT },
  );
  await run("tar", ["-xf", archive, "-C", tree]);
  const beforeReport = join(tree, "report.json");
  const afterReport = join(OUT_DIR, "after-report.json");
  const child = async (source: string, out: string) => {
    const result = await run(process.execPath, [SCRIPT, `--source=${source}`, `--out=${out}`], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }).catch((error: { stdout?: string; stderr?: string }) => error);
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const parsed: RunReport = JSON.parse(await readFile(out, "utf8"));
    return parsed;
  };
  const baseline = await child(join(tree, "apps", "auth-api"), beforeReport);
  const current = await child(join(ROOT, "apps", "auth-api"), afterReport);
  const types = Object.keys(current.types);
  const table = types.map((type) => {
    const was = baseline.types[type];
    const now = current.types[type];
    return {
      type,
      before: was
        ? { primary: was.primaryStatements, replica: was.replicaStatements, primaryTimeShare: was.primaryTimeShare }
        : null,
      after: now
        ? { primary: now.primaryStatements, replica: now.replicaStatements, primaryTimeShare: now.primaryTimeShare }
        : null,
    };
  });
  const report = {
    passed: current.passed,
    before: { commit: sha, weighted: baseline.weighted, passed: baseline.passed },
    after: { weighted: current.weighted, passed: current.passed },
    requestsPerType: current.requestsPerType,
    table,
  };
  const path = join(OUT_DIR, "comparison.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log("");
  console.log(`type | before primary/replica (primary time) | after primary/replica (primary time)`);
  for (const row of table)
    console.log(
      `${row.type} | ${row.before ? `${row.before.primary}/${row.before.replica} (${percent(row.before.primaryTimeShare)})` : "-"} | ${row.after ? `${row.after.primary}/${row.after.replica} (${percent(row.after.primaryTimeShare)})` : "-"}`,
    );
  console.log(
    `weighted by the 2026-11-27 route mix: primary time ${percent(baseline.weighted.primaryTimeShare)} -> ${percent(current.weighted.primaryTimeShare)}, primary statements ${percent(baseline.weighted.primaryStatementShare)} -> ${percent(current.weighted.primaryStatementShare)}`,
  );
  console.log(`Report: ${path}`);
  if (!report.passed) process.exitCode = 1;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function measure() {
  const SOURCE = resolve(argument("source") ?? join(ROOT, "apps", "auth-api"));
  const REPORT = resolve(argument("out") ?? join(OUT_DIR, "report.json"));
  const MIGRATIONS = join(SOURCE, "migrations");
  const checks: RunReport["checks"] = [];
  const check = (name: string, passed: boolean, detail?: unknown) => {
    checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  };

  const work = await mkdtemp(join(tmpdir(), "d1-replica-reads-all-e2e-"));
  const state = join(work, "state");
  const config = join(work, "wrangler.jsonc");
  const databases = [
    { binding: "PRIMARY", database_name: "openbot-auth-primary", database_id: "primary-e2e" },
    { binding: "REPLICA", database_name: "openbot-auth-replica", database_id: "replica-e2e" },
  ];
  await writeFile(
    config,
    JSON.stringify({
      name: "d1-replica-reads-all-e2e",
      compatibility_date: "2026-08-18",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: databases.map((database) => ({ ...database, migrations_dir: MIGRATIONS })),
    }),
  );
  const wranglerEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  for (const database of databases)
    await run(
      WRANGLER,
      ["d1", "migrations", "apply", database.database_name, "--local", "--persist-to", state, "-c", config],
      { cwd: work, env: wranglerEnv, maxBuffer: 64 * 1024 * 1024 },
    );
  const proxy = await getPlatformProxy<{ PRIMARY: D1Database; REPLICA: D1Database }>({
    configPath: config,
    persist: { path: join(state, "v3") },
    envFiles: [],
  });
  const primary = proxy.env.PRIMARY;
  const replica = proxy.env.REPLICA;

  interface Write {
    sql: string;
    values: unknown[];
  }

  interface World {
    primaryVersion: number;
    replicaVersion: number;
    lag: boolean;
    pending: Write[][];
    type: string;
    statements: Statement[];
  }

  const world: World = {
    primaryVersion: 1,
    replicaVersion: 1,
    lag: false,
    pending: [],
    type: "setup",
    statements: [],
  };

  async function replay(group: Write[]) {
    await replica.batch(group.map((entry) => replica.prepare(entry.sql).bind(...entry.values)));
  }

  async function wrote(group: Write[]) {
    world.primaryVersion += 1;
    if (world.lag) {
      world.pending.push(group);
      return;
    }
    await replay(group);
    world.replicaVersion = world.primaryVersion;
  }

  async function catchUp() {
    for (const group of world.pending.splice(0)) await replay(group);
    world.replicaVersion = world.primaryVersion;
  }

  function isReadOnly(sql: string): boolean {
    return READ_ONLY_SQL.test(sql) && !WRITE_KEYWORD.test(sql);
  }

  function bookmarkAt(version: number): string {
    return `${version.toString(16).padStart(8, "0")}-00000000-00000000-${"0".repeat(32)}`;
  }

  function versionOf(bookmark: string): number {
    return Number.parseInt(bookmark.slice(0, 8), 16);
  }

  interface Router {
    constraint: Constraint;
    pick(write: boolean): Instance;
    reached(instance: Instance): void;
  }

  function record(sql: string, router: Router, instance: Instance, write: boolean, ms: number) {
    world.statements.push({
      type: world.type,
      sql: sql.trim().replace(/\s+/gu, " "),
      constraint: router.constraint,
      instance,
      write,
      ms,
    });
  }

  class RecordedStatement implements D1PreparedStatement {
    constructor(
      readonly sql: string,
      readonly values: unknown[],
      readonly router: Router,
    ) {}

    bind(...values: unknown[]): D1PreparedStatement {
      return new RecordedStatement(this.sql, values, this.router);
    }

    async #execute<T>(call: (prepared: D1PreparedStatement) => Promise<T>): Promise<T> {
      const write = !isReadOnly(this.sql);
      const instance = this.router.pick(write);
      const database = instance === "primary" ? primary : replica;
      const started = performance.now();
      const result = await call(database.prepare(this.sql).bind(...this.values));
      record(this.sql, this.router, instance, write, performance.now() - started);
      if (write) await wrote([{ sql: this.sql, values: this.values }]);
      this.router.reached(instance);
      return result;
    }

    first<T>(column?: string): Promise<T | null> {
      return this.#execute((prepared) => (column === undefined ? prepared.first<T>() : prepared.first<T>(column)));
    }

    all<T>(): Promise<D1Result<T>> {
      return this.#execute((prepared) => prepared.all<T>());
    }

    run<T>(): Promise<D1Result<T>> {
      return this.#execute((prepared) => prepared.run<T>());
    }

    raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
      if (options?.columnNames) return this.#execute((prepared) => prepared.raw<T>({ columnNames: true }));
      return this.#execute((prepared) => prepared.raw<T>());
    }
  }

  async function batch<T>(router: Router, statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const recorded = statements.map((statement) => {
      if (!(statement instanceof RecordedStatement)) throw new Error("A batch has a statement from another database");
      return statement;
    });
    const writes = recorded.filter((statement) => !isReadOnly(statement.sql));
    const instance = router.pick(writes.length > 0);
    const database = instance === "primary" ? primary : replica;
    const started = performance.now();
    const result = await database.batch<T>(
      recorded.map((statement) => database.prepare(statement.sql).bind(...statement.values)),
    );
    const ms = (performance.now() - started) / Math.max(1, recorded.length);
    for (const statement of recorded) record(statement.sql, router, instance, !isReadOnly(statement.sql), ms);
    if (writes.length > 0) await wrote(writes.map((statement) => ({ sql: statement.sql, values: statement.values })));
    router.reached(instance);
    return result;
  }

  function sessionRouter(constraintOrBookmark: string): Router & { bookmark(): string | null } {
    const constraint: Constraint =
      constraintOrBookmark === "first-primary" || constraintOrBookmark === "first-unconstrained"
        ? constraintOrBookmark
        : "bookmark";
    let reached = constraint === "bookmark" ? versionOf(constraintOrBookmark) : null;
    let first = true;
    return {
      constraint,
      pick(write) {
        if (write) return "primary";
        if (constraint === "first-primary" && first) return "primary";
        if (reached === null) return "replica";
        return world.replicaVersion >= reached ? "replica" : "primary";
      },
      reached(instance) {
        first = false;
        const version = instance === "primary" ? world.primaryVersion : world.replicaVersion;
        reached = Math.max(reached ?? 0, version);
      },
      bookmark: () => (reached === null ? null : bookmarkAt(reached)),
    };
  }

  const rawRouter: Router = { constraint: "none", pick: () => "primary", reached: () => undefined };

  const DB: D1Database = {
    prepare: (sql) => new RecordedStatement(sql, [], rawRouter),
    batch: (statements) => batch(rawRouter, statements),
    exec: () => Promise.reject(new Error("exec is not used by the Worker")),
    withSession: (constraintOrBookmark) => {
      const router = sessionRouter(constraintOrBookmark ?? "first-unconstrained");
      return {
        prepare: (sql) => new RecordedStatement(sql, [], router),
        batch: (statements) => batch(router, statements),
        getBookmark: () => router.bookmark(),
      };
    },
    dump: () => Promise.reject(new Error("dump is not used by the Worker")),
  };

  async function seed(sql: string, ...values: unknown[]) {
    await primary
      .prepare(sql)
      .bind(...values)
      .run();
    await replica
      .prepare(sql)
      .bind(...values)
      .run();
  }

  async function primaryOnly(sql: string, ...values: unknown[]) {
    await primary
      .prepare(sql)
      .bind(...values)
      .run();
    await wrote([{ sql, values }]);
  }

  function tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }

  const ticketKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const apnsKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const apnsPkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", apnsKeys.privateKey)).toString("base64");
  const bucket = { get: async () => null, put: async () => null, delete: async () => undefined };
  const limiter = { limit: async () => ({ success: true }) };
  const gatewayJobs: string[] = [];
  const MEDIA_GATEWAY = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin !== GATEWAY) return Response.json({ error: { code: "wrong_origin" } }, { status: 421 });
      if (url.pathname === "/v1/models")
        return Response.json({ models: [{ id: "image-one", upstream: "router", specs: {} }] });
      if (url.pathname === "/v1/jobs" && init?.method === "POST") {
        const id = `router-job-${gatewayJobs.length + 1}`;
        gatewayJobs.push(id);
        return Response.json({ upstream: "router", id, status: "queued", pollAfterSeconds: 3 });
      }
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    },
  };
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
    LIVE_ACTIVITY_RATE_LIMITER: limiter,
    MEDIA_GATEWAY,
    AUTH_EXPOSE_DEVELOPMENT_CODE: "true",
    REMOTE_SIGNAL_URL: "wss://signal.openbot.test",
    REMOTE_AUTH_WEBHOOK_SECRET: WEBHOOK_SECRET,
    REMOTE_TICKET_KEY_ID: "ticket-1",
    REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
      ...(await crypto.subtle.exportKey("jwk", ticketKeys.privateKey)),
      kid: "ticket-1",
    }),
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
      keys: [{ ...(await crypto.subtle.exportKey("jwk", ticketKeys.publicKey)), kid: "ticket-1" }],
    }),
    STRIPE_SECRET_KEY: "sk_test_d1_replica_reads",
    HOSTED_SERVERS_ENABLED: "true",
    HOSTED_SERVER_TEMPLATE: "tpl_1",
    BOAT_API_KEY: "boat-key",
    BOAT_WEBHOOK_SECRET: "boat-webhook-secret",
    APNS_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${apnsPkcs8}\n-----END PRIVATE KEY-----`,
    APNS_KEY_ID: "KEY1234567",
    APNS_TEAM_ID: "TEAM123456",
    APNS_TOPIC: "run.openbot.app",
  };

  const outbound: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      outbound.push(new URL(url).host);
      if (url.startsWith("https://api.stripe.com/"))
        return Response.json({ object: "list", data: [], has_more: false, url: "/v1/prices" });
      return Response.json({});
    },
    { preconnect: () => undefined },
  );

  const background: Promise<unknown>[] = [];
  plugin({
    name: "worker-route-modules",
    setup(build) {
      build.module("cloudflare:workers", () => ({
        exports: {
          env,
          waitUntil: (promise: Promise<unknown>) => {
            background.push(promise.catch(() => undefined));
          },
        },
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
  const ROUTES: [method: string, pattern: RegExp, file: string, params: string[]][] = [
    ["GET", /^\/v1\/me$/u, "v1/me.ts", []],
    ["GET", /^\/v1\/me\/credits\/?$/u, "v1/me/credits/index.ts", []],
    ["GET", /^\/v2\/remote\/hosts\/?$/u, "v2/remote/hosts/index.ts", []],
    ["GET", /^\/v2\/remote\/owner-transfers\/?$/u, "v2/remote/owner-transfers/index.ts", []],
    ["GET", /^\/v2\/hosting\/servers\/?$/u, "v2/hosting/servers/index.ts", []],
    ["GET", /^\/v2\/hosting\/servers\/([^/]+)\/status$/u, "v2/hosting/servers/$serverId/status.ts", ["serverId"]],
    ["GET", /^\/v2\/remote\/hosts\/([^/]+)\/members\/?$/u, "v2/remote/hosts/$hostId/members/index.ts", ["hostId"]],
    ["POST", /^\/v2\/remote\/sessions\/([^/]+)\/ticket$/u, "v2/remote/sessions/$sessionId/ticket.ts", ["sessionId"]],
    ["POST", /^\/v2\/remote\/hosts\/register$/u, "v2/remote/hosts/register.ts", []],
    ["POST", /^\/v2\/remote\/hosts\/([^/]+)\/ticket$/u, "v2/remote/hosts/$hostId/ticket.ts", ["hostId"]],
    ["POST", /^\/v2\/remote\/hosts\/([^/]+)\/live-activity$/u, "v2/remote/hosts/$hostId/live-activity.ts", ["hostId"]],
    ["POST", /^\/v2\/remote\/hosts\/([^/]+)\/invites$/u, "v2/remote/hosts/$hostId/invites.ts", ["hostId"]],
    ["POST", /^\/v2\/remote\/invites\/accept$/u, "v2/remote/invites/accept.ts", []],
    ["POST", /^\/v2\/remote\/resume\/validate-batch$/u, "v2/remote/resume/validate-batch.ts", []],
    ["POST", /^\/v1\/auth\/email\/start$/u, "v1/auth/email/start.ts", []],
    ["POST", /^\/v1\/auth\/email\/verify$/u, "v1/auth/email/verify.ts", []],
    ["POST", /^\/v1\/media\/jobs\/?$/u, "v1/media/jobs/index.ts", []],
  ];
  const loaded = new Map<string, LoadedRoute>();
  for (const [, , file] of ROUTES) loaded.set(file, await import(join(SOURCE, "src", "routes", file)));
  const { createWorkerHandler } = await import(join(SOURCE, "src", "server", "worker-handler.ts"));

  const app = createWorkerHandler((request: Request) => {
    const url = new URL(request.url);
    for (const [method, pattern, file, names] of ROUTES) {
      const match = pattern.exec(url.pathname);
      if (!match || method !== request.method) continue;
      const handler = loaded.get(file)?.Route.options.server.handlers[method];
      if (!handler) break;
      const params = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]));
      return handler({ request, params });
    }
    return new Response("not found", { status: 404 });
  });

  interface Answer {
    status: number;
    body: DynamicRecord;
    bookmark: string | null;
    statements: Statement[];
  }

  let sourceIp = 0;
  async function send(path: string, init: RequestInit & { token?: string; bookmark?: string | null }): Promise<Answer> {
    const from = world.statements.length;
    const headers = new Headers(init.headers);
    sourceIp += 1;
    headers.set("CF-Connecting-IP", `198.51.${Math.floor(sourceIp / 250) % 250}.${(sourceIp % 250) + 1}`);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    if (init.bookmark) headers.set(ACCOUNT_BOOKMARK_HEADER, init.bookmark);
    const response = await app.fetch(new Request(new URL(path, API), { ...init, headers }), env, {
      waitUntil: (promise: Promise<unknown>) => background.push(promise.catch(() => undefined)),
      passThroughOnException: () => undefined,
    });
    const text = await response.text();
    while (background.length > 0) await Promise.all(background.splice(0));
    let body: DynamicRecord = {};
    try {
      const parsed = text ? JSON.parse(text) : {};
      if (isDynamicRecord(parsed)) body = parsed;
    } catch {
      body = { text: text.slice(0, 200) };
    }
    return {
      status: response.status,
      body,
      bookmark: response.headers.get(ACCOUNT_BOOKMARK_HEADER),
      statements: world.statements.slice(from),
    };
  }

  function json(method: string, body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  async function serviceSigned(path: string, body: unknown): Promise<Answer> {
    const text = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${text}`)),
    ).toString("base64url");
    return send(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "OpenBot-Timestamp": timestamp, "OpenBot-Signature": signature },
      body: text,
    });
  }

  function mediaJob(token: string, model: string): Promise<Answer> {
    const form = new FormData();
    form.set(
      CREDIT_MEDIA_REQUEST_PART,
      JSON.stringify({
        jobId: crypto.randomUUID(),
        model,
        prompt: "A red lighthouse on a cliff at dawn",
        aspect: null,
        resolution: null,
        duration: null,
        count: 1,
        audio: false,
      }),
    );
    return send("/v1/media/jobs", { method: "POST", body: form, token });
  }

  async function signIn(email: string): Promise<{ token: string | null; start: Answer; verify: Answer }> {
    const start = await send("/v1/auth/email/start", json("POST", { email }));
    const verify = await send(
      "/v1/auth/email/verify",
      json("POST", { challengeId: start.body.challengeId, code: start.body.developmentCode }),
    );
    const token = typeof verify.body.sessionToken === "string" ? verify.body.sessionToken : null;
    return { token, start, verify };
  }

  async function invite(): Promise<string | null> {
    const created = await send(`/v2/remote/hosts/${HOST_ID}/invites`, {
      ...json("POST", { role: "member" }),
      token: OWNER_TOKEN,
    });
    return typeof created.body.token === "string" ? created.body.token : null;
  }

  for (const [id, email, name] of [
    ["owner", "owner@example.test", "Owner"],
    ["member", "member@example.test", "Member"],
  ])
    await seed(
      "INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)",
      id,
      `email:${email}`,
      email,
      name,
    );
  for (const [id, user, token] of [
    ["auth-owner", "owner", OWNER_TOKEN],
    ["auth-member", "member", MEMBER_TOKEN],
  ])
    await seed(
      "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      user,
      tokenHash(token ?? ""),
      NOW + 30 * DAY_MS,
      NOW,
      NOW,
    );
  await seed(
    `INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, machine_token_hash, created_at, updated_at)
     VALUES (?, 'owner', 'Studio', 1, ?, 1, 1)`,
    HOST_ID,
    tokenHash(HOST_TOKEN),
  );
  for (const [user, role] of [
    ["owner", "owner"],
    ["member", "member"],
  ])
    await seed(
      `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 1, 1)`,
      `${HOST_ID}:${user}`,
      HOST_ID,
      user,
      role,
    );
  await seed(
    `INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash)
     VALUES (?, ?, 'member', ?, 1, ?, ?)`,
    SESSION_ID,
    HOST_ID,
    `${HOST_ID}:member`,
    NOW + 30 * DAY_MS,
    tokenHash(MEMBER_TOKEN),
  );
  await seed(
    `INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end, updated_at)
     VALUES ('sub_owner', 'owner', 'cus_owner', 1000, 'eur', 'active', ?, 1)`,
    NOW + 30 * DAY_MS,
  );
  await seed(
    `INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
     VALUES ('purchase:owner', 'owner', NULL, 100000, 'purchase', 'owner', 'cs_owner', 1)`,
  );
  const imageSpecs = JSON.stringify({
    aspects: ["1:1"],
    defaultAspect: "1:1",
    resolutions: [],
    defaultResolution: null,
    durations: [],
    defaultDuration: null,
    frames: 0,
    references: 0,
    audio: false,
    maxCount: 1,
    promptRequired: true,
  });
  await seed(
    `INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
     VALUES ('image-one', 'up-image-1', 'image', 'Image One', 'Maker', NULL, 1, 1, ?1, '{}', 1)`,
    imageSpecs,
  );
  await seed(
    `INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
     VALUES ('image-one', '', 'item', 1.5, NULL, 1)`,
  );

  const mix: [type: string, request: (index: number) => Promise<Answer>][] = [
    ["me", () => send("/v1/me", { token: OWNER_TOKEN })],
    ["host list", () => send("/v2/remote/hosts", { token: MEMBER_TOKEN })],
    ["owner transfers", () => send("/v2/remote/owner-transfers", { token: MEMBER_TOKEN })],
    ["credits", () => send("/v1/me/credits", { token: OWNER_TOKEN })],
    ["hosting servers", () => send("/v2/hosting/servers", { token: OWNER_TOKEN })],
    ["member list", () => send(`/v2/remote/hosts/${HOST_ID}/members`, { token: MEMBER_TOKEN })],
    [
      "Signal session ticket",
      () =>
        send(`/v2/remote/sessions/${SESSION_ID}/ticket`, {
          ...json("POST", { clientPublicKey: "client-public-key-0001" }),
          token: MEMBER_TOKEN,
        }),
    ],
    ["host ticket", () => send(`/v2/remote/hosts/${HOST_ID}/ticket`, json("POST", { machineToken: HOST_TOKEN }))],
    [
      "validate-batch",
      () =>
        serviceSigned("/v2/remote/resume/validate-batch", {
          claims: [
            {
              sessionId: SESSION_ID,
              hostId: HOST_ID,
              userId: "member",
              membershipId: `${HOST_ID}:member`,
              role: "member",
              authEpoch: 1,
              sessionExpiresAt: Math.floor((NOW + 30 * DAY_MS) / 1_000),
            },
            {
              sessionId: `host-${HOST_ID}`,
              hostId: HOST_ID,
              userId: "owner",
              membershipId: `${HOST_ID}:host`,
              role: "host",
              authEpoch: 1,
              sessionExpiresAt: Math.floor((NOW + 30 * DAY_MS) / 1_000),
            },
          ],
        }),
    ],
    [
      "live activity",
      () =>
        send(
          `/v2/remote/hosts/${HOST_ID}/live-activity`,
          json("POST", {
            machineToken: HOST_TOKEN,
            token: LIVE_ACTIVITY_TOKEN,
            environment: "development",
            event: "update",
            sealed: "c2VhbGVk",
            timestamp: Math.floor(Date.now() / 1_000),
            staleAt: null,
            priority: 5,
          }),
        ),
    ],
    [
      "sign-in",
      async (index) => {
        const { start, verify } = await signIn(`person-${index}@example.test`);
        return {
          ...verify,
          status: start.status === 200 ? verify.status : start.status,
          statements: [...start.statements, ...verify.statements],
        };
      },
    ],
    [
      "host registration",
      (index) =>
        send("/v2/remote/hosts/register", {
          ...json("POST", {
            hostId: `host-registered-${index}`,
            name: `Registered ${index}`,
            ownerMembershipId: `host-registered-${index}:owner`,
          }),
          token: OWNER_TOKEN,
        }),
    ],
    ["credit charge", () => mediaJob(OWNER_TOKEN, "image-one")],
  ];

  const answered: Record<string, Record<string, number>> = {};
  for (const [type, request] of mix) {
    answered[type] = {};
    for (let index = 0; index < REQUESTS_PER_TYPE; index += 1) {
      world.type = "setup";
      const sample = await request(index);
      const codes: Record<string, number> = answered[type] ?? {};
      codes[String(sample.status)] = (codes[String(sample.status)] ?? 0) + 1;
      answered[type] = codes;
      for (const statement of sample.statements) statement.type = type;
      world.type = type;
    }
  }

  const invitationTokens: string[] = [];
  const joiners: string[] = [];
  world.type = "setup";
  for (let index = 0; index < REQUESTS_PER_TYPE; index += 1) {
    const token = await invite();
    const joiner = await signIn(`joiner-${index}@example.test`);
    if (token) invitationTokens.push(token);
    if (joiner.token) joiners.push(joiner.token);
  }
  answered["invitation acceptance"] = {};
  for (let index = 0; index < REQUESTS_PER_TYPE; index += 1) {
    const sample = await send("/v2/remote/invites/accept", {
      ...json("POST", { token: invitationTokens[index] ?? "missing" }),
      token: joiners[index] ?? "missing",
    });
    const codes = answered["invitation acceptance"];
    codes[String(sample.status)] = (codes[String(sample.status)] ?? 0) + 1;
    for (const statement of sample.statements) statement.type = "invitation acceptance";
  }

  const types: Record<string, TypeSummary> = {};
  for (const [type, codes] of Object.entries(answered)) {
    const statements = world.statements.filter((statement) => statement.type === type);
    const primaryStatements = statements.filter((statement) => statement.instance === "primary");
    const primaryMs = primaryStatements.reduce((sum, statement) => sum + statement.ms, 0);
    const replicaMs = statements
      .filter((statement) => statement.instance === "replica")
      .reduce((sum, statement) => sum + statement.ms, 0);
    const constraints: Record<string, number> = {};
    const primaryReadSql: Record<string, number> = {};
    for (const statement of statements) {
      const key = `${statement.constraint}->${statement.instance}`;
      constraints[key] = (constraints[key] ?? 0) + 1;
      if (statement.instance === "primary" && !statement.write)
        primaryReadSql[statement.sql.slice(0, 90)] = (primaryReadSql[statement.sql.slice(0, 90)] ?? 0) + 1;
    }
    types[type] = {
      requests: REQUESTS_PER_TYPE,
      statusCodes: codes,
      primaryStatements: primaryStatements.length,
      replicaStatements: statements.length - primaryStatements.length,
      primaryReads: primaryStatements.filter((statement) => !statement.write).length,
      writes: statements.filter((statement) => statement.write).length,
      primaryMs: Math.round(primaryMs * 10) / 10,
      replicaMs: Math.round(replicaMs * 10) / 10,
      primaryTimeShare: primaryMs + replicaMs > 0 ? primaryMs / (primaryMs + replicaMs) : 0,
      constraints,
      primaryReadSql,
    };
  }

  const expected: Record<string, number> = {
    me: 200,
    "host list": 200,
    "owner transfers": 200,
    credits: 200,
    "hosting servers": 200,
    "member list": 200,
    "Signal session ticket": 200,
    "host ticket": 200,
    "validate-batch": 200,
    "live activity": 204,
    "sign-in": 200,
    "host registration": 201,
    "credit charge": 202,
    "invitation acceptance": 200,
  };
  for (const [type, status] of Object.entries(expected))
    check(
      `${type}: all ${REQUESTS_PER_TYPE} requests answer ${status}`,
      answered[type]?.[String(status)] === REQUESTS_PER_TYPE,
      answered[type],
    );

  let weightedPrimary = 0;
  let weightedAll = 0;
  let weightedPrimaryMs = 0;
  let weightedAllMs = 0;
  for (const [type, requests] of Object.entries(PRODUCTION_REQUESTS_2026_11_27)) {
    const summary = types[type];
    if (!summary) continue;
    const scale = requests / summary.requests;
    weightedPrimary += summary.primaryStatements * scale;
    weightedAll += (summary.primaryStatements + summary.replicaStatements) * scale;
    weightedPrimaryMs += summary.primaryMs * scale;
    weightedAllMs += (summary.primaryMs + summary.replicaMs) * scale;
  }

  world.type = "lag";
  await catchUp();
  world.lag = true;
  const fresh = await signIn("fresh@example.test");
  const freshHosts = fresh.token ? await send("/v2/remote/hosts", { token: fresh.token }) : null;
  check(
    "a sign-in session that only the primary has passes the bearer check of a GET at once",
    freshHosts?.status === 200 && Array.isArray(freshHosts.body.hosts),
    { status: freshHosts?.status, statements: freshHosts?.statements.map(describe) },
  );
  const freshMe = fresh.token ? await send("/v1/me", { token: fresh.token }) : null;
  check(
    "GET /v1/me of a session that only the primary has answers the new account",
    freshMe?.status === 200 && freshMe.body.email === "fresh@example.test",
    { status: freshMe?.status },
  );
  const missingToken = await send("/v2/remote/hosts", { token: "unknown-session-token-0001" });
  check(
    "an unknown session is refused with 401 unauthorized after the primary check",
    missingToken.status === 401 &&
      isDynamicRecord(missingToken.body.error) &&
      missingToken.body.error.code === "unauthorized",
    { status: missingToken.status, statements: missingToken.statements.map(describe) },
  );

  await catchUp();
  const newcomer = await signIn("newcomer@example.test");
  await catchUp();
  const firstCredits = newcomer.token ? await send("/v1/me/credits", { token: newcomer.token }) : null;
  check(
    "read-after-write: the first credits request of an account shows the welcome credits that it wrote",
    firstCredits?.status === 200 && Number(firstCredits.body.balance) > 0,
    {
      status: firstCredits?.status,
      balance: firstCredits?.body.balance,
      statements: firstCredits?.statements.map(describe),
    },
  );

  await catchUp();
  const balanceSql = /credit_ledger|credit_holds|credit_grants/u;
  const charge = await mediaJob(OWNER_TOKEN, "image-one");
  const balanceReads = charge.statements.filter((statement) => balanceSql.test(statement.sql));
  check(
    "a credit charge reads and holds the balance on the primary",
    charge.status === 202 && balanceReads.length > 0 && balanceReads.every((entry) => entry.instance === "primary"),
    { status: charge.status, balanceReads: balanceReads.map(describe) },
  );

  await catchUp();
  const lateInvitation = await invite();
  const lateJoiner = await signIn("late-joiner@example.test");
  await catchUp();
  const accepted = await send("/v2/remote/invites/accept", {
    ...json("POST", { token: lateInvitation ?? "missing" }),
    token: lateJoiner.token ?? "missing",
  });
  const lateMembers = await send(`/v2/remote/hosts/${HOST_ID}/members`, { token: lateJoiner.token ?? "missing" });
  check(
    "a member who joined a moment ago reads the member list before the replica has the membership",
    accepted.status === 200 && lateMembers.status === 200 && Array.isArray(lateMembers.body.members),
    { accepted: accepted.status, members: lateMembers.status, statements: lateMembers.statements.map(describe) },
  );
  const removedProbe = await send("/v2/remote/hosts/host-missing/members", { token: OWNER_TOKEN });
  check(
    "a member list of an unknown server is still refused after the primary recheck",
    removedProbe.status === 403 || removedProbe.status === 404,
    { status: removedProbe.status, body: removedProbe.body },
  );

  await primaryOnly(
    `INSERT INTO hosted_servers(server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state,
       observed_state, idempotency_key, created_at, updated_at)
     VALUES ('hosted-late', 'owner', 'Late hosted', 'default', 'standard', 'month', 'eur', 'running', 'running',
       'hosted-late-key', 1, 1)`,
  );
  const lateStatus = await send("/v2/hosting/servers/hosted-late/status", { token: OWNER_TOKEN });
  check(
    "a GET that finds no row on the replica checks the primary again before it answers 404",
    lateStatus.status === 200 && lateStatus.body.serverId === "hosted-late" && lateStatus.body.state === "running",
    { status: lateStatus.status, body: lateStatus.body, statements: lateStatus.statements.map(describe) },
  );
  const missingStatus = await send("/v2/hosting/servers/hosted-missing/status", { token: OWNER_TOKEN });
  check("a GET for a row that the primary also does not have still answers 404", missingStatus.status === 404, {
    status: missingStatus.status,
    body: missingStatus.body,
  });

  await catchUp();
  const newHost = await send("/v2/remote/hosts/register", {
    ...json("POST", { hostId: "host-late", name: "Late", ownerMembershipId: "host-late:owner" }),
    token: OWNER_TOKEN,
  });
  const newHostToken = typeof newHost.body.machineToken === "string" ? newHost.body.machineToken : "missing";
  const newHostTicket = await send("/v2/remote/hosts/host-late/ticket", json("POST", { machineToken: newHostToken }));
  check(
    "a host registered a moment ago gets a host ticket before the replica has the host",
    newHost.status === 201 && newHostTicket.status === 200 && typeof newHostTicket.body.ticket === "string",
    { registered: newHost.status, ticket: newHostTicket.status, statements: newHostTicket.statements.map(describe) },
  );
  const hostCredentialReads = newHostTicket.statements.filter((statement) =>
    /\bFROM\s+remote_hosts\b/u.test(statement.sql),
  );
  check(
    "a host ticket reads the host credential and auth epoch on the primary",
    hostCredentialReads.length > 0 && hostCredentialReads.every((entry) => entry.instance === "primary"),
    { hostCredentialReads: hostCredentialReads.map(describe) },
  );
  const wrongHostTicket = await send(
    "/v2/remote/hosts/host-late/ticket",
    json("POST", { machineToken: "wrong-machine-token-0001" }),
  );
  check(
    "a host ticket with a wrong credential is refused with 401 host_unauthorized",
    wrongHostTicket.status === 401 &&
      isDynamicRecord(wrongHostTicket.body.error) &&
      wrongHostTicket.body.error.code === "host_unauthorized",
    { status: wrongHostTicket.status },
  );
  await catchUp();
  world.lag = false;

  const registered = await send("/v2/remote/hosts/register", {
    ...json("POST", { hostId: "host-bookmark", name: "Bookmark", ownerMembershipId: "host-bookmark:owner" }),
    token: OWNER_TOKEN,
  });
  world.lag = true;
  const listed = await send("/v2/remote/hosts", { token: OWNER_TOKEN, bookmark: registered.bookmark });
  check(
    "a host list with the bookmark of a registration shows the new host while the replica is late",
    registered.status === 201 &&
      registered.bookmark !== null &&
      Array.isArray(listed.body.hosts) &&
      listed.body.hosts.some((host) => isDynamicRecord(host) && host.hostId === "host-bookmark"),
    { registered: registered.status, bookmark: registered.bookmark, listed: listed.status },
  );
  await catchUp();
  world.lag = false;

  function describe(statement: Statement): string {
    return `${statement.constraint}->${statement.instance}${statement.write ? ":write" : ""} ${statement.sql.slice(0, 90)}`;
  }

  await proxy.dispose();
  await rm(work, { recursive: true, force: true });

  const report: RunReport = {
    source: SOURCE,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    requestsPerType: REQUESTS_PER_TYPE,
    types,
    weighted: {
      primaryStatementShare: weightedAll > 0 ? weightedPrimary / weightedAll : 0,
      primaryTimeShare: weightedAllMs > 0 ? weightedPrimaryMs / weightedAllMs : 0,
      types: Object.keys(PRODUCTION_REQUESTS_2026_11_27),
    },
    checks,
  };
  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  for (const [type, summary] of Object.entries(types))
    console.log(
      `${type}: primary ${summary.primaryStatements}, replica ${summary.replicaStatements}, primary time ${percent(summary.primaryTimeShare)}`,
    );
  for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
  console.log(`Report: ${REPORT}`);
  if (!report.passed) process.exitCode = 1;
}
