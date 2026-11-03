import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { registerSecretValue } from "@openbot/logging";
import { Deferred, Effect, Result, Schema } from "effect";
import { writeFileAtomically } from "../atomic-json-file";
import type { GrokBotGatewaySession } from "./grok-bot-account";
import { buildGrokBotVncProxy } from "./grok-bot-computer";

/**
 * Private local-docker host for an OpenBot Grok turn.
 *
 * Owns `openbot-local-vm`, the owner label, the gateway token file, and
 * `http://127.0.0.1:1340`. The renderer does not call Docker. A start failure
 * stays in OpenBot. This module does not call the shared box service.
 */

export const OPENBOT_LOCAL_GATEWAY_URL = "http://127.0.0.1:1340";
export const OPENBOT_LOCAL_VM_CONTAINER = "openbot-local-vm";
const OPENBOT_LOCAL_VM_OWNER_LABEL = "app.openbot.desktop.local-vm=1";
export const OPENBOT_LOCAL_VM_IMAGE = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest";
const OPENBOT_LOCAL_VM_WORKSPACE_VOLUME = "openbot-local-vm-workspace";
const OPENBOT_LOCAL_VM_DATA_VOLUME = "openbot-local-vm-data";

const TOKEN_FILE = "openbot-local-vm.json";
const ENV_FILE = "openbot-local-vm.env";
const RUNTIME_DIR = "openbot-local-vm-runtime";
const HOST_ENTRY = "host-main.cjs";
const READY_TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 2_000;
const POLL_MS = 1_000;
const PUBLISH_PORTS = [1337, 1339, 1340, 6080, 6081, 8790] as const;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export class GrokBotLocalHostFailed extends Schema.TaggedError<GrokBotLocalHostFailed>()("GrokBotLocalHostFailed", {
  reason: Schema.Literals(["failed", "stopped"]),
}) {}

export interface DockerCommandResult {
  readonly ok: boolean;
  readonly output: string;
}

export interface GrokBotLocalGateway {
  readonly url: typeof OPENBOT_LOCAL_GATEWAY_URL;
  readonly token: string;
}

export interface GrokBotLocalHostOptions {
  readonly directory: string;
  /** A test double. The product path spawns the `docker` executable. */
  readonly runDocker?: (args: readonly string[]) => Promise<DockerCommandResult>;
  readonly fetchImpl?: typeof fetch;
  /** Directory that contains `host-main.cjs`. Absent, the host looks beside the account file. */
  readonly bundleDirectory?: string;
  readonly readyTimeoutMs?: number;
  readonly pollMs?: number;
}

interface ContainerInspect {
  readonly exists: boolean;
  readonly running: boolean;
  readonly owned: boolean;
  readonly image: string;
}

const hosts = new Map<string, GrokBotLocalHost>();

/** The host for one user-data directory. One directory has one private host. */
export function grokBotLocalHost(directory: string): GrokBotLocalHost {
  const existing = hosts.get(directory);
  if (existing) return existing;
  const host = new GrokBotLocalHost({ directory });
  hosts.set(directory, host);
  return host;
}

/** Tests install a double before a product call. The app binds the host it stops. */
export function bindGrokBotLocalHost(directory: string, host: GrokBotLocalHost): void {
  hosts.set(directory, host);
}

/** The gateway session stored after the private host is healthy. */
export function openBotLocalGatewaySession(token: string): GrokBotGatewaySession {
  registerSecretValue(token);
  const vnc = buildGrokBotVncProxy("http://127.0.0.1:6080/vnc.html", "http://127.0.0.1:6081", "local");
  return {
    url: OPENBOT_LOCAL_GATEWAY_URL,
    token,
    headers: {},
    ...(vnc ? { vnc } : {}),
  };
}

function hostFailure(reason: "failed" | "stopped"): GrokBotLocalHostFailed {
  return new GrokBotLocalHostFailed({ reason });
}

/**
 * One private sand gateway on this computer.
 * `ensure` and `stop` each return one Effect. There is no Promise twin.
 */
