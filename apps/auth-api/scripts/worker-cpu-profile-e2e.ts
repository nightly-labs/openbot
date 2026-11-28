import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { Option, Schema } from "effect";

const ROOT = resolve(import.meta.dirname, "../../..");
const APP = join(ROOT, "apps", "auth-api");
const OUT = join(ROOT, ".openbot-build", "worker-cpu");
const STATE = join(OUT, "state");
const BUILT_CONFIG = join(APP, "dist", "server", "wrangler.json");
const KEY_ID = "worker-cpu-profile-1";
const EMAIL = "worker-cpu-profile@example.test";
const HOST_ID = "worker-cpu-profile-host";
const SAMPLE_INTERVAL_US = 50;

interface Options {
  label: string;
  requests: number;
  build: boolean;
  cold: boolean;
  coldRoute: string | null;
  webhooks: boolean;
  productionSettings: boolean;
}

function readOptions(argv: readonly string[]): Options {
  const value = (name: string) => argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const requests = Number(value("requests") ?? "40");
  if (!Number.isInteger(requests) || requests < 1) throw new Error("--requests must be a positive integer.");
  return {
    label: value("label") ?? "current",
    requests,
    build: argv.includes("--build"),
    cold: argv.includes("--cold"),
    coldRoute: value("cold-route") ?? null,
    webhooks: !argv.includes("--no-webhooks"),
    productionSettings: argv.includes("--production-settings"),
  };
}

interface Route {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: () => unknown;
  browser?: boolean;
  page?: { lang: string };
  expectStatus: readonly number[];
}

interface Session {
  token: string;
  sessionId: string;
}

function routes(session: Session): Route[] {
  const clientPublicKey = () => ({ clientPublicKey: `cpk-${crypto.randomUUID()}` });
  return [
    { name: "GET /v1/me", method: "GET", path: "/v1/me", expectStatus: [200] },
    { name: "GET /v2/remote/hosts", method: "GET", path: "/v2/remote/hosts", expectStatus: [200] },
    {
      name: "GET /v2/remote/owner-transfers",
      method: "GET",
      path: "/v2/remote/owner-transfers",
      expectStatus: [200],
    },
    {
      name: "POST /v2/remote/sessions/:id/ticket",
      method: "POST",
      path: `/v2/remote/sessions/${session.sessionId}/ticket`,
      body: clientPublicKey,
      expectStatus: [200],
    },
    {
      name: "POST /api/browser/v2/remote/sessions/:id/ticket",
      method: "POST",
      path: `/api/browser/v2/remote/sessions/${session.sessionId}/ticket`,
      body: clientPublicKey,
      browser: true,
      expectStatus: [200],
    },
    { name: "GET /v1/me/credits", method: "GET", path: "/v1/me/credits", expectStatus: [200] },
    {
      name: "GET /v2/hosting/servers/:id/status",
      method: "GET",
      path: "/v2/hosting/servers/worker-cpu-profile-missing/status",
      expectStatus: [404, 409, 503],
    },
    {
      name: "POST /v2/hosting/servers/:id/wake",
      method: "POST",
      path: "/v2/hosting/servers/worker-cpu-profile-missing/wake",
      body: () => ({}),
      expectStatus: [404, 409, 503],
    },
    {
      name: "POST /v2/remote/hosts/register",
      method: "POST",
      path: "/v2/remote/hosts/register",
      body: () => ({ hostId: HOST_ID, name: "CPU profile host", ownerMembershipId: "worker-cpu-profile-owner" }),
      expectStatus: [201],
    },
    { name: "GET / (page)", method: "GET", path: "/", page: { lang: "en" }, expectStatus: [200] },
    { name: "GET /de/pricing (page)", method: "GET", path: "/de/pricing", page: { lang: "de" }, expectStatus: [200] },
  ];
}

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

async function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const child = spawn(command, args, { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
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
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    privateJwk: JSON.stringify({ ...privateJwk, kid, alg: "ES256" }),
    publicJwk: { ...publicJwk, kid, alg: "ES256", use: "sig" },
    pem: pem("PRIVATE KEY", pkcs8),
  };
}

async function rsaPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  return pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey));
}

function pem(label: string, der: ArrayBuffer): string {
  const body =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/gu)
      ?.join("\\n") ?? "";
  return `-----BEGIN ${label}-----\\n${body}\\n-----END ${label}-----`;
}

