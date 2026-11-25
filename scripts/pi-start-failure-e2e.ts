import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { sourceText } from "@openbot/i18n/source";
import { teeLogLines } from "@openbot/logging";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { INSTALL_RECORD } from "../src/main/provider-runtime-descriptors";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-start-failure-e2e");
const PRINTED = "openbot-e2e-printed-text";
const VERSION = "999.0.0";

interface Report {
  passed: boolean;
  messages?: { managed: string; managedUnreadable: string; installed: string };
  logLines?: string[];
  phases?: { offAtStart: string; keyProviderOn: string; keyProviderOnStarts: string };
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-start-failure-e2e-"));
const report: Report = { passed: false };
const logLines: string[] = [];
const stopTee = teeLogLines(["provider-runtime"], (line) => {
  if (line.includes("Provider CLI did not start.")) logLines.push(line);
});

async function program(path: string, output: string, exitCode: number): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\necho "${output}"\necho "${PRINTED}" >&2\nexit ${exitCode}\n`, { mode: 0o755 });
  return path;
}

async function failure(input: Parameters<typeof resolvePiCli>[0]): Promise<string> {
  const error = await runCauseEffect(resolvePiCli(input)).then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(error instanceof Error, "the resolver fails");
  return error.message;
}

async function installPi(store: string, output: string, exitCode: number): Promise<void> {
  const probe = new ProviderRuntimeManager({ root: store, downloadRoot: join(store, "downloads") });
  const pinned = probe.executablePath("pi");
  assert.ok(pinned, "this platform has managed runtimes");
  const targetRoot = dirname(dirname(dirname(pinned)));
  const executable = join(targetRoot, VERSION, "bin", basename(pinned));
  await program(executable, output, exitCode);
  const digest = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  const record = {
    layoutVersion: 1,
    runtime: "pi",
    version: VERSION,
    target: basename(targetRoot),
    files: { [`bin/${basename(pinned)}`]: digest },
  };
  await writeFile(join(targetRoot, VERSION, INSTALL_RECORD), `${JSON.stringify(record)}\n`);
}

async function piPhaseAtStart(store: string, on: readonly AgentProviderId[]): Promise<string> {
  const manager = new ProviderRuntimeManager({
    root: store,
    downloadRoot: join(store, "downloads"),
    isProviderOn: (provider) => on.includes(provider),
    availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  try {
    await runCauseEffect(manager.initialize());
    return manager.getStatus().providers.pi.phase;
  } finally {
    await runCauseEffect(manager.stop()).catch(() => undefined);
  }
}

try {
  const managed = await program(join(root, "managed", "pi"), "", 3);
  const unreadable = await program(join(root, "unreadable", "pi"), "no version here", 0);
  const installed = await program(join(root, "installed", "pi"), "", 3);
  report.messages = {
    managed: await failure({ bundledExecutable: managed, systemCandidates: [] }),
    managedUnreadable: await failure({ bundledExecutable: unreadable, systemCandidates: [] }),
    installed: await failure({ bundledExecutable: null, systemCandidates: [installed] }),
  };
  await failure({ bundledExecutable: managed, systemCandidates: [] });
  const managedText = sourceText("error.provider.nativeManagedNotStarted", { provider: "Pi" });
  assert.deepEqual(
    report.messages,
    {
      managed: managedText,
      managedUnreadable: managedText,
      installed: sourceText("error.provider.nativeNotStarted", { provider: "Pi" }),
    },
    "OpenBot's copy names a step in the app, and the user's own Pi is named as theirs",
  );

  report.logLines = logLines;
  assert.equal(logLines.length, 3, "each failure is logged once");
  assert.ok(
    logLines.some((line) => line.includes('"source":"managed"') && line.includes('"code":3')),
    "the log keeps the source and the exit code",
  );
  assert.ok(
    logLines.some((line) => line.includes('"code":"invalid"')),
    "the log tells an unreadable version from a failed start",
  );
  assert.ok(
    logLines.some((line) => line.includes('"source":"system"')),
    "the log names the user's own Pi",
  );
  assert.ok(!logLines.some((line) => line.includes(PRINTED)), "the log keeps nothing that the program printed");

  const broken = join(root, "store-broken");
  await installPi(broken, "", 3);
  const offAtStart = await piPhaseAtStart(broken, []);
  const keyProviderOn = await piPhaseAtStart(broken, ["openrouter"]);
  const working = join(root, "store-working");
  await installPi(working, VERSION, 0);
  const keyProviderOnStarts = await piPhaseAtStart(working, ["openrouter"]);
  report.phases = { offAtStart, keyProviderOn, keyProviderOnStarts };
  assert.deepEqual(
    report.phases,
    { offAtStart: "ready", keyProviderOn: "not-downloaded", keyProviderOnStarts: "ready" },
    "a Pi that only OpenRouter runs is checked with its version at start, and one that starts stays ready",
  );

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  stopTee();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