export class GrokBotLocalHost {
  readonly #directory: string;
  readonly #runDocker: (args: readonly string[]) => Promise<DockerCommandResult>;
  readonly #fetchImpl: typeof fetch;
  readonly #bundleDirectory: string | undefined;
  readonly #readyTimeoutMs: number;
  readonly #pollMs: number;
  readonly #tokenPath: string;
  readonly #envPath: string;
  readonly #runtimePath: string;
  #abort = new AbortController();
  #flight: Deferred.Deferred<GrokBotLocalGateway, GrokBotLocalHostFailed> | null = null;

  constructor(options: GrokBotLocalHostOptions) {
    this.#directory = options.directory;
    this.#runDocker = options.runDocker ?? runDockerExecutable;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#bundleDirectory = options.bundleDirectory;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.#pollMs = options.pollMs ?? POLL_MS;
    this.#tokenPath = join(options.directory, TOKEN_FILE);
    this.#envPath = join(options.directory, ENV_FILE);
    this.#runtimePath = join(options.directory, RUNTIME_DIR);
  }

  /** Ends a start that is still waiting. The next `stop` stops an owned container. */
  abort(): void {
    this.#abort.abort();
  }

  readonly ensure = Effect.fn("GrokBotLocalHost.ensure")(function* (this: GrokBotLocalHost) {
    const existing = this.#flight;
    if (existing) return yield* Deferred.await(existing);
    const flight = Deferred.makeUnsafe<GrokBotLocalGateway, GrokBotLocalHostFailed>();
    this.#flight = flight;
    const started = yield* Effect.result(this.#start());
    if (this.#flight === flight) this.#flight = null;
    if (Result.isFailure(started)) {
      yield* Deferred.fail(flight, started.failure).pipe(Effect.ignore);
      return yield* Effect.fail(started.failure);
    }
    yield* Deferred.succeed(flight, started.success);
    return started.success;
  });

  readonly stop = Effect.fn("GrokBotLocalHost.stop")(function* (this: GrokBotLocalHost) {
    const inspected = yield* this.#inspect();
    if (!inspected.exists || !inspected.running || !inspected.owned) return;
    const stopped = yield* this.#docker(["stop", OPENBOT_LOCAL_VM_CONTAINER]);
    if (!stopped.ok) return yield* Effect.fail(hostFailure("failed"));
  });

  /** Reads the token file. It does not create a token and it does not start Docker. */
  readonly readToken = Effect.fn("GrokBotLocalHost.readToken")(function* (this: GrokBotLocalHost) {
    const read = yield* Effect.result(
      Effect.tryPromise({
        try: () => readFile(this.#tokenPath, "utf8"),
        catch: (cause) => cause,
      }),
    );
    if (Result.isFailure(read)) return null;
    const token = tokenFromText(read.success);
    if (!token) return null;
    registerSecretValue(token);
    return token;
  });

  readonly #start = Effect.fn("GrokBotLocalHost.start")(function* (this: GrokBotLocalHost) {
    if (this.#abort.signal.aborted) return yield* Effect.fail(hostFailure("failed"));
    const bundle = yield* this.#resolveBundle();
    const daemon = yield* this.#docker(["info", "--format", "{{.ServerVersion}}"]);
    if (!daemon.ok) return yield* Effect.fail(hostFailure("failed"));
    const inspected = yield* this.#inspect();
    if (inspected.exists && !inspected.owned) return yield* Effect.fail(hostFailure("failed"));
    if (inspected.exists && inspected.image !== OPENBOT_LOCAL_VM_IMAGE) {
      return yield* Effect.fail(hostFailure("failed"));
    }
    const listed = yield* this.#docker(["ps", "--all", "--format", "{{.Names}}|{{.Ports}}"]);
    if (!listed.ok) return yield* Effect.fail(hostFailure("failed"));
    if (gatewayHeldByOther(listed.output)) return yield* Effect.fail(hostFailure("failed"));
    const token = yield* this.#readOrCreateToken();
    yield* this.#stageBundle(bundle);
    yield* this.#writeEnvFile(token);
    if (!inspected.exists) {
      const created = yield* this.#docker(containerRunArgs(this.#envPath, this.#runtimePath));
      if (!created.ok) return yield* Effect.fail(hostFailure("failed"));
    } else if (!inspected.running) {
      const started = yield* this.#docker(["start", OPENBOT_LOCAL_VM_CONTAINER]);
      if (!started.ok) return yield* Effect.fail(hostFailure("stopped"));
    }
    return yield* this.#waitUntilReady(token);
  });

  readonly #waitUntilReady = Effect.fn("GrokBotLocalHost.wait")(function* (this: GrokBotLocalHost, token: string) {
    const deadline = Date.now() + this.#readyTimeoutMs;
    while (Date.now() < deadline) {
      if (this.#abort.signal.aborted) {
        yield* this.stop().pipe(Effect.ignore);
        return yield* Effect.fail(hostFailure("failed"));
      }
      if (yield* this.#healthy(token)) return { url: OPENBOT_LOCAL_GATEWAY_URL, token } as const;
      const state = yield* this.#inspect();
      if (state.exists && state.owned && !state.running) return yield* Effect.fail(hostFailure("failed"));
      yield* Effect.sleep(this.#pollMs);
    }
    yield* this.stop().pipe(Effect.ignore);
    return yield* Effect.fail(hostFailure("failed"));
  });

  readonly #healthy = Effect.fn("GrokBotLocalHost.health")(function* (this: GrokBotLocalHost, token: string) {
    const call = this.#fetchImpl;
    const checked = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          call(`${OPENBOT_LOCAL_GATEWAY_URL}/health`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]),
          }),
        catch: () => hostFailure("failed"),
      }),
    );
    if (Result.isFailure(checked)) return false;
    return checked.success.ok;
  });

  /**
   * `host-main.cjs` is the pinned BotAI host at `63cc1e03586b07f5216b900f9e9f296ba0fddea7`.
   * Place that bundle in `<userData>/sand-host`, or pass `bundleDirectory`. A missing file fails the start.
   */
  readonly #resolveBundle = Effect.fn("GrokBotLocalHost.bundle")(function* (this: GrokBotLocalHost) {
    const candidates = [this.#bundleDirectory, join(this.#directory, "sand-host")].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    for (const candidate of candidates) {
      if (candidate.includes(",") || candidate.includes("\n")) continue;
      const present = yield* Effect.result(
        Effect.tryPromise({
          try: () => readFile(join(candidate, HOST_ENTRY)),
          catch: (cause) => cause,
        }),
      );
      if (Result.isSuccess(present)) return candidate;
    }
    return yield* Effect.fail(hostFailure("failed"));
  });

  readonly #stageBundle = Effect.fn("GrokBotLocalHost.stage")(function* (this: GrokBotLocalHost, source: string) {
    const destination = this.#runtimePath;
    const staged = yield* Effect.result(
      Effect.tryPromise({
        try: async () => {
          await rm(destination, { recursive: true, force: true });
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await cp(source, destination, { recursive: true });
          await patchIsolationTree(destination);
        },
        catch: () => hostFailure("failed"),
      }),
    );
    if (Result.isFailure(staged)) return yield* Effect.fail(hostFailure("failed"));
  });

  readonly #readOrCreateToken = Effect.fn("GrokBotLocalHost.token")(function* (this: GrokBotLocalHost) {
    const existing = yield* this.readToken();
    if (existing) return existing;
    const token = randomBytes(32).toString("hex");
    registerSecretValue(token);
    yield* writeFileAtomically(this.#tokenPath, `${JSON.stringify({ schemaVersion: 1, token })}\n`, {
      createDirectory: true,
    }).pipe(Effect.mapError(() => hostFailure("failed")));
    return token;
  });

  readonly #writeEnvFile = Effect.fn("GrokBotLocalHost.env")(function* (this: GrokBotLocalHost, token: string) {
    if (!TOKEN_PATTERN.test(token)) return yield* Effect.fail(hostFailure("failed"));
    yield* writeFileAtomically(this.#envPath, `SAND_GATEWAY_TOKEN=${token}\nSAND_EGRESS_TUNNEL_BEARER=${token}\n`, {
      createDirectory: true,
    }).pipe(Effect.mapError(() => hostFailure("failed")));
  });

  readonly #inspect = Effect.fn("GrokBotLocalHost.inspect")(function* (this: GrokBotLocalHost) {
    const result = yield* this.#docker([
      "inspect",
      "--format",
      '{{.State.Running}}|{{index .Config.Labels "app.openbot.desktop.local-vm"}}|{{.Config.Image}}',
      OPENBOT_LOCAL_VM_CONTAINER,
    ]);
    return parseInspect(result);
  });

  #docker(args: readonly string[]) {
    const run = this.#runDocker;
    return Effect.tryPromise({
      try: () => run(args),
      catch: () => hostFailure("failed"),
    });
  }
}

