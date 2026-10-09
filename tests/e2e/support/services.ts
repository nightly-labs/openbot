import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { expect } from "@playwright/test";
import { loadAgentRuntimeLock } from "../../../scripts/agent-runtime-lock";
import { withDevPortAllocation } from "../../../scripts/dev-automation/port-allocation";
import {
  readAllDevStackRecords,
  removeDevStackRecord,
  writeDevStackRecord,
} from "../../../scripts/dev-automation/stack-registry";
import { findAvailablePort } from "../../../scripts/dev-services";
import { developmentChildEnvironment, loadDevelopmentEnvironment } from "../../../scripts/development-environment";
import { createDevelopmentDefaults, ensureDevelopmentState } from "../../../scripts/development-secrets";
import { withoutElectronRuntimeFlags } from "../../../scripts/electron-spawn-env";
import { modelFor, output, providers, root } from "./settings";
import { startSite } from "./site";

const logger = createOpenBotLogger("e2e-services");

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const group = -child.pid;
  const alive = () => {
    try {
      process.kill(group, 0);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      throw error;
    }
  };
  if (!alive()) return;
  process.kill(group, "SIGTERM");
  try {
    await expect.poll(alive, { timeout: 10_000 }).toBe(false);
  } catch {
    if (alive()) process.kill(group, "SIGKILL");
    await expect.poll(alive, { timeout: 5_000 }).toBe(false);
  }
}

function start(args: string[], environment: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn("bun", args, {
    cwd: root,
    env: withoutElectronRuntimeFlags(environment),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) createInterface({ input: stream }).on("line", (line) => logger.info(line));
  }
  return child;
}

