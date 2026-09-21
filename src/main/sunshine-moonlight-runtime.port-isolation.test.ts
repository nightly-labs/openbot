import { ChildProcess, execFileSync, type SpawnOptions } from "node:child_process";
import * as dgram from "node:dgram";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { RemoteDesktopDisplay, RemoteDesktopIceServer } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import {
  allocateSunshineBasePort,
  allocateWebRtcPortRange,
  type MoonlightWebRtcPortRange,
  type RemoteRuntimeSpawn,
  releaseSunshineBasePort,
  releaseWebRtcPortRange,
  SUNSHINE_DEFAULT_BASE_PORT,
  SunshineMoonlightRuntime,
  sunshineHttpPortForBase,
  sunshineHttpsPortForBase,
  sunshinePasswordHash,
  sunshinePortFamiliesOverlap,
} from "./sunshine-moonlight-runtime";

// Two OpenBot instances on one Mac share the host network namespace, so per-instance Sunshine
// ports are the only thing keeping a second Remote Desktop from failing to bind. These tests
// stand up two real runtimes against fake Sunshine/Moonlight loopback servers (only the process
// spawn boundary is stubbed) and prove the ports stay apart end to end.

const TEST_PATHS: RemoteDesktopRuntimePaths = {
  sunshine: join("fake", "sunshine"),
  moonlightWebServer: join("fake", "web-server"),
  moonlightStreamer: join("fake", "streamer"),
};

