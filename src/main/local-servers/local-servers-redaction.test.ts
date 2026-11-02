import { ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ServerSummary } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatLocalServerReady, LOCAL_SERVER_ENVIRONMENT } from "../local-server-child";
import type { LocalServerAttachInput } from "../remote-server-manager";
import { RemoteWorkflowError } from "../remote-service-effects";
import { LOCAL_SERVERS_FILE } from "./local-server-registry";
import { LocalServers, type LocalServersOptions } from "./local-servers";

const READY = {
  serverId: "server-on-this-computer",
  serverName: "Design studio",
  apiUrl: "http://127.0.0.1:45123",
  fingerprint: "fingerprint-1",
  publicKey: "public-key-1",
};

/** A child that reports ready at once and exits when it is asked to stop. */
class ReadyChild extends ChildProcess {
  constructor() {
    super();
    this.stdin = new PassThrough();
    const stdout = new PassThrough();
    this.stdout = stdout;
    this.stderr = new PassThrough();
    setImmediate(() => stdout.write(`${formatLocalServerReady(READY)}\n`));
  }

  override kill(signal?: NodeJS.Signals | number): boolean {
    setImmediate(() => this.emit("exit", null, typeof signal === "string" ? signal : null));
    return true;
  }
}

interface Spawned {
  args: readonly string[];
  secret: string | undefined;
}

function summary(input: LocalServerAttachInput): ServerSummary {
  return {
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    id: input.serverId,
    kind: "remote",
    apiUrl: READY.apiUrl,
    remoteDesktopAvailable: false,
    logoUrl: null,
    name: READY.serverName,
    role: "owner",
    state: "online",
    active: input.select,
    thisComputer: true,
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-local-servers-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function servers(
  attach: (input: LocalServerAttachInput) => Effect.Effect<ServerSummary, RemoteWorkflowError>,
  onLine: (line: string) => void,
  spawned: Spawned[],
): LocalServers {
  const logger = createOpenBotLogger("local-servers", onLine);
  const options: LocalServersOptions = {
    registryPath: join(root, LOCAL_SERVERS_FILE),
    userDataRoot: join(root, "local-servers"),
    agentRoot: join(root, "OpenBot", "Servers"),
    runtimeRoot: join(root, "provider-runtimes"),
    cipher: {
      encrypt: (value) => Buffer.from(`sealed:${value}`).reverse(),
      decrypt: (value) => Buffer.from(value).reverse().toString().slice("sealed:".length),
    },
    remoteServers: {
      setThisComputerServers: () => undefined,
      attachLocalServer: attach,
      detachLocalServer: () => Effect.void,
    },
    command: { executable: "/Applications/OpenBot.app/Contents/MacOS/OpenBot", args: [] },
    trash: () => Promise.resolve(),
    log: {
      info: (message) => logger.info(message),
      warn: (message, detail) => logger.warn(message, detail === undefined ? "" : toLogValue(detail)),
    },
    platform: "darwin",
    spawn: (_command: string, args: readonly string[], options: SpawnOptions) => {
      spawned.push({ args, secret: options.env?.[LOCAL_SERVER_ENVIRONMENT.secret] });
      return new ReadyChild();
    },
  };
  return new LocalServers(options);
}

describe("servers on this computer", () => {
  it("keeps the owner password out of the logs, the arguments and the registry file", async () => {
    const lines: string[] = [];
    const spawned: Spawned[] = [];
    const first = servers(
      (input) => Effect.succeed(summary(input)),
      (line) => lines.push(line),
      spawned,
    );
    await Effect.runPromise(first.load());
    await Effect.runPromise(first.initialize());
    await Effect.runPromise(first.create(READY.serverName));
    await Effect.runPromise(first.stop());

    const secret = spawned[0]?.secret ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(spawned[0]?.args.join(" ")).not.toContain(secret);
    expect(await readFile(join(root, LOCAL_SERVERS_FILE), "utf8")).not.toContain(secret);

    // A login failure that repeats the password reaches the log as the cause of a failed start.
    const { promise: failed, resolve } = Promise.withResolvers<void>();
    const second = servers(
      (input) => Effect.fail(new RemoteWorkflowError({ cause: new Error(`Login refused for ${input.password}`) })),
      (line) => {
        lines.push(line);
        if (line.includes("did not start")) resolve();
      },
      spawned,
    );
    await Effect.runPromise(second.load());
    await Effect.runPromise(second.initialize());
    await failed;
    await Effect.runPromise(second.stop());

    expect(spawned[1]?.secret).toBe(secret);
    const log = lines.join("\n");
    expect(log).toContain("Login refused for [redacted]");
    expect(log).not.toContain(secret);
  });
});
