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
const store = join(root, "store");
const downloads = join(root, "downloads");

interface Report {
  passed: boolean;
  failedTry?: { phase: string; archiveRequests: number; installKept: boolean; archiveKept: boolean };
  retry?: { phase: string; version: string | null; archiveRequests: number; archiveKept: boolean; starts: number };
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

function codexPhase(phase: string): Promise<ProviderRuntimeSnapshot> {
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

const archiveKept = () => readdirSync(downloads).some((name) => name.startsWith("codex-") && name.includes(".partial"));
const installRoot = join(store, "codex", "linux-x64", VERSION);

try {
  mkdirSync(store, { recursive: true });
  mkdirSync(downloads, { recursive: true });

  const failed = codexPhase("download-error");
  await runCauseEffect(manager.download("codex"));
  const failure = await failed;
  report.failedTry = {
    phase: failure.providers.codex.phase,
    archiveRequests,
    installKept: existsSync(installRoot),
    archiveKept: archiveKept(),
  };

  writeFileSync(join(downloads, "codex-linux-x64-0.1.0.partial"), "old");
  writeFileSync(join(downloads, "codex-linux-x64-0.1.0.partial.json"), "{}");
  const ready = codexPhase("ready");
  await runCauseEffect(manager.download("codex"));
  const done = await ready;
  report.retry = {
    phase: done.providers.codex.phase,
    version: done.providers.codex.version,
    archiveRequests,
    archiveKept: archiveKept(),
    starts,
  };

  report.passed =
    report.failedTry.archiveRequests === 1 &&
    !report.failedTry.installKept &&
    report.failedTry.archiveKept &&
    report.retry.version === VERSION &&
    report.retry.archiveRequests === 1 &&
    !report.retry.archiveKept &&
    report.retry.starts === 2;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(manager.stop()).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
