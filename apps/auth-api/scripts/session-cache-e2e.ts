import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Option, Schema } from "effect";
import { build, type Plugin } from "esbuild";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "session-cache-e2e");
const APP = join(ROOT, "apps", "auth-api");
const WRANGLER = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const BASELINE_REF = process.env.SESSION_CACHE_E2E_BASELINE ?? "origin/main";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const RATE_LIMITERS = [
  "MARKETPLACE_INGRESS_RATE_LIMITER",
  "MARKETPLACE_MUTATION_RATE_LIMITER",
  "MARKETPLACE_UPLOAD_RATE_LIMITER",
  "SITE_REPORT_RATE_LIMITER",
  "GITHUB_TOKEN_RATE_LIMITER",
  "LIVE_ACTIVITY_RATE_LIMITER",
  "FEEDBACK_RATE_LIMITER",
  "WATCH_TICKET_RATE_LIMITER",
];

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  steps.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  console.log(`${passed ? "ok" : "FAIL"} ${name}${passed ? "" : ` ${JSON.stringify(detail ?? null)}`}`);
}

interface Counts {
  total: number;
  statements: Record<string, number>;
}

const ResponseBody = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  accessTokenRoute: Schema.optional(Schema.String),
  accessToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
  statements: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  error: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
});
type ResponseBody = typeof ResponseBody.Type;
const decodeResponseBody = Schema.decodeUnknownOption(Schema.fromJsonString(ResponseBody));

interface Variant {
  name: "baseline" | "branch";
  app: string;
  migrations: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new Error("No free port."));
      });
    });
  });
}

async function baselineVariant(): Promise<Variant> {
  const root = join(OUT, "baseline");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const archive = join(OUT, "baseline.tar");
  await run("git", [
    "-C",
    ROOT,
    "archive",
    "--format=tar",
    `--output=${archive}`,
    BASELINE_REF,
    "package.json",
    "CHANGELOG.md",
    "apps/mobile/CHANGELOG.md",
    "apps/auth-api/src",
    "apps/auth-api/migrations",
    "apps/site-router/src",
  ]);
  await run("tar", ["-xf", archive, "-C", root]);
  await rm(archive, { force: true });
  const app = join(root, "apps", "auth-api");
  await mkdir(join(app, "scripts"), { recursive: true });
  for (const file of ["session-cache-e2e-worker.ts", "session-cache-e2e-route-registry.ts"]) {
    await cp(join(APP, "scripts", file), join(app, "scripts", file));
  }
  const routes = await readFile(join(APP, "scripts", "session-cache-e2e-routes.ts"), "utf8");
  await writeFile(
    join(app, "scripts", "session-cache-e2e-routes.ts"),
    routes
      .split("\n")
      .filter((line) => !line.includes("access-token"))
      .join("\n"),
  );
  await symlink(join(APP, "tsconfig.json"), join(app, "tsconfig.json"));
  return { name: "baseline", app, migrations: join(app, "migrations") };
}

const ticketKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const TICKET_VARS = {
  REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
    ...(await crypto.subtle.exportKey("jwk", ticketKeys.privateKey)),
    kid: "session-cache-e2e",
  }),
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
    keys: [{ ...(await crypto.subtle.exportKey("jwk", ticketKeys.publicKey)), kid: "session-cache-e2e" }],
  }),
  REMOTE_TICKET_KEY_ID: "session-cache-e2e",
};

const FILE_ROUTE_MODULE = [
  'import { registerRouteHandler } from "./session-cache-e2e-route-registry.ts";',
  "export const createFileRoute = (path) => (options) => {",
  "  for (const [method, handler] of Object.entries(options.server?.handlers ?? {})) {",
  "    registerRouteHandler(path, method, handler);",
  "  }",
  "  return { options };",
  "};",
].join("\n");

const harnessPlugins = (scripts: string): Plugin[] => [
  {
    name: "raw-text",
    setup(builder) {
      builder.onResolve({ filter: /\?raw$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path.replace(/\?raw$/u, "")),
        namespace: "raw-text",
      }));
      builder.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
        contents: await readFile(args.path, "utf8"),
        loader: "text",
      }));
    },
  },
  {
    name: "file-route",
    setup(builder) {
      builder.onResolve({ filter: /^@tanstack\/solid-router$/ }, () => ({
        path: "file-route",
        namespace: "file-route",
      }));
      builder.onLoad({ filter: /.*/, namespace: "file-route" }, () => ({
        contents: FILE_ROUTE_MODULE,
        loader: "js",
        resolveDir: scripts,
      }));
    },
  },
];

