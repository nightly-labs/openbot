import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import lockValue from "../native-runtime.lock.json";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { ProviderRuntimeFailure } from "../src/main/provider-runtime-effects";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-update-retry-e2e");
const WAIT_MS = 30_000;
const VERSION = "999.0.0";
const root = await mkdtemp(join(tmpdir(), "openbot-provider-update-retry-"));

interface FailedTry {
  phase: string;
  version: string | null;
  archiveRequests: number;
  installKept: boolean;
  archiveKept: boolean;
}

interface Retry {
  phase: string;
  version: string | null;
  archiveRequests: number;
  archiveKept: boolean;
  starts: number;
}

interface Report {
  passed: boolean;
  withOlderCopy?: { failedTry: FailedTry; retry: Retry };
  onlyCopy?: { failedTry: FailedTry; retry: Retry };
  error?: string;
}

const report: Report = { passed: false };

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

async function runScenario(name: string, olderVersion: string | null) {
  const store = join(root, name, "store");
  const downloads = join(root, name, "downloads");
  mkdirSync(store, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  if (olderVersion) {
    const olderBin = join(store, "codex", "linux-x64", olderVersion, "bin");
    mkdirSync(olderBin, { recursive: true });
    writeFileSync(join(olderBin, "codex"), `#!/bin/sh\necho "codex-cli ${olderVersion}"\n`);
    await chmod(join(olderBin, "codex"), 0o755);
  }
  archiveRequests = 0;
  let starts = 0;
  const manager = new ProviderRuntimeManager({
    root: store,
    downloadRoot: downloads,
    platform: "linux",
    architecture: "x64",
    lock,
    fetchImpl,
    availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    updateRuntime: (_runtime, install) =>
      install().pipe(
        Effect.flatMap(() => {
          starts += 1;
          return starts === 1
            ? Effect.fail(new ProviderRuntimeFailure({ cause: new Error("ChatGPT did not answer in time.") }))
            : Effect.void;
        }),
      ),
  });

  const codexPhase = (phase: string): Promise<ProviderRuntimeSnapshot> =>
    new Promise((resolveWait, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for Codex to be ${phase}.`)), WAIT_MS);
      const listener = (snapshot: ProviderRuntimeSnapshot) => {
        if (snapshot.providers.codex.phase !== phase) return;
        clearTimeout(timer);
        manager.off("status", listener);
        resolveWait(snapshot);
      };
      manager.on("status", listener);
    });
  const archiveKept = () =>
    readdirSync(downloads).some((entry) => entry.startsWith("codex-") && entry.includes(".partial"));
  const installRoot = join(store, "codex", "linux-x64", VERSION);

  try {
    const failed = codexPhase("download-error");
    await runCauseEffect(manager.download("codex"));
    const failure = await failed;
    const failedTry: FailedTry = {
      phase: failure.providers.codex.phase,
      version: failure.providers.codex.version,
      archiveRequests,
      installKept: existsSync(join(installRoot, "bin", "codex")),
      archiveKept: archiveKept(),
    };

    writeFileSync(join(downloads, "codex-linux-x64-0.1.0.partial"), "old");
    writeFileSync(join(downloads, "codex-linux-x64-0.1.0.partial.json"), "{}");
    const ready = codexPhase("ready");
    await runCauseEffect(manager.download("codex"));
    const done = await ready;
    const retry: Retry = {
      phase: done.providers.codex.phase,
      version: done.providers.codex.version,
      archiveRequests,
      archiveKept: archiveKept(),
      starts,
    };
    return { failedTry, retry };
  } finally {
    await runCauseEffect(manager.stop()).catch(() => undefined);
  }
}

try {
  const withOlderCopy = await runScenario("with-older-copy", "0.1.0");
  report.withOlderCopy = withOlderCopy;
  const onlyCopy = await runScenario("only-copy", null);
  report.onlyCopy = onlyCopy;

  report.passed =
    withOlderCopy.failedTry.version === "0.1.0" &&
    withOlderCopy.failedTry.archiveRequests === 1 &&
    !withOlderCopy.failedTry.installKept &&
    withOlderCopy.failedTry.archiveKept &&
    withOlderCopy.retry.version === VERSION &&
    withOlderCopy.retry.archiveRequests === 1 &&
    !withOlderCopy.retry.archiveKept &&
    withOlderCopy.retry.starts === 2 &&
    onlyCopy.failedTry.archiveRequests === 1 &&
    onlyCopy.failedTry.installKept &&
    !onlyCopy.failedTry.archiveKept &&
    onlyCopy.retry.version === VERSION &&
    onlyCopy.retry.archiveRequests === 1 &&
    onlyCopy.retry.starts === 2;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
