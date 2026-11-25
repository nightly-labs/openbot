import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import lockValue from "../native-runtime.lock.json";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-runtime-kernel-e2e");
const WAIT_MS = 30_000;
const TARGET = "linux-arm64";

const CASES = [
  {
    name: "16 KiB memory pages",
    stderr:
      "F1111 11:50:12.383176 page-size.cc:19] Check failed: sysconf(_SC_PAGE_SIZE) == kPageSize (16384 vs. 4096) Compile-time page size does not match runtime page size",
    message: sourceText("error.provider.largeMemoryPages"),
  },
  {
    name: "IPv6 off",
    stderr: "F1111 11:50:12.383176 socket.cc:88] Check failed: enforce_kernel_ipv6_support: socket(AF_INET6) failed",
    message: sourceText("error.provider.ipv6Missing"),
  },
] as const;

interface CaseReport {
  name: string;
  phase: string;
  message: string | null;
  passed: boolean;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-runtime-kernel-e2e-"));
const report: { passed: boolean; cases: CaseReport[]; error?: string } = { passed: false, cases: [] };
const baseLock = parseAgentRuntimeLock(lockValue);
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const managers: ProviderRuntimeManager[] = [];

function failingArchive(caseRoot: string, stderr: string) {
  const packageRoot = join(caseRoot, "package");
  mkdirSync(packageRoot, { recursive: true });
  const executable = `#!/bin/sh\necho '${stderr}' >&2\nexit 134\n`;
  writeFileSync(join(packageRoot, "antigravity"), executable, { mode: 0o755 });
  const archivePath = join(caseRoot, "antigravity.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", packageRoot, "antigravity"]);
  return { archive: readFileSync(archivePath), executable };
}

function phaseAfterDownload(manager: ProviderRuntimeManager): Promise<ProviderRuntimeSnapshot> {
  return new Promise((settle, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for the Antigravity download to end.")),
      WAIT_MS,
    );
    const listener = (snapshot: ProviderRuntimeSnapshot) => {
      if (!["download-error", "ready"].includes(snapshot.providers.antigravity.phase)) return;
      clearTimeout(timer);
      manager.off("status", listener);
      settle(snapshot);
    };
    manager.on("status", listener);
  });
}

async function runCase(index: number, entry: (typeof CASES)[number]): Promise<void> {
  const caseRoot = join(root, `case-${index}`);
  const { archive, executable } = failingArchive(caseRoot, entry.stderr);
  const lock = structuredClone(baseLock);
  lock.antigravity.artifacts[TARGET] = {
    ...lock.antigravity.artifacts[TARGET],
    assetSha256: sha256(archive),
    downloadBytes: archive.length,
    installedBytes: executable.length,
    files: { "bin/antigravity": sha256(executable) },
  };
  const manager = new ProviderRuntimeManager({
    root: join(caseRoot, "store"),
    downloadRoot: join(caseRoot, "downloads"),
    platform: "linux",
    architecture: "arm64",
    lock,
    isProviderOn: (provider) => provider === "antigravity",
    availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith(".tar.gz")
        ? new Response(archive, { headers: { "content-length": String(archive.length) } })
        : new Response("not found", { status: 404 });
    },
  });
  managers.push(manager);
  mkdirSync(join(caseRoot, "store"), { recursive: true });
  mkdirSync(join(caseRoot, "downloads"), { recursive: true });
  const ended = phaseAfterDownload(manager);
  await runCauseEffect(manager.download("antigravity"));
  const status = (await ended).providers.antigravity;
  const result: CaseReport = {
    name: entry.name,
    phase: status.phase,
    message: status.message,
    passed: status.phase === "download-error" && status.message === entry.message,
  };
  report.cases.push(result);
  assert.equal(status.phase, "download-error", `${entry.name}: the download ends with an error`);
  assert.equal(status.message, entry.message, `${entry.name}: the error names the kernel problem`);
}

try {
  for (const [index, entry] of CASES.entries()) await runCase(index, entry);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  for (const manager of managers) await runCauseEffect(manager.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
