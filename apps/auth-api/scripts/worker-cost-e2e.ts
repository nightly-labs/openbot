import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Option, Schema } from "effect";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "worker-cost");
const KEY_ID = "worker-cost-1";
const EMAIL = "worker-cost@example.test";
const HOST_ID = "worker-cost-host";
const SAMPLE_INTERVAL_US = 50;
const PROBE_MODULE = "worker-cost-probe.js";
const PROBE_CONFIG = "worker-cost-probe.json";
const PROBE_PATH = "/__worker-cost/counts";

interface Options {
  before: string | null;
  requests: number;
  build: boolean;
}

function readOptions(argv: readonly string[]): Options {
  const value = (name: string) => argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const requests = Number(value("requests") ?? "20");
  if (!Number.isInteger(requests) || requests < 2) throw new Error("--requests must be an integer of 2 or more.");
  return { before: value("before") ?? null, requests, build: !argv.includes("--no-build") };
}

interface Build {
  label: string;
  app: string;
}

interface Route {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: () => unknown;
  auth: "bearer" | "browser" | "none";
  headers?: Record<string, string>;
  expectStatus: readonly number[];
}

interface Session {
  token: string;
  sessionId: string;
}

const PAGE_PATHS = ["/", "/app", "/app-preview"] as const;
const MISSING_ASSET = "/assets/worker-cost-missing-0a1b2c3d.js";

function routes(session: Session): Route[] {
  const clientPublicKey = () => ({ clientPublicKey: `cpk-${crypto.randomUUID()}` });
  return [
    { name: "GET /v1/me", method: "GET", path: "/v1/me", auth: "bearer", expectStatus: [200] },
    { name: "GET /v2/remote/hosts", method: "GET", path: "/v2/remote/hosts", auth: "bearer", expectStatus: [200] },
    {
      name: "GET /v2/remote/owner-transfers",
      method: "GET",
      path: "/v2/remote/owner-transfers",
      auth: "bearer",
      expectStatus: [200],
    },
    {
      name: "POST /v2/remote/sessions/:id/ticket",
      method: "POST",
      path: `/v2/remote/sessions/${session.sessionId}/ticket`,
      body: clientPublicKey,
      auth: "bearer",
      expectStatus: [200],
    },
    {
      name: "POST /api/browser/v2/remote/sessions/:id/ticket",
      method: "POST",
      path: `/api/browser/v2/remote/sessions/${session.sessionId}/ticket`,
      body: clientPublicKey,
      auth: "browser",
      expectStatus: [200],
    },
    { name: "GET /v1/me/credits", method: "GET", path: "/v1/me/credits", auth: "bearer", expectStatus: [200] },
    {
      name: "GET /v2/hosting/servers/:id/status",
      method: "GET",
      path: "/v2/hosting/servers/worker-cost-missing/status",
      auth: "bearer",
      expectStatus: [404, 409, 503],
    },
    {
      name: "POST /v2/hosting/servers/:id/wake",
      method: "POST",
      path: "/v2/hosting/servers/worker-cost-missing/wake",
      body: () => ({}),
      auth: "bearer",
      expectStatus: [404, 409, 503],
    },
    {
      name: "POST /v2/remote/hosts/register",
      method: "POST",
      path: "/v2/remote/hosts/register",
      body: () => ({ hostId: HOST_ID, name: "Worker cost host", ownerMembershipId: "worker-cost-owner" }),
      auth: "bearer",
      expectStatus: [201],
    },
    ...PAGE_PATHS.map(
      (path): Route => ({
        name: `GET ${path} (page)`,
        method: "GET",
        path,
        auth: "none",
        headers: { "Accept-Language": "en-US,en;q=0.9" },
        expectStatus: [200],
      }),
    ),
    {
      name: "GET /app (page, signed in)",
      method: "GET",
      path: "/app",
      auth: "browser",
      headers: { "Accept-Language": "en-US,en;q=0.9" },
      expectStatus: [200],
    },
    { name: "GET /assets/:id (missing)", method: "GET", path: MISSING_ASSET, auth: "none", expectStatus: [404] },
  ];
}

