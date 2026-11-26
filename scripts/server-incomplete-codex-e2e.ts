import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentStatus, ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import lockValue from "../native-runtime.lock.json";
import { chooseInstalledFirst, resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";
import { ProviderUseSettingsStore } from "../src/main/provider-use-settings-store";
import { createSystemCliTracker } from "../src/main/system-cli-tracker";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const OUT = resolve(import.meta.dirname, "../.openbot-build/server-incomplete-codex-e2e");
const WAIT_MS = 30_000;
const VERSION = "999.0.0";
const SYSTEM_VERSION = "0.167.2";
const root = await mkdtemp(join(tmpdir(), "openbot-server-incomplete-codex-"));

interface Scenario {
  name: string;
  downloads: number;
  phase: string;
}

interface Report {
  passed: boolean;
  systemCli?: { source: string; version: string; incomplete: boolean };
  scenarios: Scenario[];
  afterDownload?: {
    phase: string;
    version: string | null;
    archiveRequests: number;
    cliSource: string;
    cliVersion: string;
  };
  repeatedStatusDownloads?: number;
  error?: string;
}

const report: Report = { passed: false, scenarios: [] };

const systemBin = join(root, "system", "bin");
mkdirSync(systemBin, { recursive: true });
const stubSource = join(root, "stub", "codex.ts");
mkdirSync(join(root, "stub"), { recursive: true });
writeFileSync(stubSource, `console.log("codex-cli ${SYSTEM_VERSION}");\n`);
execFileSync("bun", ["build", "--compile", stubSource, "--outfile", join(systemBin, "codex")], { stdio: "ignore" });
const systemCodex = join(systemBin, "codex");

const packageRoot = join(root, "package");
mkdirSync(join(packageRoot, "bin"), { recursive: true });
mkdirSync(join(packageRoot, "codex-path"), { recursive: true });
writeFileSync(join(packageRoot, "codex-package.json"), JSON.stringify({ version: VERSION }));
writeFileSync(join(packageRoot, "bin", "codex"), `#!/bin/sh\necho "codex-cli ${VERSION}"\n`);
await chmod(join(packageRoot, "bin", "codex"), 0o755);
writeFileSync(join(packageRoot, "bin", "codex-code-mode-host"), "");
writeFileSync(join(packageRoot, "codex-path", "rg"), "");
const archivePath = join(root, "codex.tar.gz");
execFileSync("tar", ["-czf", archivePath, "-C", packageRoot, "bin", "codex-path", "codex-package.json"]);
const archive = readFileSync(archivePath);
const license = Buffer.from("Apache License 2.0 (test copy)\n");
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

const pinned = parseAgentRuntimeLock(lockValue);
const lock = {
  ...pinned,
  codex: {
    ...pinned.codex,
    version: VERSION,
    tag: `rust-v${VERSION}`,
    licenseSha256: sha256(license),
    artifacts: {
      ...pinned.codex.artifacts,
      "linux-x64": {
        ...pinned.codex.artifacts["linux-x64"],
        assetSha256: sha256(archive),
        downloadBytes: archive.length,
        installedBytes: 1_000_000,
      },
    },
  },
};

let archiveRequests = 0;
const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/LICENSE")) return new Response(license);
  if (url.endsWith(".tar.gz")) {
    archiveRequests += 1;
    return new Response(archive, { headers: { "content-length": String(archive.length) } });
  }
  return new Response("not found", { status: 404 });
};

type ProviderUseChange = Parameters<typeof runCauseEffect>[0];

const resolveSystemFirst = (input: { bundledExecutable?: string | null }) =>
  resolveCodexCli({ systemCandidates: [systemCodex], ...input });

async function codexStatus(): Promise<Pick<AgentStatus, "providers">> {
  const cli = await runCauseEffect(resolveSystemFirst({ bundledExecutable: null }));
  return {
    providers: [
      {
        id: "codex",
        state: "available",
        version: cli.version,
        message: null,
        cliSource: cli.source,
        ...(cli.incomplete ? { cliIncomplete: true } : {}),
      },
    ],
  };
}