function containerRunArgs(envFile: string, runtimePath: string): string[] {
  return [
    "run",
    "--detach",
    "--name",
    OPENBOT_LOCAL_VM_CONTAINER,
    "--env-file",
    envFile,
    "--label",
    OPENBOT_LOCAL_VM_OWNER_LABEL,
    "--platform",
    "linux/amd64",
    "--restart",
    "unless-stopped",
    "--env",
    "BOTAI_ISOLATED_RUNTIME=1",
    "--env",
    "SAND_GATEWAY_BIND_HOST=0.0.0.0",
    "--env",
    "SAND_HOST_PORT=1340",
    "--env",
    `BOTAI_GATEWAY_PUBLIC_URL=${OPENBOT_LOCAL_GATEWAY_URL}`,
    "--env",
    "SAND_SUPERVISOR_ENABLED=1",
    "--env",
    "SAND_BOX_AUTO_UPDATE=0",
    ...PUBLISH_PORTS.flatMap((port) => ["--publish", `127.0.0.1:${port}:${port}`]),
    "--volume",
    `${OPENBOT_LOCAL_VM_WORKSPACE_VOLUME}:/workspace`,
    "--volume",
    `${OPENBOT_LOCAL_VM_DATA_VOLUME}:/home/box/sand-data`,
    "--mount",
    `type=bind,src=${runtimePath},dst=/home/box/sand-host,readonly`,
    OPENBOT_LOCAL_VM_IMAGE,
  ];
}