async function signingKeys() {
  const ticket = await ecKey(KEY_ID);
  const slack = await ecKey("worker-cpu-profile-slack");
  const discord = await ecKey("worker-cpu-profile-discord");
  return {
    privateJwk: ticket.privateJwk,
    publicJwks: JSON.stringify({ keys: [ticket.publicJwk, slack.publicJwk, discord.publicJwk] }),
    slack,
    discord,
  };
}

async function productionSettings(keys: Awaited<ReturnType<typeof signingKeys>>, hookOrigin: string) {
  const apns = await ecKey("worker-cpu-profile-apns");
  const githubKey = await rsaPem();
  return {
    SLACK_ROUTE_PRIVATE_JWK: keys.slack.privateJwk,
    SLACK_ROUTE_KEY_ID: "worker-cpu-profile-slack",
    SLACK_CLIENT_ID: "worker-cpu-profile",
    SLACK_CLIENT_SECRET: crypto.randomUUID(),
    SLACK_STATE_SECRET: crypto.randomUUID(),
    DISCORD_ROUTE_PRIVATE_JWK: keys.discord.privateJwk,
    DISCORD_ROUTE_KEY_ID: "worker-cpu-profile-discord",
    DISCORD_CLIENT_ID: "worker-cpu-profile",
    DISCORD_CLIENT_SECRET: crypto.randomUUID(),
    DISCORD_STATE_SECRET: crypto.randomUUID(),
    TELEGRAM_BOT_ID: "1234567890",
    TELEGRAM_BOT_USERNAME: "worker_cpu_profile_bot",
    STRIPE_WEBHOOK_SECRET: `whsec_${crypto.randomUUID()}`,
    COMPANY_SIGN_IN_SECRET: crypto.randomUUID(),
    HOSTED_SERVER_TEMPLATE: "worker-cpu-profile-template",
    HOSTED_SERVERS_DEVELOPER_KEY: crypto.randomUUID(),
    HOSTED_POOL_ALERT_WEBHOOK_URL: `${hookOrigin}/pool-alert`,
    BOAT_API_KEY: crypto.randomUUID(),
    BOAT_WEBHOOK_SECRET: crypto.randomUUID(),
    HOSTED_ARCHIVE_KEY_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    B2_WORKER_KEY_ID_EU: "worker-cpu-profile",
    B2_WORKER_APPLICATION_KEY_EU: crypto.randomUUID(),
    GITHUB_APP_PRIVATE_KEY: githubKey,
    APNS_PRIVATE_KEY: apns.pem,
    APNS_KEY_ID: "WORKERCPU1",
    APNS_ORIGIN: `${hookOrigin}/apns`,
    NEAR_INTENTS_PARTNER_KEY: crypto.randomUUID(),
    NEAR_INTENTS_AGENT_API_URL: `${hookOrigin}/near`,
    VIES_REQUESTER_VAT_ID: "PL0000000000",
  };
}

function startWebhookReceiver() {
  let received = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      await request.arrayBuffer();
      received += 1;
      return Response.json({ accepted: true });
    },
  });
  const urls = ["a", "b", "us", "au", "sg"].map(
    (home) => `http://127.0.0.1:${server.port}/${home}/internal/auth-events`,
  );
  return { origin: `http://127.0.0.1:${server.port}`, urls, received: () => received, stop: () => server.stop(true) };
}

async function writeEnvFile(
  path: string,
  options: Options,
  webhookUrls: readonly string[],
  hookOrigin: string,
): Promise<void> {
  const keys = await signingKeys();
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
    REMOTE_TICKET_PRIVATE_JWK: keys.privateJwk,
    REMOTE_TICKET_PUBLIC_JWKS: keys.publicJwks,
    REMOTE_AUTH_WEBHOOK_SECRET: crypto.randomUUID(),
    REMOTE_AUTH_WEBHOOK_URL: webhookUrls[0] ?? "",
    REMOTE_AUTH_WEBHOOK_URLS: webhookUrls.join(","),
    ...(options.productionSettings ? await productionSettings(keys, hookOrigin) : {}),
  };
  const lines = Object.entries(values).map(([key, value]) => `${key}='${value}'`);
  await writeFile(path, `${lines.join("\n")}\n`);
}

interface Worker {
  process: ChildProcess;
  origin: string;
  inspectorPort: number;
  log: () => string;
}