function newManager(name: string) {
  const store = join(root, name, "store");
  const downloads = join(root, name, "downloads");
  mkdirSync(store, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  return new ProviderRuntimeManager({
    root: store,
    downloadRoot: downloads,
    platform: "linux",
    architecture: "x64",
    lock,
    fetchImpl,
    availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
  });
}

async function newProviderUse(name: string, change?: (store: ProviderUseSettingsStore) => ProviderUseChange) {
  const store = new ProviderUseSettingsStore(join(root, name, "provider-use.json"));
  mkdirSync(join(root, name), { recursive: true });
  await runCauseEffect(store.load());
  if (change) await runCauseEffect(change(store));
  return store;
}

async function countDownloads(
  name: string,
  options: {
    hosted: boolean;
    server: boolean;
    agents: string[];
    change?: (store: ProviderUseSettingsStore) => ProviderUseChange;
  },
): Promise<Scenario> {
  const manager = newManager(name);
  let downloads = 0;
  const track = createSystemCliTracker({
    runtimes: {
      setSystemVersion: (...args) => manager.setSystemVersion(...args),
      getStatus: () => manager.getStatus(),
      providerUseChanged: () => manager.providerUseChanged(),
      executablePath: (runtime) => manager.executablePath(runtime),
      download: () => {
        downloads += 1;
        return Effect.succeed(manager.getStatus());
      },
    },
    providerUse: await newProviderUse(name, options.change),
    agentProviders: () => new Set(options.agents),
    hosted: options.hosted,
    server: options.server,
  });
  track(await codexStatus());
  const scenario = { name, downloads, phase: manager.getStatus().providers.codex.phase };
  await runCauseEffect(manager.stop()).catch(() => undefined);
  return scenario;
}

function waitForCodex(manager: ProviderRuntimeManager, phase: string): Promise<ProviderRuntimeSnapshot> {
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Codex to be ${phase}.`)), WAIT_MS);
    const listener = (snapshot: ProviderRuntimeSnapshot) => {
      if (snapshot.providers.codex.phase !== phase) return;
      clearTimeout(timer);
      manager.off("status", listener);
      resolveWait(snapshot);
    };
    manager.on("status", listener);
  });
}

try {
  const systemCli = await runCauseEffect(resolveSystemFirst({ bundledExecutable: null }));
  report.systemCli = {
    source: systemCli.source,
    version: systemCli.version,
    incomplete: systemCli.incomplete === true,
  };

  report.scenarios.push(await countDownloads("desktop-window", { hosted: false, server: false, agents: ["codex"] }));
  report.scenarios.push(
    await countDownloads("installed-version-chosen", {
      hosted: false,
      server: true,
      agents: ["codex"],
      change: (store) => store.setInstalled("codex", true),
    }),
  );
  report.scenarios.push(
    await countDownloads("provider-off", {
      hosted: false,
      server: true,
      agents: ["codex"],
      change: (store) => store.set("codex", false),
    }),
  );
  report.scenarios.push(await countDownloads("no-chatgpt-agent", { hosted: false, server: true, agents: ["claude"] }));
  report.scenarios.push(await countDownloads("hosted-server", { hosted: true, server: true, agents: ["codex"] }));

  const manager = newManager("self-hosted-server");
  const track = createSystemCliTracker({
    runtimes: manager,
    providerUse: await newProviderUse("self-hosted-server"),
    agentProviders: () => new Set(["codex"]),
    hosted: false,
    server: true,
  });
  try {
    const ready = waitForCodex(manager, "ready");
    const status = await codexStatus();
    track(status);
    const done = await ready;
    track(status);
    report.repeatedStatusDownloads = archiveRequests;
    const managedExecutable = manager.executablePath("codex");
    if (!managedExecutable || !existsSync(managedExecutable)) throw new Error("The managed Codex is not on disk.");
    const { cli } = await runCauseEffect(chooseInstalledFirst(resolveSystemFirst, managedExecutable, false));
    report.afterDownload = {
      phase: done.providers.codex.phase,
      version: done.providers.codex.version,
      archiveRequests,
      cliSource: cli.source,
      cliVersion: cli.version,
    };
  } finally {
    await runCauseEffect(manager.stop()).catch(() => undefined);
  }

  const downloadsOf = (name: string) => report.scenarios.find((scenario) => scenario.name === name)?.downloads;
  report.passed =
    report.systemCli.source === "system" &&
    report.systemCli.version === SYSTEM_VERSION &&
    report.systemCli.incomplete &&
    downloadsOf("desktop-window") === 0 &&
    downloadsOf("installed-version-chosen") === 0 &&
    downloadsOf("provider-off") === 0 &&
    downloadsOf("no-chatgpt-agent") === 0 &&
    downloadsOf("hosted-server") === 1 &&
    report.afterDownload.phase === "ready" &&
    report.afterDownload.version === VERSION &&
    report.afterDownload.archiveRequests === 1 &&
    report.afterDownload.cliSource === "managed" &&
    report.afterDownload.cliVersion === VERSION &&
    report.repeatedStatusDownloads === 1;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(
  `server-incomplete-codex-e2e: ${report.passed ? "passed" : "failed"}, report in ${OUT}/report.json\n`,
);
if (!report.passed) process.exit(1);