const PROBE_SOURCE = `import worker from "./index.js";

const empty = () => ({ requests: 0, statements: 0, batches: 0, direct: 0, primary: 0, replica: 0, reads: 0, writes: 0, cacheHits: 0, cacheMisses: 0, cachePuts: 0 });
let counts = empty();
const pending = new Set();
const statements = new WeakMap();
const sessions = new WeakMap();
let depth = 0;
let patchedDatabase = false;
let patchedCache = false;

function track(value) {
  if (!value || typeof value.then !== "function") return value;
  const settled = Promise.resolve(value).then(() => undefined, () => undefined);
  pending.add(settled);
  settled.then(() => pending.delete(settled));
  return value;
}

function count(statement) {
  const info = statements.get(statement) ?? { sql: "", target: "direct" };
  counts.statements += 1;
  counts[info.target] += 1;
  if (/^\\s*(select|with|pragma)\\b/i.test(info.sql) && !/\\b(insert|update|delete|replace)\\b/i.test(info.sql)) counts.reads += 1;
  else counts.writes += 1;
}

function guarded(original, before) {
  return function (...args) {
    if (depth > 0) return original.apply(this, args);
    before(this, args);
    depth += 1;
    try {
      return track(original.apply(this, args));
    } finally {
      depth -= 1;
    }
  };
}

function patchDatabase(database) {
  if (patchedDatabase || !database) return;
  patchedDatabase = true;
  const databaseProto = Object.getPrototypeOf(database);
  const session = database.withSession("first-unconstrained");
  const sessionProto = Object.getPrototypeOf(session);
  const statementProto = Object.getPrototypeOf(database.prepare("SELECT 1"));
  const withSession = databaseProto.withSession;
  databaseProto.withSession = function (constraint) {
    const created = withSession.call(this, constraint);
    sessions.set(created, constraint === "first-primary" ? "primary" : "replica");
    return created;
  };
  for (const [proto, target] of [[databaseProto, () => "direct"], [sessionProto, (self) => sessions.get(self) ?? "replica"]]) {
    const prepare = proto.prepare;
    proto.prepare = function (sql) {
      const statement = prepare.call(this, sql);
      statements.set(statement, { sql, target: target(this) });
      return statement;
    };
    const batch = proto.batch;
    proto.batch = guarded(batch, (_, [list]) => {
      counts.batches += 1;
      for (const statement of list) count(statement);
    });
  }
  const bind = statementProto.bind;
  statementProto.bind = function (...values) {
    const bound = bind.apply(this, values);
    statements.set(bound, statements.get(this));
    return bound;
  };
  for (const method of ["first", "all", "run", "raw"]) {
    statementProto[method] = guarded(statementProto[method], (self) => count(self));
  }
}

function patchCache() {
  if (patchedCache || typeof caches === "undefined") return;
  patchedCache = true;
  const proto = Object.getPrototypeOf(caches.default);
  const match = proto.match;
  proto.match = function (...args) {
    return match.apply(this, args).then((found) => {
      if (found) counts.cacheHits += 1;
      else counts.cacheMisses += 1;
      return found;
    });
  };
  const put = proto.put;
  proto.put = function (...args) {
    counts.cachePuts += 1;
    return track(put.apply(this, args));
  };
}

async function settle() {
  while (pending.size > 0) await Promise.all([...pending]);
}

export default {
  ...worker,
  async fetch(request, env, ctx) {
    patchDatabase(env.DB);
    patchCache();
    if (new URL(request.url).pathname === "${PROBE_PATH}") {
      await settle();
      const result = counts;
      counts = empty();
      return Response.json(result);
    }
    counts.requests += 1;
    const context = {
      waitUntil: (promise) => {
        track(promise);
        ctx.waitUntil(promise);
      },
      passThroughOnException: () => ctx.passThroughOnException(),
      props: ctx.props,
    };
    return worker.fetch(request, env, context);
  },
};
`;

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise<number | null>((done) => child.once("exit", done));
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${output.slice(-4_000)}`);
  return output;
}

async function ecKey(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateJwk: JSON.stringify({ ...privateJwk, kid, alg: "ES256" }),
    publicJwk: { ...publicJwk, kid, alg: "ES256", use: "sig" },
  };
}

async function testVars(): Promise<Record<string, string>> {
  const ticket = await ecKey(KEY_ID);
  const values: Record<string, string> = {
    AUTH_EXPOSE_DEVELOPMENT_CODE: "true",
    CF_ACCESS_TEAM_DOMAIN: "",
    CF_ACCESS_ADMIN_AUD: "",
    EMAIL_SMTP_HOST: "",
    EMAIL_SMTP_PORT: "",
    EMAIL_SMTP_USERNAME: "",
    EMAIL_SMTP_PASSWORD: "",
    EMAIL_FROM: "",
    SKILLS_ADMIN_TOKEN: crypto.randomUUID(),
    SITE_REPORT_HASH_SECRET: crypto.randomUUID(),
    REMOTE_TICKET_KEY_ID: KEY_ID,
    REMOTE_TICKET_PRIVATE_JWK: ticket.privateJwk,
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [ticket.publicJwk] }),
    REMOTE_AUTH_WEBHOOK_SECRET: crypto.randomUUID(),
    REMOTE_AUTH_WEBHOOK_URL: "",
    REMOTE_AUTH_WEBHOOK_URLS: "",
  };
  return values;
}

interface Worker {
  process: ChildProcess;
  origin: string;
  inspectorPort: number;
  log: () => string;
}

async function startWorker(app: string, config: string, state: string): Promise<Worker> {
  const port = await freePort();
  const inspectorPort = await freePort();
  const child = spawn(
    "bunx",
    [
      "wrangler",
      "dev",
      "--config",
      config,
      "--local",
      "--persist-to",
      state,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--local-upstream",
      `127.0.0.1:${port}`,
      "--show-interactive-dev-session=false",
      "--log-level",
      "log",
    ],
    { cwd: app, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk;
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev stopped:\n${output.slice(-4_000)}`);
    const ready = await fetch(`${origin}/v1/me`).then(
      (response) => response.status === 401,
      () => false,
    );
    if (ready) return { process: child, origin, inspectorPort, log: () => output };
    await new Promise((done) => setTimeout(done, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`wrangler dev did not answer:\n${output.slice(-4_000)}`);
}