async function startWorker(
  envFile: string,
  readyWhen: "request" | "log" = "request",
  config: string = BUILT_CONFIG,
): Promise<Worker> {
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
      STATE,
      "--env-file",
      envFile,
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
    { cwd: APP, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] },
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
    const ready =
      readyWhen === "log"
        ? output.includes("Ready on")
        : await fetch(`${origin}/v1/me`).then(
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

async function api(worker: Worker, path: string, init: RequestInit & { token?: string; browser?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.browser) {
    headers.set("Origin", worker.origin);
    headers.set("X-OpenBot-Browser", "1");
    headers.set("Sec-Fetch-Site", "same-origin");
    if (init.token) headers.set("Cookie", `__Host-openbot-web=${init.token}`);
  } else if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  return await fetch(`${worker.origin}${path}`, { ...init, headers });
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
      await api(worker, "/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email: EMAIL }) })
    ).text(),
  );
  const verified = decodeEmailVerified(
    await (
      await api(worker, "/v1/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId: started.challengeId, code: started.developmentCode }),
      })
    ).text(),
  );
  const token = verified.sessionToken;
  const registered = await api(worker, "/v2/remote/hosts/register", {
    method: "POST",
    token,
    body: JSON.stringify({ hostId: HOST_ID, name: "CPU profile host", ownerMembershipId: "worker-cpu-profile-owner" }),
  });
  if (registered.status !== 201)
    throw new Error(
      `Host registration failed with ${registered.status}: ${await registered.text()}\n${worker.log().slice(-3_000)}`,
    );
  const remote = decodeRemoteSessionStarted(
    await (
      await api(worker, "/v2/remote/sessions", { method: "POST", token, body: JSON.stringify({ hostId: HOST_ID }) })
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
      children: Schema.optionalKey(Schema.Array(Schema.Number)),
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
    return new Inspector(socket);
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

const IDLE_FRAMES = new Set(["(idle)"]);

function summarize(profile: CpuProfile, requests: number) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfByFrame = new Map<string, number>();
  const selfByFile = new Map<string, number>();
  let busyUs = 0;
  profile.samples.forEach((sample, index) => {
    const node = nodes.get(sample);
    const delta = profile.timeDeltas[index] ?? 0;
    if (!node || IDLE_FRAMES.has(node.callFrame.functionName)) return;
    busyUs += delta;
    const file = node.callFrame.url.split("/").pop() || "(native)";
    const frame = `${node.callFrame.functionName || "(anonymous)"} ${file}:${node.callFrame.lineNumber + 1}`;
    selfByFrame.set(frame, (selfByFrame.get(frame) ?? 0) + delta);
    selfByFile.set(file, (selfByFile.get(file) ?? 0) + delta);
  });
  const top = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([name, us]) => ({ name, msPerRequest: round(us / 1_000 / requests) }));
  return { cpuMsPerRequest: round(busyUs / 1_000 / requests), topFrames: top(selfByFrame), topFiles: top(selfByFile) };
}

function moduleInits(profile: CpuProfile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<number, number>();
  profile.samples.forEach((sample, index) => {
    self.set(sample, (self.get(sample) ?? 0) + (profile.timeDeltas[index] ?? 0));
  });
  const inclusive = new Map<number, number>();
  const total = (id: number): number => {
    const known = inclusive.get(id);
    if (known !== undefined) return known;
    const node = nodes.get(id);
    const value = (self.get(id) ?? 0) + (node?.children ?? []).reduce((sum, child) => sum + total(child), 0);
    inclusive.set(id, value);
    return value;
  };
  const byInit = new Map<string, number>();
  let outermostUs = 0;
  const walk = (id: number, insideInit: boolean) => {
    const node = nodes.get(id);
    if (!node) return;
    const isInit = node.callFrame.functionName.startsWith("init_");
    if (isInit) {
      byInit.set(node.callFrame.functionName, (byInit.get(node.callFrame.functionName) ?? 0) + total(id));
      if (!insideInit) outermostUs += total(id);
    }
    for (const child of node.children ?? []) walk(child, insideInit || isInit);
  };
  const root = profile.nodes[0];
  if (root) walk(root.id, false);
  return {
    moduleInitMs: round(outermostUs / 1_000),
    topModuleInits: [...byInit.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([name, us]) => ({ name, ms: round(us / 1_000) })),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function callRoute(worker: Worker, session: Session, route: Route): Promise<number> {
  const response = await api(worker, route.path, {
    method: route.method,
    ...(route.page ? {} : { token: session.token }),
    ...(route.browser ? { browser: true } : {}),
    ...(route.body ? { body: JSON.stringify(route.body()) } : {}),
  });
  const body = await response.text();
  if (!route.expectStatus.includes(response.status)) {
    throw new Error(`${route.name} answered ${response.status}, expected ${route.expectStatus.join(" or ")}.`);
  }
  const lang = /<html[^>]*\slang="([^"]+)"/u.exec(body)?.[1];
  if (route.page && lang !== route.page.lang) {
    throw new Error(`${route.name} rendered lang="${lang}", expected lang="${route.page.lang}".`);
  }
  return response.status;
}