function parseInspect(result: DockerCommandResult): ContainerInspect {
  if (!result.ok) return { exists: false, running: false, owned: false, image: "" };
  const [running, label, image] = result.output.trim().split("|");
  return {
    exists: true,
    running: running === "true",
    owned: label === "1",
    image: image ?? "",
  };
}

function gatewayHeldByOther(output: string): boolean {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const bar = trimmed.indexOf("|");
    if (bar < 0) continue;
    const name = trimmed.slice(0, bar).trim();
    const ports = trimmed.slice(bar + 1);
    if (name === OPENBOT_LOCAL_VM_CONTAINER) continue;
    if (ports.includes(":1340->") || ports.includes("127.0.0.1:1340") || ports.includes("0.0.0.0:1340")) {
      return true;
    }
  }
  return false;
}

function tokenFromText(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    if (!isDynamicRecord(parsed) || typeof parsed.token !== "string" || !TOKEN_PATTERN.test(parsed.token)) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

function isolateSandHostSource(text: string): string {
  return text
    .replaceAll("DEFAULT_NOTIFY_ON_AGENT_UPDATES = true", "DEFAULT_NOTIFY_ON_AGENT_UPDATES = false")
    .replaceAll("notifyOnAgentUpdates: true", "notifyOnAgentUpdates: false")
    .replaceAll("notifyOnAgentUpdates:true", "notifyOnAgentUpdates:false")
    .replaceAll("notifyOnAgentUpdates:!0", "notifyOnAgentUpdates:!1");
}

async function patchIsolationTree(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchIsolationTree(path);
      continue;
    }
    if (!entry.isFile() || !/\.(?:cjs|mjs|js|ts)$/.test(entry.name)) continue;
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    const next = isolateSandHostSource(text);
    if (next !== text) await writeFile(path, next);
  }
}

function resolveDockerExecutable(): string {
  const candidates = [
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => join(directory, "docker")),
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // The next candidate is the docker executable.
    }
  }
  return "docker";
}

function runDockerExecutable(args: readonly string[]): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(resolveDockerExecutable(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 16_000) output = output.slice(-16_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", () => resolve({ ok: false, output: "" }));
    child.once("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
  });
}