async function stopWorker(worker: Worker): Promise<void> {
  if (worker.process.exitCode !== null) return;
  const exited = new Promise((done) => worker.process.once("exit", done));
  worker.process.kill("SIGTERM");
  await exited;
}

interface CallInit {
  method?: string;
  body?: string;
  token?: string;
  auth?: Route["auth"];
  headers?: Record<string, string>;
}

async function call(worker: Worker, path: string, init: CallInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.auth === "browser") {
    headers.set("Origin", worker.origin);
    headers.set("X-OpenBot-Browser", "1");
    headers.set("Sec-Fetch-Site", "same-origin");
    if (init.token) headers.set("Cookie", `__Host-openbot-web=${init.token}`);
  } else if (init.auth === "bearer" && init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  return await fetch(`${worker.origin}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body ? { body: init.body } : {}),
  });
}

const CountsSchema = Schema.Struct({
  requests: Schema.Number,
  statements: Schema.Number,
  batches: Schema.Number,
  direct: Schema.Number,
  primary: Schema.Number,
  replica: Schema.Number,
  reads: Schema.Number,
  writes: Schema.Number,
  cacheHits: Schema.Number,
  cacheMisses: Schema.Number,
  cachePuts: Schema.Number,
});
type Counts = typeof CountsSchema.Type;
const decodeCounts = Schema.decodeUnknownSync(Schema.fromJsonString(CountsSchema));

async function takeCounts(worker: Worker): Promise<Counts> {
  return decodeCounts(await (await fetch(`${worker.origin}${PROBE_PATH}`)).text());
}

const decodeEmailStarted = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ challengeId: Schema.NonEmptyString, developmentCode: Schema.NonEmptyString })),
);
const decodeEmailVerified = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ sessionToken: Schema.NonEmptyString })),
);
const decodeRemoteSessionStarted = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      session: Schema.optionalKey(Schema.Struct({ sessionId: Schema.NonEmptyString })),
      sessionId: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
);

async function signIn(worker: Worker): Promise<Session> {
  const started = decodeEmailStarted(
    await (
      await call(worker, "/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email: EMAIL }) })
    ).text(),
  );
  const verified = decodeEmailVerified(
    await (
      await call(worker, "/v1/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId: started.challengeId, code: started.developmentCode }),
      })
    ).text(),
  );
  const token = verified.sessionToken;
  const registered = await call(worker, "/v2/remote/hosts/register", {
    method: "POST",
    auth: "bearer",
    token,
    body: JSON.stringify({ hostId: HOST_ID, name: "Worker cost host", ownerMembershipId: "worker-cost-owner" }),
  });
  if (registered.status !== 201) {
    throw new Error(`Host registration answered ${registered.status}: ${await registered.text()}`);
  }
  const remote = decodeRemoteSessionStarted(
    await (
      await call(worker, "/v2/remote/sessions", {
        method: "POST",
        auth: "bearer",
        token,
        body: JSON.stringify({ hostId: HOST_ID }),
      })
    ).text(),
  );
  const sessionId = remote.session?.sessionId ?? remote.sessionId;
  if (!sessionId) throw new Error("The remote session response has no sessionId.");
  return { token, sessionId };
}

const CpuProfileSchema = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      callFrame: Schema.Struct({ functionName: Schema.String, url: Schema.String, lineNumber: Schema.Number }),
    }),
  ),
  samples: Schema.Array(Schema.Number),
  timeDeltas: Schema.Array(Schema.Number),
});
type CpuProfile = typeof CpuProfileSchema.Type;

const decodeInspectorReply = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ id: Schema.Number })));
const decodeProfileReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ result: Schema.Struct({ profile: CpuProfileSchema }) })),
);
const decodeInspectorTargets = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ webSocketDebuggerUrl: Schema.optionalKey(Schema.String) })),
);

class Inspector {
  readonly #socket: WebSocket;
  #nextId = 1;
  readonly #pending = new Map<number, (reply: string) => void>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const reply = String(event.data);
      const message = decodeInspectorReply(reply);
      if (Option.isNone(message)) return;
      this.#pending.get(message.value.id)?.(reply);
      this.#pending.delete(message.value.id);
    });
  }

  static async connect(port: number): Promise<Inspector> {
    const targets = decodeInspectorTargets(await (await fetch(`http://127.0.0.1:${port}/json`)).json());
    const url = targets.find((entry) => entry.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/`;
    const socket = new WebSocket(url);
    await new Promise<void>((done, reject) => {
      socket.addEventListener("open", () => done(), { once: true });
      socket.addEventListener("error", () => reject(new Error("The inspector did not open.")), { once: true });
    });
    const inspector = new Inspector(socket);
    await inspector.send("Profiler.enable");
    await inspector.send("Profiler.setSamplingInterval", { interval: SAMPLE_INTERVAL_US });
    return inspector;
  }

  async send(method: string, params: { interval?: number } = {}): Promise<string> {
    const id = this.#nextId++;
    const reply = new Promise<string>((done) => this.#pending.set(id, done));
    this.#socket.send(JSON.stringify({ id, method, params }));
    return await reply;
  }

  async stopProfile(): Promise<CpuProfile> {
    return decodeProfileReply(await this.send("Profiler.stop")).result.profile;
  }

  close(): void {
    this.#socket.close();
  }
}

function busyMs(profile: CpuProfile): number {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  let busyUs = 0;
  profile.samples.forEach((sample, index) => {
    if (nodes.get(sample)?.callFrame.functionName === "(idle)") return;
    busyUs += profile.timeDeltas[index] ?? 0;
  });
  return busyUs / 1_000;
}

function topFrames(profile: CpuProfile, requests: number) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const byFrame = new Map<string, number>();
  profile.samples.forEach((sample, index) => {
    const node = nodes.get(sample);
    if (!node || node.callFrame.functionName === "(idle)") return;
    const file = node.callFrame.url.split("/").pop() || "(native)";
    const frame = `${node.callFrame.functionName || "(anonymous)"} ${file}:${node.callFrame.lineNumber + 1}`;
    byFrame.set(frame, (byFrame.get(frame) ?? 0) + (profile.timeDeltas[index] ?? 0));
  });
  return [...byFrame.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, us]) => ({ name, msPerRequest: round(us / 1_000 / requests) }));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface RouteResult {
  route: string;
  status: number;
  requests: number;
  wallMsP50: number;
  cpuMsPerRequest: number;
  d1PerRequest: { statements: number; primary: number; replica: number; direct: number; reads: number; writes: number };
  cache: { hits: number; misses: number; puts: number };
  topFrames: { name: string; msPerRequest: number }[];
}

async function callRoute(worker: Worker, session: Session, route: Route): Promise<number> {
  const response = await call(worker, route.path, {
    method: route.method,
    auth: route.auth,
    token: session.token,
    ...(route.headers ? { headers: route.headers } : {}),
    ...(route.body ? { body: JSON.stringify(route.body()) } : {}),
  });
  await response.arrayBuffer();
  if (!route.expectStatus.includes(response.status)) {
    throw new Error(`${route.name} answered ${response.status}, expected ${route.expectStatus.join(" or ")}.`);
  }
  return response.status;
}

async function measureRoute(
  worker: Worker,
  inspector: Inspector,
  session: Session,
  route: Route,
  requests: number,
): Promise<RouteResult> {
  for (let warm = 0; warm < 3; warm += 1) await callRoute(worker, session, route);
  await takeCounts(worker);
  const wallMs: number[] = [];
  let status = 0;
  await inspector.send("Profiler.start");
  for (let index = 0; index < requests; index += 1) {
    const started = performance.now();
    status = await callRoute(worker, session, route);
    wallMs.push(performance.now() - started);
  }
  const profile = await inspector.stopProfile();
  const counts = await takeCounts(worker);
  if (counts.requests !== requests) throw new Error(`${route.name}: the probe saw ${counts.requests} requests.`);
  const per = (value: number) => round(value / requests);
  return {
    route: route.name,
    status,
    requests,
    wallMsP50: round(median(wallMs)),
    cpuMsPerRequest: round(busyMs(profile) / requests),
    d1PerRequest: {
      statements: per(counts.statements),
      primary: per(counts.primary),
      replica: per(counts.replica),
      direct: per(counts.direct),
      reads: per(counts.reads),
      writes: per(counts.writes),
    },
    cache: { hits: counts.cacheHits, misses: counts.cacheMisses, puts: counts.cachePuts },
    topFrames: topFrames(profile, requests),
  };
}

interface PageCheck {
  name: string;
  passed: boolean;
  detail?: unknown;
}

const PAGE_HEADERS = [
  "cache-control",
  "content-type",
  "vary",
  "content-security-policy",
  "x-frame-options",
  "x-robots-tag",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
  "set-cookie",
];

interface PageView {
  status: number;
  body: string;
  locale: string | null;
  headers: Record<string, string | null>;
  internalHeaders: string[];
}

async function viewPage(worker: Worker, path: string, headers: Record<string, string>): Promise<PageView> {
  const response = await fetch(`${worker.origin}${path}`, { headers });
  const body = await response.text();
  return {
    status: response.status,
    body,
    locale: /\blocale:"([a-z]+)"/u.exec(body)?.[1] ?? null,
    headers: Object.fromEntries(PAGE_HEADERS.map((name) => [name, response.headers.get(name)])),
    internalHeaders: [...response.headers.keys()].filter((name) => name.startsWith("x-openbot-page-cache")),
  };
}

function sameRender(left: PageView, right: PageView): boolean {
  const withoutMatchTimes = (body: string) => body.replace(/\bu:\d+/gu, "u:0");
  return withoutMatchTimes(left.body) === withoutMatchTimes(right.body);
}

async function pageChecks(worker: Worker, session: Session) {
  const checks: PageCheck[] = [];
  const check = (name: string, passed: boolean, detail?: unknown) =>
    checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  const english = { "Accept-Language": "en-US,en;q=0.9" };
  const german = { "Accept-Language": "de-DE,de;q=0.9" };
  const signedIn = { ...english, Cookie: `__Host-openbot-web=${session.token}; op_visitor=worker-cost-visitor` };
  const cacheUse: Record<string, { firstGermanVisit: Counts; secondGermanVisit: Counts }> = {};
  for (const path of PAGE_PATHS) {
    await takeCounts(worker);
    const germanFirst = await viewPage(worker, path, german);
    const firstCounts = await takeCounts(worker);
    const germanSecond = await viewPage(worker, path, german);
    const secondCounts = await takeCounts(worker);
    const anonymous = await viewPage(worker, path, english);
    const withCookie = await viewPage(worker, path, signedIn);
    const chosen = await viewPage(worker, path, { ...english, Cookie: "openbot_lang=fr" });
    cacheUse[path] = { firstGermanVisit: firstCounts, secondGermanVisit: secondCounts };
    check(
      `${path}: the first visit in a new locale stores the page and the second reads it`,
      firstCounts.cacheHits === 0 &&
        firstCounts.cachePuts === 1 &&
        secondCounts.cacheHits === 1 &&
        secondCounts.cachePuts === 0,
      { first: firstCounts, second: secondCounts },
    );
    check(
      `${path}: a second visit gets the same page`,
      germanFirst.status === 200 && sameRender(germanFirst, germanSecond),
    );
    check(
      `${path}: a second visit gets the same response headers`,
      JSON.stringify(germanFirst.headers) === JSON.stringify(germanSecond.headers),
      { first: germanFirst.headers, second: germanSecond.headers },
    );
    check(`${path}: a signed-in visit gets the same page`, sameRender(anonymous, withCookie));
    check(
      `${path}: no Set-Cookie`,
      [germanFirst, germanSecond, anonymous, withCookie].every((view) => view.headers["set-cookie"] === null),
    );
    check(
      `${path}: no internal cache header reaches the visitor`,
      [germanFirst, germanSecond, anonymous, withCookie].every((view) => view.internalHeaders.length === 0),
    );
    check(
      `${path}: Accept-Language selects the page locale`,
      germanSecond.locale === "de" && anonymous.locale === "en",
      {
        german: germanSecond.locale,
        english: anonymous.locale,
      },
    );
    check(`${path}: the language cookie selects the page locale`, chosen.locale === "fr", { locale: chosen.locale });
  }
  checks.push({ name: "page cache use per visit", passed: true, detail: cacheUse });
  await takeCounts(worker);
  const referral = await viewPage(worker, "/?ref=worker-cost", english);
  const referralCounts = await takeCounts(worker);
  check(
    "/?ref: a page with a query is not cached",
    referral.status === 200 && referralCounts.cachePuts === 0 && referralCounts.cacheHits === 0,
    referralCounts,
  );
  const head = await fetch(`${worker.origin}/app`, { method: "HEAD", headers: english });
  check("HEAD /app still answers", head.status === 200);
  const appHtml = await viewPage(worker, "/app", english);
  const assets = [
    ...new Set([...appHtml.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/gu)].map((match) => match[1])),
  ];
  await takeCounts(worker);
  for (const asset of assets) await (await fetch(`${worker.origin}${asset}`)).arrayBuffer();
  const assetCounts = await takeCounts(worker);
  check("the /app assets are static and do not start the Worker", assets.length > 0 && assetCounts.requests === 0, {
    assets: assets.length,
    workerRequests: assetCounts.requests,
  });
  const missing = await fetch(`${worker.origin}${MISSING_ASSET}`);
  const missingBody = await missing.text();
  check("a missing asset answers 404 with no page", missing.status === 404 && missingBody.length === 0, {
    bytes: missingBody.length,
    contentType: missing.headers.get("content-type"),
    cacheControl: missing.headers.get("cache-control"),
  });
  return { checks, appAssets: assets.length };
}

async function prepareProbe(
  app: string,
  vars: Record<string, string>,
): Promise<{ config: string; cleanup: () => Promise<void> }> {
  const server = join(app, "dist", "server");
  const built = JSON.parse(await readFile(join(server, "wrangler.json"), "utf8"));
  if (built.main !== "index.js") throw new Error(`Unexpected Worker entry: ${built.main}`);
  const probe = join(server, PROBE_MODULE);
  const configDirectory = await mkdtemp(join(OUT, "config-"));
  const config = join(configDirectory, PROBE_CONFIG);
  await writeFile(probe, PROBE_SOURCE);
  const required: string[] = built.secrets?.required ?? [];
  await writeFile(
    config,
    JSON.stringify({
      ...built,
      main: probe,
      assets: { ...built.assets, directory: resolve(server, built.assets.directory) },
      d1_databases: built.d1_databases.map((database: { migrations_dir: string }) => ({
        ...database,
        migrations_dir: resolve(server, database.migrations_dir),
      })),
      vars: { ...built.vars, ...vars },
      secrets: { ...built.secrets, required: required.filter((name) => !(name in vars)) },
    }),
  );
  return {
    config,
    cleanup: async () => {
      await rm(probe, { force: true });
      await rm(configDirectory, { recursive: true, force: true });
    },
  };
}

async function measureBuild(build: Build, options: Options) {
  const state = join(OUT, `state-${build.label}`);
  await rm(state, { recursive: true, force: true });
  const probe = await prepareProbe(build.app, await testVars());
  try {
    await run(
      "bunx",
      ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", probe.config],
      build.app,
      { ...process.env, CI: "1" },
    );
    const worker = await startWorker(build.app, probe.config, state);
    try {
      const session = await signIn(worker);
      const inspector = await Inspector.connect(worker.inspectorPort);
      try {
        const results: RouteResult[] = [];
        for (const route of routes(session)) {
          const result = await measureRoute(worker, inspector, session, route, options.requests);
          console.log(
            `[${build.label}] ${result.route.padEnd(48)} cpu ${String(result.cpuMsPerRequest).padStart(6)} ms  wall p50 ${String(result.wallMsP50).padStart(6)} ms  D1 ${result.d1PerRequest.statements} (primary ${result.d1PerRequest.primary}, replica ${result.d1PerRequest.replica}, direct ${result.d1PerRequest.direct})`,
          );
          results.push(result);
        }
        const pages = await pageChecks(worker, session);
        return { label: build.label, routes: results, pages };
      } finally {
        inspector.close();
      }
    } finally {
      await stopWorker(worker);
    }
  } finally {
    await probe.cleanup();
  }
}

async function prepareBefore(commit: string): Promise<{ build: Build; cleanup: () => Promise<void> }> {
  const sha = (await run("git", ["rev-parse", "--verify", `${commit}^{commit}`], ROOT)).trim();
  const directory = await mkdtemp(join(tmpdir(), "openbot-worker-cost-"));
  const checkout = join(directory, "checkout");
  await run("git", ["worktree", "add", "--detach", checkout, sha], ROOT);
  const cleanup = async () => {
    await run("git", ["worktree", "remove", "--force", checkout], ROOT).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], checkout);
    const app = join(checkout, "apps", "auth-api");
    await run("bun", ["run", "build"], app);
    return { build: { label: `before-${sha.slice(0, 10)}`, app }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

type Measured = Awaited<ReturnType<typeof measureBuild>>;

function afterChecks(after: Measured): PageCheck[] {
  const checks: PageCheck[] = [...after.pages.checks];
  const byName = new Map(after.routes.map((route) => [route.route, route]));
  for (const path of PAGE_PATHS) {
    const page = byName.get(`GET ${path} (page)`);
    checks.push({
      name: `${path}: repeated visits come from the cache`,
      passed: page !== undefined && page.cache.hits === page.requests && page.cache.puts === 0,
      detail: page?.cache,
    });
  }
  const signedIn = byName.get("GET /app (page, signed in)");
  checks.push({
    name: "/app signed in: comes from the same cache entry",
    passed: signedIn !== undefined && signedIn.cache.hits === signedIn.requests && signedIn.cache.puts === 0,
    detail: signedIn?.cache,
  });
  const missing = byName.get("GET /assets/:id (missing)");
  checks.push({
    name: "a missing asset does not render a page",
    passed: missing !== undefined && missing.d1PerRequest.statements === 0 && missing.cache.puts === 0,
    detail: missing && { cpuMsPerRequest: missing.cpuMsPerRequest },
  });
  for (const route of after.routes.filter(
    (entry) => entry.route.includes("(page") || entry.route.includes("/assets/"),
  )) {
    checks.push({
      name: `${route.route}: no D1 statement`,
      passed: route.d1PerRequest.statements === 0,
      detail: route.d1PerRequest,
    });
  }
  return checks;
}

function comparison(before: Measured, after: Measured) {
  const beforeByName = new Map(before.routes.map((route) => [route.route, route]));
  return after.routes.map((route) => {
    const base = beforeByName.get(route.route);
    return {
      route: route.route,
      cpuMs: { before: base?.cpuMsPerRequest ?? null, after: route.cpuMsPerRequest },
      wallMsP50: { before: base?.wallMsP50 ?? null, after: route.wallMsP50 },
      d1Statements: { before: base?.d1PerRequest.statements ?? null, after: route.d1PerRequest.statements },
      d1Primary: { before: base?.d1PerRequest.primary ?? null, after: route.d1PerRequest.primary },
      d1Replica: { before: base?.d1PerRequest.replica ?? null, after: route.d1PerRequest.replica },
      d1Direct: { before: base?.d1PerRequest.direct ?? null, after: route.d1PerRequest.direct },
    };
  });
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  const app = join(ROOT, "apps", "auth-api");
  if (options.build) await run("bun", ["run", "build"], app);
  if (!existsSync(join(app, "dist", "server", "wrangler.json"))) {
    throw new Error("Build the Worker first: bun run api:build, or leave out --no-build.");
  }
  const before = options.before ? await prepareBefore(options.before) : null;
  try {
    const beforeResult = before ? await measureBuild(before.build, options) : null;
    const after = await measureBuild({ label: "after", app }, options);
    const checks = afterChecks(after);
    const passed = checks.every((entry) => entry.passed);
    const report = {
      generatedAt: new Date().toISOString(),
      requestsPerRoute: options.requests,
      sampleIntervalUs: SAMPLE_INTERVAL_US,
      passed,
      checks,
      after,
      ...(beforeResult ? { before: beforeResult, comparison: comparison(beforeResult, after) } : {}),
    };
    const reportPath = join(OUT, "report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
    console.log(`Report: ${reportPath}`);
    if (!passed) process.exitCode = 1;
  } finally {
    await before?.cleanup();
  }
}

await main();