async function measureRoute(worker: Worker, inspector: Inspector, session: Session, route: Route, requests: number) {
  for (let warm = 0; warm < 5; warm += 1) await callRoute(worker, session, route);
  const wallMs: number[] = [];
  let status = 0;
  await inspector.send("Profiler.start");
  for (let index = 0; index < requests; index += 1) {
    const started = performance.now();
    status = await callRoute(worker, session, route);
    wallMs.push(performance.now() - started);
  }
  const profile = await inspector.stopProfile();
  return {
    route: route.name,
    status,
    requests,
    wallMsP50: round(median(wallMs)),
    ...summarize(profile, requests),
  };
}

async function profileOnce(inspector: Inspector, call: () => Promise<number>) {
  await inspector.send("Profiler.enable");
  await inspector.send("Profiler.setSamplingInterval", { interval: SAMPLE_INTERVAL_US });
  await inspector.send("Profiler.start");
  const started = performance.now();
  const status = await call();
  const wallMs = performance.now() - started;
  const profile = await inspector.stopProfile();
  return { status, wallMs: round(wallMs), profile };
}

function profileFileName(route: string): string {
  return route
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
}

const STARTUP_PROBE_MODULE = "worker-cpu-startup-probe.js";
const STARTUP_PROBE_CONFIG = join(APP, "dist", "server", "worker-cpu-startup-probe.json");

async function measureStartup(envFile: string) {
  const built = JSON.parse(await readFile(BUILT_CONFIG, "utf8"));
  const probe = join(APP, "dist", "server", STARTUP_PROBE_MODULE);
  await writeFile(
    probe,
    `export default { async fetch() { await import("./${built.main}"); return new Response("ok"); } };\n`,
  );
  await writeFile(STARTUP_PROBE_CONFIG, JSON.stringify({ ...built, main: STARTUP_PROBE_MODULE }));
  try {
    const worker = await startWorker(envFile, "log", STARTUP_PROBE_CONFIG);
    try {
      const inspector = await Inspector.connect(worker.inspectorPort);
      try {
        const startup = await profileOnce(inspector, async () => (await fetch(`${worker.origin}/`)).status);
        await writeFile(join(OUT, "startup.cpuprofile"), JSON.stringify(startup.profile));
        const summary = summarize(startup.profile, 1);
        return { status: startup.status, startupCpuMs: summary.cpuMsPerRequest, topFiles: summary.topFiles };
      } finally {
        inspector.close();
      }
    } finally {
      await stopWorker(worker);
    }
  } finally {
    await rm(probe, { force: true });
    await rm(STARTUP_PROBE_CONFIG, { force: true });
  }
}

const BASE_ROUTES = new Set(["GET /v1/me", "GET /v2/remote/hosts", "POST /v2/remote/sessions/:id/ticket"]);