async function buildWorker(variant: Variant, work: string): Promise<string> {
  const outfile = join(work, "bundle", "worker.js");
  await build({
    entryPoints: [join(variant.app, "scripts", "session-cache-e2e-worker.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2024",
    conditions: ["workerd", "worker"],
    mainFields: ["module", "main"],
    external: ["node:*", "cloudflare:*"],
    define: { "import.meta.env.PROD": "false", "import.meta.env.DEV": "true", "import.meta.env.SSR": "true" },
    loader: { ".webp": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl" },
    plugins: harnessPlugins(join(variant.app, "scripts")),
    outfile,
    logLevel: "silent",
  });
  return outfile;
}

function workerConfig(variant: Variant, name: string, peer: string | null, main: string) {
  return {
    name,
    main,
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js"] }],
    compatibility_date: "2026-08-18",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [
      {
        binding: "DB",
        database_name: "openbot-auth",
        database_id: "session-cache-e2e",
        migrations_dir: variant.migrations,
      },
    ],
    r2_buckets: ["AVATARS", "SKILLS", "SITES"].map((binding) => ({
      binding,
      bucket_name: `session-cache-e2e-${binding.toLowerCase()}`,
    })),
    ratelimits: RATE_LIMITERS.map((binding, index) => ({
      name: binding,
      namespace_id: String(9_100 + index),
      simple: { limit: 100_000, period: 60 },
    })),
    vars: {
      SITE_REPORT_HASH_SECRET: "session-cache-e2e-secret-not-for-production",
      AUTH_EXPOSE_DEVELOPMENT_CODE: "true",
      ...TICKET_VARS,
    },
    ...(peer ? { services: [{ binding: "PEER", service: peer }] } : {}),
  };
}

interface Stack {
  origin: string;
  stop(): Promise<void>;
}

async function startStack(variant: Variant, label: string): Promise<Stack> {
  const work = join(OUT, "work", `${variant.name}-${label}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const state = join(work, "state");
  const first = join(work, "a.jsonc");
  const second = join(work, "b.jsonc");
  const secondName = `session-cache-e2e-${variant.name}-${label}-b`;
  const main = await buildWorker(variant, work);
  await writeFile(
    first,
    JSON.stringify(workerConfig(variant, `session-cache-e2e-${variant.name}-${label}-a`, secondName, main)),
  );
  await writeFile(second, JSON.stringify(workerConfig(variant, secondName, null, main)));
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", NO_D1_WARNING: "true" };
  await run(WRANGLER, ["d1", "migrations", "apply", "openbot-auth", "--local", "--persist-to", state, "-c", first], {
    cwd: work,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const port = await freePort();
  const inspector = await freePort();
  const child = spawn(
    WRANGLER,
    [
      "dev",
      "-c",
      first,
      "-c",
      second,
      "--persist-to",
      state,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspector),
      "--show-interactive-dev-session=false",
    ],
    { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const log: string[] = [];
  const started = new Promise<void>((ready, failed) => {
    const deadline = setTimeout(() => failed(new Error("wrangler dev did not start in 120 s.")), 120 * SECOND);
    const listen = (chunk: Buffer) => {
      const text = chunk.toString();
      log.push(text);
      if (/Ready on/u.test(text)) {
        clearTimeout(deadline);
        ready();
      }
      if (/\[ERROR\]/u.test(text)) {
        clearTimeout(deadline);
        failed(new Error(`wrangler dev failed: ${text.slice(0, 4000)}`));
      }
    };
    child.stdout?.on("data", listen);
    child.stderr?.on("data", listen);
    child.once("exit", (code) => {
      clearTimeout(deadline);
      failed(new Error(`wrangler dev stopped with ${code}: ${log.join("").slice(-4000)}`));
    });
  });
  try {
    await started;
  } catch (error) {
    await writeFile(join(work, "wrangler-dev.log"), log.join(""));
    await stopChild(child);
    throw error;
  }
  await writeFile(join(work, "wrangler-dev.log"), log.join(""));
  child.stdout?.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: async () => {
      await writeFile(join(work, "wrangler-dev.log"), log.join(""));
      await stopChild(child);
    },
  };
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((stopped) => {
    child.once("exit", () => stopped());
    child.kill("SIGTERM");
  });
}

class Client {
  constructor(
    readonly origin: string,
    readonly prefix: string,
  ) {}

  async call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
    const headers = new Headers({ "X-OpenBot-Browser": "session-cache-e2e" });
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.origin}${this.prefix}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const json: ResponseBody | null = text ? Option.getOrNull(decodeResponseBody(text)) : null;
    return { status: response.status, json };
  }

  me(token: string) {
    return this.call("/v1/me", { token });
  }

  async clock(offsetMs: number) {
    await this.call("/__e2e/clock", { method: "POST", body: { offsetMs } });
  }

  async counts(reset = true): Promise<Counts> {
    const response = await this.call("/__e2e/count", { method: "POST", body: { reset } });
    return {
      total: response.json?.total ?? Number.NaN,
      statements: { ...response.json?.statements },
    };
  }

  async sql(sql: string, params: (string | number)[] = []): Promise<void> {
    const response = await fetch(`${this.origin}/__e2e/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    if (!response.ok) throw new Error(`The harness SQL failed with status ${response.status}.`);
  }
}

async function seedSession(
  client: Client,
  input: { userId: string; name: string; sessionId: string; expiresAt: number; now: number; mobile?: boolean },
) {
  const token = `e2e-${randomUUID()}`;
  await client.sql(
    `INSERT OR IGNORE INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      `email:${input.userId}@example.test`,
      `${input.userId}@example.test`,
      input.name,
      input.now,
      input.now,
    ],
  );
  await client.sql(
    "INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
    [input.sessionId, input.userId, tokenHash(token), input.expiresAt, input.now, input.now],
  );
  if (input.mobile) {
    await client.sql(
      "INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [input.sessionId, input.userId, `${input.sessionId}-device`, "iPhone", "ios", input.now],
    );
  }
  return token;
}

async function measure(variant: Variant) {
  const stack = await startStack(variant, "measure");
  try {
    const client = new Client(stack.origin, "");
    const now = Date.now();
    const counter = await client.call("/__e2e/counter-check", { method: "POST", body: {} });
    const burstToken = await seedSession(client, {
      userId: "burst-user",
      name: "Burst",
      sessionId: "burst-session",
      expiresAt: now + 30 * DAY,
      now,
    });
    const spreadToken = await seedSession(client, {
      userId: "spread-user",
      name: "Spread",
      sessionId: "spread-session",
      expiresAt: now + 30 * DAY,
      now,
    });
    const manyTokens: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      manyTokens.push(
        await seedSession(client, {
          userId: `many-user-${index}`,
          name: `Many ${index}`,
          sessionId: `many-session-${index}`,
          expiresAt: now + 30 * DAY,
          now,
        }),
      );
    }
    await client.counts();

    const statuses: number[] = [];
    for (let index = 0; index < 100; index += 1) statuses.push((await client.me(burstToken)).status);
    const burst = await client.counts();

    for (let index = 0; index < 100; index += 1) {
      await client.clock(index * 6 * SECOND);
      statuses.push((await client.me(spreadToken)).status);
    }
    const spread = await client.counts();
    await client.clock(0);
    await client.counts();

    for (let index = 0; index < 100; index += 1) {
      statuses.push((await client.me(manyTokens[index % manyTokens.length] ?? "")).status);
    }
    const many = await client.counts();

    return {
      counterCheck: counter.json,
      allSignedIn: statuses.every((status) => status === 200),
      sameSessionBurst: burst,
      sameSessionOverTenMinutes: spread,
      tenSessionsBurst: many,
    };
  } finally {
    await stack.stop();
  }
}

async function scenario(variant: Variant) {
  const stack = await startStack(variant, "scenario");
  const a = new Client(stack.origin, "");
  const b = new Client(stack.origin, "/__e2e/peer");
  let offsetA = 0;
  let offsetB = 0;
  const advance = async (client: "a" | "b" | "both", ms: number) => {
    if (client !== "b") {
      offsetA += ms;
      await a.clock(offsetA);
    }
    if (client !== "a") {
      offsetB += ms;
      await b.clock(offsetB);
    }
  };
  try {
    const counter = await a.call("/__e2e/counter-check", { method: "POST", body: {} });
    check("the D1 counter counts each statement once, also in a batch", counter.json?.total === 4, counter.json);

    const now = Date.now();
    const desktop = await seedSession(a, {
      userId: "owner",
      name: "Ana Lopez",
      sessionId: "desktop",
      expiresAt: now + 30 * DAY,
      now,
    });
    const profileToken = await seedSession(a, {
      userId: "member",
      name: "Old name",
      sessionId: "member-desktop",
      expiresAt: now + 30 * DAY,
      now,
    });
    const expiredToken = await seedSession(a, {
      userId: "expired-user",
      name: "Expired",
      sessionId: "expired",
      expiresAt: now - MINUTE,
      now: now - DAY,
    });
    const shortToken = await seedSession(a, {
      userId: "short-user",
      name: "Short",
      sessionId: "short",
      expiresAt: now + 90 * SECOND,
      now,
    });
    const phoneToken = await seedSession(a, {
      userId: "phone-user",
      name: "Phone",
      sessionId: "phone",
      expiresAt: now + 30 * DAY,
      now,
      mobile: true,
    });
    await a.counts();
    await b.counts();

    const first = await a.me(desktop);
    const firstCounts = await a.counts();
    const repeats: number[] = [];
    for (let index = 0; index < 9; index += 1) repeats.push((await a.me(desktop)).status);
    const repeatCounts = await a.counts();
    check(
      "the first sign-in check reads D1 and the next 9 checks in the same isolate read no D1",
      first.status === 200 &&
        first.json?.id === "owner" &&
        repeats.every((status) => status === 200) &&
        firstCounts.total > 0 &&
        repeatCounts.total === 0,
      { first: firstCounts, repeats: repeatCounts },
    );
    check(
      "the account response advertises the access token route",
      first.json?.accessTokenRoute === "/v1/auth/access-token",
      { accessTokenRoute: first.json?.accessTokenRoute ?? null },
    );

    const second = await b.me(desktop);
    const secondCounts = await b.counts();
    check("a second isolate accepts the cached session", second.status === 200 && second.json?.id === "owner", {
      counts: secondCounts,
    });
    const secondRepeat = await b.me(desktop);
    const secondRepeatCounts = await b.counts();
    check(
      "the second isolate reads no D1 for its next check",
      secondRepeat.status === 200 && secondRepeatCounts.total === 0,
      secondRepeatCounts,
    );

    const phone = await a.me(phoneToken);
    check("a phone session signs in through the same cache", phone.status === 200 && phone.json?.id === "phone-user");

    await b.me(profileToken);
    await a.me(profileToken);
    const logout = await a.call("/v1/auth/logout", { method: "POST", token: desktop });
    const revokedHere = await a.me(desktop);
    const revokedThereAtOnce = await b.me(desktop);
    await advance("b", 31 * SECOND);
    const revokedThereAfterPoll = await b.me(desktop);
    check(
      "a revoke is refused at once in the isolate that did it",
      logout.status === 204 && revokedHere.status === 401,
      { logout: logout.status, after: revokedHere.status },
    );
    check(
      "a revoke is refused in a second isolate after the 30 s poll, so within 60 s",
      revokedThereAfterPoll.status === 401,
      { atOnce: revokedThereAtOnce.status, afterPoll: revokedThereAfterPoll.status },
    );
    await advance("a", 31 * SECOND);

    const renamed = await a.call("/v1/me/profile", {
      method: "PATCH",
      token: profileToken,
      body: { name: "New name" },
    });
    const renamedHere = await a.me(profileToken);
    await advance("b", 31 * SECOND);
    const renamedThere = await b.me(profileToken);
    check(
      "a profile change is seen at once in its isolate and after the poll in a second isolate",
      renamed.status === 200 && renamedHere.json?.name === "New name" && renamedThere.json?.name === "New name",
      { here: renamedHere.json?.name ?? null, there: renamedThere.json?.name ?? null },
    );

    const expired = await a.me(expiredToken);
    const expiredAgain = await a.me(expiredToken);
    check("an expired session is refused and is not cached", expired.status === 401 && expiredAgain.status === 401);

    const shortFirst = await a.me(shortToken);
    await advance("a", 60 * SECOND);
    const shortAfter = await a.me(shortToken);
    check(
      "a cached session is refused after its own expiry time",
      shortFirst.status === 200 && shortAfter.status === 401,
      { before: shortFirst.status, after: shortAfter.status },
    );

    const issued = await a.call("/v1/auth/access-token", { method: "POST", token: profileToken });
    const accessToken = issued.json?.accessToken ?? "";
    const accessExpiresAt = issued.json?.expiresAt ?? 0;
    const issuedAt = now + offsetA;
    check(
      "the access token route returns a signed token that lasts 10 minutes",
      issued.status === 200 &&
        accessToken.startsWith("oba1.") &&
        Math.abs(accessExpiresAt - (issuedAt + 10 * MINUTE)) < 30 * SECOND,
      { status: issued.status, prefix: accessToken.slice(0, 5), lifetimeMs: accessExpiresAt - issuedAt },
    );
    await a.counts();
    const withAccess = await a.me(accessToken);
    const withAccessAgain = await a.me(accessToken);
    const accessCounts = await a.counts();
    const withAccessThere = await b.me(accessToken);
    check(
      "the access token signs in on both isolates as the same account",
      withAccess.status === 200 &&
        withAccess.json?.id === "member" &&
        withAccessAgain.status === 200 &&
        withAccessThere.json?.id === "member",
      { counts: accessCounts },
    );
    const tampered = await a.me(`${accessToken.slice(0, -2)}${accessToken.endsWith("A") ? "BB" : "AA"}`);
    check("a changed access token is refused", tampered.status === 401, { status: tampered.status });
    const accessForAccess = await a.call("/v1/auth/access-token", { method: "POST", token: accessToken });
    const accessForLogout = await a.call("/v1/auth/logout", { method: "POST", token: accessToken });
    check(
      "an access token cannot get a new access token or end the session",
      accessForAccess.status === 401 && accessForLogout.status === 401,
      { accessToken: accessForAccess.status, logout: accessForLogout.status },
    );
    check(
      "the session token still works next to its access token",
      (await a.me(profileToken)).status === 200 && (await b.me(profileToken)).status === 200,
    );

    const revocable = await seedSession(a, {
      userId: "member",
      name: "New name",
      sessionId: "member-laptop",
      expiresAt: now + 30 * DAY,
      now: now + offsetA,
    });
    const revocableAccess = await a.call("/v1/auth/access-token", { method: "POST", token: revocable });
    const revocableToken = revocableAccess.json?.accessToken ?? "";
    const beforeRevoke = await a.me(revocableToken);
    const beforeRevokeThere = await b.me(revocableToken);
    await a.call("/v1/auth/logout", { method: "POST", token: revocable });
    const afterRevoke = await a.me(revocableToken);
    await advance("b", 31 * SECOND);
    const afterRevokeThere = await b.me(revocableToken);
    check(
      "an access token stops working when its session is revoked",
      beforeRevoke.status === 200 &&
        beforeRevokeThere.status === 200 &&
        afterRevoke.status === 401 &&
        afterRevokeThere.status === 401,
      {
        before: [beforeRevoke.status, beforeRevokeThere.status],
        after: [afterRevoke.status, afterRevokeThere.status],
      },
    );

    await a.counts();
    await advance("a", 10 * MINUTE + 5 * SECOND);
    const afterTtl = await a.me(profileToken);
    const afterTtlCounts = await a.counts();
    check(
      "a cached session is read from D1 again after the 10 minute cache time",
      afterTtl.status === 200 && Object.keys(afterTtlCounts.statements).some((sql) => sql.includes("auth_sessions.id")),
      afterTtlCounts,
    );
    const expiredAccess = await a.me(accessToken);
    check(
      "an expired access token gets 401 access_token_expired",
      expiredAccess.status === 401 && expiredAccess.json?.error?.code === "access_token_expired",
      expiredAccess.json,
    );
    check("the session token still works after its access token expired", (await a.me(profileToken)).status === 200);
  } finally {
    await stack.stop();
  }
}

async function main() {
  await rm(join(OUT, "work"), { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const branch: Variant = { name: "branch", app: APP, migrations: join(APP, "migrations") };
  await scenario(branch);
  const after = await measure(branch);
  const before = await measure(await baselineVariant());
  check("every measured request signed in, before and after", before.allSignedIn && after.allSignedIn);
  const reduced = after.sameSessionBurst.total < before.sameSessionBurst.total;
  check("the branch reads less D1 per 100 sign-in checks than the baseline", reduced, {
    before: before.sameSessionBurst.total,
    after: after.sameSessionBurst.total,
  });
  const passed = steps.every((step) => step.passed);
  const report = {
    passed,
    baseline: BASELINE_REF,
    steps,
    d1StatementsPer100Requests: {
      sameSessionBurst: { before: before.sameSessionBurst.total, after: after.sameSessionBurst.total },
      sameSessionOverTenMinutes: {
        before: before.sameSessionOverTenMinutes.total,
        after: after.sameSessionOverTenMinutes.total,
      },
      tenSessionsBurst: { before: before.tenSessionsBurst.total, after: after.tenSessionsBurst.total },
    },
    before,
    after,
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.d1StatementsPer100Requests, null, 2));
  if (!passed) process.exit(1);
}

await main();