export default async function setup() {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("E2E requires macOS or Linux.");
  if (!existsSync(join(root, "out/main/index.js"))) throw new Error("Build the app in CI before running E2E.");
  if (process.env.OPENBOT_E2E_SUITE === "release" || process.env.OPENBOT_E2E_SUITE === "live") {
    const lock = await loadAgentRuntimeLock(root);
    const versions: Record<string, string> = {};
    for (const provider of providers) {
      modelFor(provider);
      const path = process.env[`OPENBOT_${provider.toUpperCase()}_PATH`];
      if (!path) throw new Error(`Set OPENBOT_${provider.toUpperCase()}_PATH to the pinned CI runtime.`);
      const { stdout } = await promisify(execFile)(path, ["--version"], { timeout: 15_000 });
      const version = /\b\d+\.\d+\.\d+\b/u.exec(stdout)?.[0];
      if (version !== lock[provider].version)
        throw new Error(`${provider} must use pinned runtime ${lock[provider].version}.`);
      versions[provider] = version;
    }
    process.env.OPENBOT_E2E_RUNTIME_VERSIONS = JSON.stringify(versions);
    if (!process.env.OPENCODE_API_KEY) throw new Error("Set OPENCODE_API_KEY for the dedicated CI account.");
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  await rm(join(output, "report"), { recursive: true, force: true });
  const runRoot = await mkdtemp(join(output, "private-"));
  const registry = join(runRoot, "registry");
  process.env.OPENBOT_DEV_REGISTRY_DIR = registry;
  ensureDevelopmentState(root);
  const defaults = createDevelopmentDefaults();
  const children: ChildProcess[] = [];
  const site = await startSite().catch(async (error) => {
    await rm(runRoot, { recursive: true, force: true });
    throw error;
  });
  try {
    const environment = await withDevPortAllocation(async (records) => {
      const held = new Set(records.flatMap((record) => record.ports.map((port) => port.port)));
      const reserved = new Set<number>();
      const allocate = async () => {
        const port = await findAvailablePort(12_000, reserved, held);
        reserved.add(port);
        return port;
      };
      const api = await allocate();
      const signal = await allocate();
      const health = await allocate();
      const apiUrl = `http://127.0.0.1:${api}`;
      const env = await loadDevelopmentEnvironment(root, {
        ...process.env,
        ...defaults,
        OPENBOT_API_HOST: "127.0.0.1",
        OPENBOT_API_PORT: String(api),
        OPENBOT_AUTH_API_URL: apiUrl,
        OPENBOT_DEV_PERSIST_PATH: join(runRoot, "account-state"),
        REMOTE_SIGNAL_HOST: "127.0.0.1",
        REMOTE_SIGNAL_PORT: String(signal),
        REMOTE_HEALTH_PORT: String(health),
        REMOTE_SIGNAL_URL: `ws://127.0.0.1:${signal}/v1/signal`,
        REMOTE_CONTROL_PLANE_URL: apiUrl,
        REMOTE_AUTH_WEBHOOK_URL: `http://127.0.0.1:${signal}/internal/auth-events`,
        REMOTE_TLS_DISABLED: "true",
        REMOTE_SESSION_SECRET: randomBytes(32).toString("hex"),
        TURN_SHARED_SECRET: randomBytes(32).toString("hex"),
        TURN_HOST: "127.0.0.1",
      });
      for (const [key, value] of Object.entries(env)) {
        if (value && /secret|token|password|key/i.test(key)) registerSecretValue(value);
      }
      const migration = start(
        ["run", "--cwd", "apps/auth-api", "db:migrate:local", "--persist-to", env.OPENBOT_DEV_PERSIST_PATH ?? ""],
        env,
      );
      children.push(migration);
      await new Promise<void>((done, reject) => {
        migration.once("error", reject);
        migration.once("exit", (code) => (code === 0 ? done() : reject(new Error("E2E account migration failed."))));
      });
      const apiProcess = start(["scripts/run-development.ts", "api"], developmentChildEnvironment(env, "api"));
      const signalProcess = start(["remote/api/src/index.ts"], developmentChildEnvironment(env, "remote"));
      children.push(apiProcess, signalProcess);
      if (!apiProcess.pid || !signalProcess.pid) throw new Error("Could not start the E2E services.");
      writeDevStackRecord({
        services: ["api", "remote"],
        projectRoot: root,
        supervisorPid: process.pid,
        startedAt: Date.now(),
        ports: [
          { name: "api", port: api },
          { name: "signal", port: signal },
          { name: "signal-health", port: health },
        ],
        processes: [
          { name: "api", pid: apiProcess.pid, startedAt: Date.now() },
          { name: "remote", pid: signalProcess.pid, startedAt: Date.now() },
        ],
      });
      process.env.OPENBOT_E2E_SERVICES = JSON.stringify({
        apiUrl,
        siteUrl: site.url,
        registry,
        directory: runRoot,
      });
      return env;
    });
    for (const url of [environment.OPENBOT_AUTH_API_URL, `http://127.0.0.1:${environment.REMOTE_HEALTH_PORT}`]) {
      await expect
        .poll(
          async () => {
            try {
              return (await fetch(`${url}/health/live`, { signal: AbortSignal.timeout(1_000) })).ok;
            } catch {
              return false;
            }
          },
          { timeout: 180_000, message: "E2E services must become ready." },
        )
        .toBe(true);
    }
    process.env.OPENBOT_AUTH_API_URL = environment.OPENBOT_AUTH_API_URL;
    process.env.OPENBOT_E2E_STARTED_AT = String(Date.now());
    return async () => {
      await site.stop();
      for (const child of children.reverse()) await stopChild(child);
      removeDevStackRecord({ supervisorPid: process.pid });
      if (readAllDevStackRecords().length > 0)
        throw new Error("An E2E app did not stop. Its registry and profile remain for cleanup.");
      await rm(runRoot, { recursive: true, force: true });
    };
  } catch (error) {
    await site.stop();
    for (const child of children.reverse()) await stopChild(child);
    removeDevStackRecord({ supervisorPid: process.pid });
    await rm(runRoot, { recursive: true, force: true });
    throw error;
  }
}