async function measureColdRoute(envFile: string, session: Session, route: Route) {
  const worker = await startWorker(envFile, "log");
  try {
    const inspector = await Inspector.connect(worker.inspectorPort);
    try {
      const isolate = await profileOnce(inspector, () => callRoute(worker, session, route));
      await writeFile(join(OUT, `${profileFileName(route.name)}.cold.cpuprofile`), JSON.stringify(isolate.profile));
      await stopWorker(worker);
      const warmWorker = await startWorker(envFile, "log");
      try {
        const warmInspector = await Inspector.connect(warmWorker.inspectorPort);
        try {
          for (const base of routes(session).filter(
            (entry) => BASE_ROUTES.has(entry.name) && entry.name !== route.name,
          )) {
            for (let warm = 0; warm < 3; warm += 1) await callRoute(warmWorker, session, base);
          }
          const first = await profileOnce(warmInspector, () => callRoute(warmWorker, session, route));
          const second = await profileOnce(warmInspector, () => callRoute(warmWorker, session, route));
          const isolateInits = moduleInits(isolate.profile);
          const isolateSummary = summarize(isolate.profile, 1);
          return {
            route: route.name,
            status: first.status,
            coldIsolateCpuMs: isolateSummary.cpuMsPerRequest,
            coldIsolate: {
              moduleInitMs: isolateInits.moduleInitMs,
              topModuleInits: isolateInits.topModuleInits,
              topFrames: isolateSummary.topFrames,
              topFiles: isolateSummary.topFiles,
            },
            firstCallCpuMs: summarize(first.profile, 1).cpuMsPerRequest,
            secondCallCpuMs: summarize(second.profile, 1).cpuMsPerRequest,
            ...moduleInits(first.profile),
            topFrames: summarize(first.profile, 1).topFrames,
          };
        } finally {
          warmInspector.close();
        }
      } finally {
        await stopWorker(warmWorker);
      }
    } finally {
      inspector.close();
    }
  } finally {
    await stopWorker(worker);
  }
}

async function measureWarm(envFile: string, options: Options) {
  const worker = await startWorker(envFile);
  try {
    const session = await signIn(worker);
    const inspector = await Inspector.connect(worker.inspectorPort);
    try {
      await inspector.send("Profiler.enable");
      await inspector.send("Profiler.setSamplingInterval", { interval: SAMPLE_INTERVAL_US });
      const results = [];
      for (const route of routes(session)) {
        const result = await measureRoute(worker, inspector, session, route, options.requests);
        console.log(
          `${result.route.padEnd(52)} cpu ${String(result.cpuMsPerRequest).padStart(7)} ms  wall p50 ${result.wallMsP50} ms`,
        );
        results.push(result);
      }
      return { session, results };
    } finally {
      inspector.close();
    }
  } finally {
    await stopWorker(worker);
  }
}

const decodePreviousReport = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ runs: Schema.Record(Schema.String, Schema.Json) })),
);

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.build) await run("bun", ["run", "build"]);
  if (!existsSync(BUILT_CONFIG))
    throw new Error("Build the Worker first: bun run --cwd apps/auth-api build, or pass --build.");
  await rm(STATE, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const envFile = join(OUT, "worker.env");
  const webhooks = options.webhooks || options.productionSettings ? startWebhookReceiver() : null;
  await writeEnvFile(
    envFile,
    options,
    options.webhooks ? (webhooks?.urls ?? []) : [],
    webhooks?.origin ?? "http://127.0.0.1:9",
  );
  await run(
    "bunx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "openbot-auth",
      "--local",
      "--persist-to",
      STATE,
      "--config",
      BUILT_CONFIG,
    ],
    {
      ...process.env,
      CI: "1",
    },
  );
  const warm = await measureWarm(envFile, options);
  const cold = [];
  if (options.cold) {
    for (const route of routes(warm.session).filter(
      (entry) => !options.coldRoute || entry.name === options.coldRoute,
    )) {
      const result = await measureColdRoute(envFile, warm.session, route);
      console.log(
        `first ${result.route.padEnd(46)} cold isolate ${result.coldIsolateCpuMs} ms  first call ${result.firstCallCpuMs} ms (module init ${result.moduleInitMs} ms)  second ${result.secondCallCpuMs} ms`,
      );
      cold.push(result);
    }
  }
  const startup = options.cold ? await measureStartup(envFile) : null;
  if (startup) console.log(`isolate startup (module evaluation)                  cpu ${startup.startupCpuMs} ms`);
  webhooks?.stop();
  const reportPath = join(OUT, "report.json");
  const runs = existsSync(reportPath) ? decodePreviousReport(await readFile(reportPath, "utf8")).runs : {};
  const report = {
    generatedAt: new Date().toISOString(),
    sampleIntervalUs: SAMPLE_INTERVAL_US,
    runs: {
      ...runs,
      [options.label]: {
        requestsPerRoute: options.requests,
        productionSettings: options.productionSettings,
        webhookDeliveries: webhooks?.received() ?? 0,
        warm: warm.results,
        ...(startup ? { startup } : {}),
        ...(options.cold ? { cold } : {}),
      },
    },
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
}

await main();