const TEST_DISPLAYS: RemoteDesktopDisplay[] = [
  { id: "test-display", label: "Test Display", width: 1920, height: 1080, primary: true },
];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(request: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

class FakeChild extends ChildProcess {
  exitCode: number | null = null;
  killed = false;
  stdout = new PassThrough();
  stderr = new PassThrough();
  readonly #onKill: () => void;

  constructor(onKill: () => void = () => undefined) {
    super();
    this.#onKill = onKill;
  }

  kill(): boolean {
    if (this.exitCode !== null) return false;
    this.killed = true;
    this.exitCode = 0;
    this.#onKill();
    queueMicrotask(() => this.emit("exit", 0));
    return true;
  }

  complete(code: number): void {
    this.exitCode = code;
    queueMicrotask(() => this.emit("exit", code));
  }
}

interface Harness {
  stateDirectory: string;
  hosts: Array<{ host_id: number; paired: "Paired" | "NotPaired" }>;
  nextHostId: number;
  authHeader: string;
  iceUrl: string;
  iceToken: string;
  observedSunshineHttpPorts: number[];
  sunshineHits: Array<{ path: string; localPort: number }>;
  pinBodies: string[];
  pairingName: string;
  duplicatePairing: boolean;
  pendingPairings: Array<{ id: string; name: string; address: string }>;
  pinSubmitted: Deferred<void>;
  servers: Array<HttpServer | HttpsServer>;
  serverErrors: unknown[];
  spawn: RemoteRuntimeSpawn;
  closeAll(): Promise<void>;
}

function generateSunshineCert(certPath: string, keyPath: string): void {
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "2",
        "-nodes",
        "-subj",
        "/CN=127.0.0.1",
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    throw new Error(
      `Fake Sunshine needs openssl to mint a test certificate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function listenOn(server: TcpServer | HttpServer | HttpsServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function closeServer(
  server: { close: (callback: () => void) => unknown; listening: boolean } | null,
): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function sunshineHandler(harness: Harness): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "https://127.0.0.1");
    harness.sunshineHits.push({ path: url.pathname, localPort: request.socket.localPort ?? -1 });
    const json = (value: unknown): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/openbot/displays") {
      json({ displays: [] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pin") {
      json({ pairings: harness.pendingPairings });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/pin") {
      void readBody(request).then((body) => {
        const approval = z.object({ pairing_id: z.string(), pin: z.literal("4242") }).parse(JSON.parse(body));
        if (approval.pairing_id !== "1".repeat(32)) {
          response.writeHead(400).end();
          return;
        }
        harness.pinBodies.push(body);
        harness.pendingPairings = [];
        for (const host of harness.hosts) host.paired = "Paired";
        harness.pinSubmitted.resolve();
        response.writeHead(200);
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  };
}

const moonlightHostCreateSchema = z.object({ address: z.string(), http_port: z.number().int() });
const moonlightPairRequestSchema = z.object({ host_id: z.number().int() });
const moonlightConfigFileSchema = z.object({
  moonlight: z.object({ default_http_port: z.number().int(), pair_device_name: z.string() }),
  webrtc: z.object({ port_range: z.object({ min: z.number().int(), max: z.number().int() }) }),
  web_server: z.object({
    bind_address: z.string(),
    forwarded_header: z.object({ username_header: z.string() }),
    first_login_create_admin: z.boolean(),
  }),
});

function moonlightHandler(harness: Harness): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!request.headers[harness.authHeader.toLowerCase()]) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/host") {
      harness.hosts = harness.hosts.filter((host) => String(host.host_id) !== url.searchParams.get("host_id"));
      response.writeHead(200);
      response.end();
      return;
    }
    const jsonLine = (value: unknown): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(`${JSON.stringify(value)}\n`);
    };
    if (request.method === "GET" && url.pathname === "/api/authenticate") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/hosts") {
      jsonLine({ hosts: harness.hosts });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/host") {
      void readBody(request).then((body) => {
        const parsed = moonlightHostCreateSchema.parse(JSON.parse(body));
        harness.observedSunshineHttpPorts.push(parsed.http_port);
        const host = { host_id: harness.nextHostId, paired: "NotPaired" as const };
        harness.nextHostId += 1;
        harness.hosts.push(host);
        jsonLine({ host });
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/pair") {
      void readBody(request).then(async (body) => {
        const parsed = moonlightPairRequestSchema.parse(JSON.parse(body));
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        harness.pendingPairings = [
          { id: "2".repeat(32), name: "Competing client", address: "127.0.0.1" },
          { id: "3".repeat(32), name: harness.pairingName, address: "192.0.2.1" },
          { id: "1".repeat(32), name: harness.pairingName, address: "127.0.0.1" },
        ];
        if (harness.duplicatePairing)
          harness.pendingPairings.push({ id: "4".repeat(32), name: harness.pairingName, address: "127.0.0.1" });
        response.write(`${JSON.stringify({ Pin: "4242" })}\n`);
        const submitted = await Promise.race([
          harness.pinSubmitted.promise.then(() => true),
          delay(15_000).then(() => false),
        ]);
        if (!submitted) {
          response.write(`${JSON.stringify("PairError")}\n`);
          response.end();
          return;
        }
        response.write(`${JSON.stringify({ Paired: { host_id: parsed.host_id } })}\n`);
        response.end();
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/apps") {
      jsonLine({ apps: [{ app_id: 11, title: "Desktop" }] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/role") {
      jsonLine({ role: { permissions: { allow_transport_webrtc: true, allow_transport_websockets: false } } });
      return;
    }
    response.writeHead(404);
    response.end();
  };
}

function createHarness(stateDirectory: string): Harness {
  const harness: Harness = {
    stateDirectory,
    hosts: [],
    nextHostId: 1,
    authHeader: "",
    iceUrl: "",
    iceToken: "",
    observedSunshineHttpPorts: [],
    sunshineHits: [],
    pinBodies: [],
    pairingName: "",
    duplicatePairing: false,
    pendingPairings: [],
    pinSubmitted: createDeferred<void>(),
    servers: [],
    serverErrors: [],
    spawn: createHarnessSpawn(),
    closeAll: async () => {
      await Promise.all(harness.servers.map((server) => closeServer(server)));
    },
  };
  function createHarnessSpawn(): RemoteRuntimeSpawn {
    const spawn = (executable: string, args: string[], options: SpawnOptions): FakeChild => {
      if (args.some((arg) => arg.includes("test-password"))) throw new Error("Password exposed in child arguments.");
      if (executable === TEST_PATHS.sunshine) {
        const config = readFileSync(args[0] ?? "", "utf8");
        const base = Number(/^\s*port\s*=\s*(\d+)\s*$/m.exec(config)?.[1]);
        if (!Number.isInteger(base)) throw new Error("Fake Sunshine did not receive a base port in sunshine.conf.");
        generateSunshineCert(join(stateDirectory, "sunshine-cert.pem"), join(stateDirectory, "sunshine-key.pem"));
        let server: HttpsServer | null = null;
        const child = new FakeChild(() => {
          void closeServer(server);
        });
        void (async () => {
          try {
            server = createHttpsServer(
              {
                key: readFileSync(join(stateDirectory, "sunshine-key.pem")),
                cert: readFileSync(join(stateDirectory, "sunshine-cert.pem")),
              },
              sunshineHandler(harness),
            );
            harness.servers.push(server);
            await listenOn(server, base + 1);
          } catch (error) {
            harness.serverErrors.push(error);
          }
        })();
        return child;
      }
      if (executable === TEST_PATHS.moonlightWebServer) {
        harness.iceUrl = options.env?.OPENBOT_ICE_HELPER_URL ?? "";
        harness.iceToken = options.env?.OPENBOT_ICE_HELPER_TOKEN ?? "";
        const configPath = args[args.indexOf("--config-path") + 1];
        harness.pairingName = moonlightConfigFileSchema.parse(
          JSON.parse(readFileSync(configPath, "utf8")),
        ).moonlight.pair_device_name;
        harness.authHeader = moonlightConfigFileSchema.parse(
          JSON.parse(readFileSync(configPath, "utf8")),
        ).web_server.forwarded_header.username_header;
        const address = args[args.indexOf("--bind-address") + 1] ?? "";
        const port = Number(address.split(":").pop());
        if (!Number.isInteger(port)) throw new Error("Fake Moonlight did not receive a bind address.");
        let server: HttpServer | null = null;
        const child = new FakeChild(() => {
          void closeServer(server);
        });
        void (async () => {
          try {
            server = createHttpServer(moonlightHandler(harness));
            harness.servers.push(server);
            await listenOn(server, port);
          } catch (error) {
            harness.serverErrors.push(error);
          }
        })();
        return child;
      }
      throw new Error(`Unexpected spawn in test: ${executable} ${(args ?? []).join(" ")}`);
    };
    return spawn;
  }
  return harness;
}

async function createStartedRuntime(
  getIceServers: () => Promise<RemoteDesktopIceServer[]> = async () => [{ urls: "stun:127.0.0.1:3478" }],
  configureHarness?: (harness: Harness) => void,
): Promise<{
  runtime: SunshineMoonlightRuntime;
  harness: Harness;
}> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "openbot-sunshine-port-test-"));
  const harness = createHarness(stateDirectory);
  configureHarness?.(harness);
  const runtime = new SunshineMoonlightRuntime({
    paths: TEST_PATHS,
    stateDirectory,
    platform: "darwin",
    credentials: { username: "openbot-test", password: "test-password" },
    getDisplays: () => structuredClone(TEST_DISPLAYS),
    getIceServers,
    spawnProcess: harness.spawn,
  });
  try {
    await runtime.start();
    if (harness.serverErrors.length > 0) throw harness.serverErrors[0];
    return { runtime, harness };
  } catch (error) {
    harness.pinSubmitted.resolve();
    await disposeRuntime(runtime, harness);
    throw error;
  }
}

async function disposeRuntime(runtime: SunshineMoonlightRuntime, harness: Harness): Promise<void> {
  await runtime.stop().catch(() => undefined);
  await harness.closeAll();
  await rm(harness.stateDirectory, { recursive: true, force: true });
}

async function blockTcp(port: number): Promise<TcpServer> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

describe("sunshine port family helpers", () => {
  it("refuses ambiguous local pairing requests without submitting the PIN", async () => {
    let pinBodies: string[] = [];
    await expect(
      createStartedRuntime(undefined, (harness) => {
        harness.duplicatePairing = true;
        pinBodies = harness.pinBodies;
      }),
    ).rejects.toThrow("ambiguous local pairing requests");
    expect(pinBodies).toEqual([]);
  });

  it.each(["throw", "reject"])("returns 503 for an ICE callback that can %s and recovers", async (failure) => {
    let fail = true;
    const { runtime, harness } = await createStartedRuntime(() => {
      if (!fail) return Promise.resolve([]);
      const error = new Error("Remote Signal has not supplied ICE servers yet.");
      if (failure === "throw") throw error;
      return Promise.reject(error);
    });
    try {
      const headers = { Authorization: `Bearer ${harness.iceToken}` };
      expect((await fetch(harness.iceUrl)).status).toBe(401);
      expect((await fetch(harness.iceUrl, { headers })).status).toBe(503);
      fail = false;
      const response = await fetch(harness.iceUrl, { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    } finally {
      await disposeRuntime(runtime, harness);
    }
  });

  it("writes the credential digest required by the pinned Sunshine build", () => {
    expect(sunshinePasswordHash("password", "salt")).toBe(
      "997B60F3DD238B10ECDEDC2805F9E3DCB42A5AFAC089909AC1EA18895CB8377A",
    );
  });

  it("derives the HTTP/HTTPS pair from one base port", () => {
    expect(sunshineHttpPortForBase(SUNSHINE_DEFAULT_BASE_PORT)).toBe(47_989);
    expect(sunshineHttpsPortForBase(SUNSHINE_DEFAULT_BASE_PORT)).toBe(47_990);
  });

  it("treats adjacent base ports as overlapping families", () => {
    expect(sunshinePortFamiliesOverlap(47_989, 47_989)).toBe(true);
    expect(sunshinePortFamiliesOverlap(47_989, 47_990)).toBe(true);
    expect(sunshinePortFamiliesOverlap(47_989, 48_021)).toBe(false);
  });

  it("hands out disjoint families from the allocator and releases them", async () => {
    const first = await allocateSunshineBasePort();
    try {
      const second = await allocateSunshineBasePort();
      try {
        expect(sunshinePortFamiliesOverlap(first, second)).toBe(false);
      } finally {
        releaseSunshineBasePort(second);
      }
    } finally {
      releaseSunshineBasePort(first);
    }
  });

  it("hands out disjoint Moonlight WebRTC ranges", async () => {
    const first: MoonlightWebRtcPortRange = await allocateWebRtcPortRange();
    try {
      const second: MoonlightWebRtcPortRange = await allocateWebRtcPortRange();
      try {
        expect(first.min).not.toBe(second.min);
        expect(first.max - first.min).toBe(31);
      } finally {
        releaseWebRtcPortRange(second);
      }
    } finally {
      releaseWebRtcPortRange(first);
    }
  });

  it("closes failed UDP probes before trying another WebRTC range", async () => {
    const first = await allocateWebRtcPortRange();
    releaseWebRtcPortRange(first);
    const occupied = dgram.createSocket("udp4");
    const sockets: dgram.Socket[] = [];
    const failed = new Set<dgram.Socket>();
    const closed = new Set<dgram.Socket>();
    vi.resetModules();
    vi.doMock("node:dgram", () => ({
      createSocket: (type: dgram.SocketType) => {
        const socket = dgram.createSocket(type);
        sockets.push(socket);
        socket.once("error", () => failed.add(socket));
        socket.once("close", () => closed.add(socket));
        return socket;
      },
    }));
    try {
      await new Promise<void>((resolve, reject) => {
        occupied.once("error", reject);
        occupied.bind(first.min, "127.0.0.1", resolve);
      });
      const allocator = await import("./sunshine-moonlight-runtime");
      const next = await allocator.allocateWebRtcPortRange();
      try {
        expect(next.min).not.toBe(first.min);
        expect(failed.size).toBeGreaterThan(0);
        expect([...failed].every((socket) => closed.has(socket))).toBe(true);
      } finally {
        allocator.releaseWebRtcPortRange(next);
      }
    } finally {
      await Promise.all(
        [...sockets, occupied]
          .filter((socket) => !closed.has(socket))
          .map((socket) => new Promise<void>((resolve) => socket.close(() => resolve()))),
      );
      vi.doUnmock("node:dgram");
      vi.resetModules();
    }
  });

  it("reserves unused WebRTC ranges across independent processes", async () => {
    const first = await allocateWebRtcPortRange();
    try {
      const output = execFileSync(
        "bun",
        [
          "-e",
          `
        import { allocateWebRtcPortRange, releaseWebRtcPortRange } from "./src/main/sunshine-moonlight-runtime.ts";
        const range = await allocateWebRtcPortRange();
        console.log(JSON.stringify(range));
        releaseWebRtcPortRange(range);
      `,
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 },
      );
      const second = z.object({ min: z.number(), max: z.number() }).parse(JSON.parse(output));
      expect(second.min > first.max || second.max < first.min).toBe(true);
    } finally {
      releaseWebRtcPortRange(first);
    }
  });
});

describe("Sunshine port isolation", () => {
  it("Test A: two runtimes receive disjoint Sunshine families and WebRTC ranges", async () => {
    const first = await createStartedRuntime();
    try {
      const second = await createStartedRuntime();
      try {
        expect(first.runtime.sunshineBasePort).not.toBeNull();
        expect(second.runtime.sunshineBasePort).not.toBeNull();
        expect(first.runtime.sunshineBasePort).not.toBe(second.runtime.sunshineBasePort);
        expect(
          sunshinePortFamiliesOverlap(first.runtime.sunshineBasePort ?? 0, second.runtime.sunshineBasePort ?? 0),
        ).toBe(false);
        expect(first.runtime.webRtcPortRange).not.toEqual(second.runtime.webRtcPortRange);
        expect(first.runtime.state?.baseUrl).not.toBe(second.runtime.state?.baseUrl);
        expect(first.runtime.sunshineHttpPort).not.toBe(second.runtime.sunshineHttpPort);
        expect(first.runtime.sunshineHttpsPort).not.toBe(second.runtime.sunshineHttpsPort);
      } finally {
        await disposeRuntime(second.runtime, second.harness);
      }
    } finally {
      await disposeRuntime(first.runtime, first.harness);
    }
  });

  it("Test B: generated configs carry the runtime ports", async () => {
    const { runtime, harness } = await createStartedRuntime();
    try {
      const base = runtime.sunshineBasePort ?? 0;
      const sunshineConf = await readFile(join(harness.stateDirectory, "sunshine.conf"), "utf8");
      expect(sunshineConf).toContain(`port = ${base}`);
      expect(sunshineConf).toContain("bind_address = 127.0.0.1");
      const moonlightConfig = moonlightConfigFileSchema.parse(
        JSON.parse(await readFile(join(harness.stateDirectory, "moonlight-config.json"), "utf8")),
      );
      expect(moonlightConfig.moonlight.default_http_port).toBe(runtime.sunshineHttpPort);
      expect(moonlightConfig.webrtc.port_range).toEqual(runtime.webRtcPortRange);
      expect(moonlightConfig.web_server.bind_address).toBe(`127.0.0.1:${runtime.moonlightPort}`);
    } finally {
      await disposeRuntime(runtime, harness);
    }
  });

  it("Test C: Moonlight pairs against the runtime HTTP port, not the default", async () => {
    const blockers = await Promise.all([blockTcp(47_989), blockTcp(47_990)]);
    try {
      const { runtime, harness } = await createStartedRuntime();
      try {
        expect(runtime.sunshineHttpPort).not.toBeNull();
        expect(runtime.sunshineHttpPort).not.toBe(SUNSHINE_DEFAULT_BASE_PORT);
        expect(new Set(harness.observedSunshineHttpPorts)).toEqual(new Set([runtime.sunshineHttpPort]));
      } finally {
        await disposeRuntime(runtime, harness);
      }
    } finally {
      await Promise.all(blockers.map((server) => closeServer(server)));
    }
  });

  it("Test D: every Sunshine HTTPS request hits the runtime HTTPS port", async () => {
    const blockers = await Promise.all([blockTcp(47_989), blockTcp(47_990)]);
    try {
      const { runtime, harness } = await createStartedRuntime();
      try {
        const httpsPort = runtime.sunshineHttpsPort;
        expect(httpsPort).not.toBeNull();
        expect(httpsPort).not.toBe(47_990);
        expect(harness.pinBodies.length).toBeGreaterThan(0);
        const paths = harness.sunshineHits.map((hit) => hit.path);
        expect(paths).toContain("/api/openbot/displays");
        expect(paths).toContain("/api/pin");
        for (const hit of harness.sunshineHits) {
          expect(hit.localPort).toBe(httpsPort);
        }
      } finally {
        await disposeRuntime(runtime, harness);
      }
    } finally {
      await Promise.all(blockers.map((server) => closeServer(server)));
    }
  });

  it("Test E: stopping one runtime leaves the other working", async () => {
    const first = await createStartedRuntime();
    try {
      const second = await createStartedRuntime();
      try {
        const secondBaseUrl = second.runtime.state?.baseUrl ?? "";
        await first.runtime.stop();
        expect(first.runtime.state).toBeNull();
        expect(second.runtime.state).not.toBeNull();
        const authenticate = await fetch(`${secondBaseUrl}/api/authenticate`, {
          headers: { [second.harness.authHeader]: "openbot-remote-slot-1" },
        });
        expect(authenticate.ok).toBe(true);
        await expect(fetch(first.runtime.state?.baseUrl ?? "http://127.0.0.1:1/")).rejects.toThrow();
        // Restarting the stopped runtime must not disturb the survivor either.
        await first.runtime.start();
        expect(first.runtime.state).not.toBeNull();
        const stillThere = await fetch(`${secondBaseUrl}/api/authenticate`, {
          headers: { [second.harness.authHeader]: "openbot-remote-slot-1" },
        });
        expect(stillThere.ok).toBe(true);
      } finally {
        await disposeRuntime(second.runtime, second.harness);
      }
    } finally {
      await disposeRuntime(first.runtime, first.harness);
    }
  });

  it("recreates persisted hosts after another runtime claims the old port", async () => {
    const first = await createStartedRuntime();
    const oldPort = first.runtime.sunshineHttpPort;
    await first.runtime.stop();
    await first.harness.closeAll();
    const other = await createStartedRuntime();
    try {
      first.harness.observedSunshineHttpPorts = [];
      await first.runtime.start();
      expect(first.runtime.sunshineHttpPort).not.toBe(oldPort);
      expect(new Set(first.harness.observedSunshineHttpPorts)).toEqual(new Set([first.runtime.sunshineHttpPort]));
      const denied = await fetch(`${first.runtime.state?.baseUrl}/api/authenticate`, {
        headers: { "X-OpenBot-Remote-User": "openbot-remote-slot-1" },
      });
      expect(denied.status).toBe(401);
      expect(first.harness.authHeader).not.toBe(other.harness.authHeader);
      const config = moonlightConfigFileSchema.parse(
        JSON.parse(await readFile(join(first.harness.stateDirectory, "moonlight-config.json"), "utf8")),
      );
      expect(config.web_server.first_login_create_admin).toBe(false);
    } finally {
      await disposeRuntime(first.runtime, first.harness);
      await disposeRuntime(other.runtime, other.harness);
    }
  });
});
