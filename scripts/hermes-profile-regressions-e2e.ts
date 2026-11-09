import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const caseNames = ["shutdown-race", "shutdown-control", "reserved", "list-bound"];
const selected = process.argv[2];
assert.ok(selected === undefined || caseNames.includes(selected), "Use a supported regression case.");
const root = await mkdtemp(join(tmpdir(), "openbot-hermes-regressions-"));
const previous = {
  HOME: process.env.HOME,
  HERMES_HOME: process.env.HERMES_HOME,
  OPENBOT_HERMES_PATH: process.env.OPENBOT_HERMES_PATH,
};
process.env.HOME = join(root, "home");
delete process.env.HERMES_HOME;
delete process.env.OPENBOT_HERMES_PATH;
await mkdir(process.env.HOME, { recursive: true });

interface Observation {
  name: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
}

interface CaseReport {
  name: string;
  passed: boolean;
  checks: Observation[];
  error?: string;
  shutdown?: {
    settings: string;
    stop: string;
    aAliveAfterStop: boolean;
    bAliveAfterStop: boolean;
    aStoppedByOpenBot: boolean;
    aBlockedWhenDisposed: boolean;
    aliveAfterStop: number[];
    cleanupKilled: number[];
  };
}

const cases: CaseReport[] = [];
const report = {
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sources: [
    "src/backend/agent-service.ts",
    "src/backend/agent/provider-runtime.ts",
    "src/backend/agent/model-catalog.ts",
    "src/backend/agent-store.ts",
    "src/backend/hermes-profiles.ts",
    "src/backend/provider-drivers.ts",
    "src/backend/process-confinement.ts",
    "src/backend/protocol.ts",
    "src/preload/agent-decoding.ts",
    "packages/contracts/src/agent-providers.ts",
  ].map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  cases,
  passed: false,
};
const output = resolve(import.meta.dirname, "../.openbot-build/hermes-profile-regressions-e2e", selected ?? "all");
const { listHermesProfiles, resolveHermesRuntime } = await import("../src/backend/hermes-profiles");
const { decodeHermesProfiles } = await import("../src/preload/agent-decoding");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { NO_PROVIDER_CREDENTIALS, requireProviderDriver } = await import("../src/backend/provider-drivers");
const { decodeRecordResponse } = await import("../src/backend/protocol");
const { alive, fakeHermes, launchRows, makeService, seedAgents, waitFor } = await import(
  "./hermes-profile-regressions-fixture"
);

function check(result: CaseReport, name: string, actual: unknown, expected: unknown): void {
  result.checks.push({ name, passed: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
}

async function profileCase(result: CaseReport, large: boolean): Promise<void> {
  const fixture = join(root, result.name);
  const hermes = join(fixture, "hermes");
  const profiles = join(hermes, "profiles");
  await mkdir(profiles, { recursive: true });
  await writeFile(join(hermes, "config.yaml"), "agent: {}\n");
  const env = { HOME: process.env.HOME, HERMES_HOME: hermes };
  const named = async (id: string, marker = "config.yaml") => {
    await mkdir(join(profiles, id));
    await writeFile(join(profiles, id, marker), "");
  };
  if (large) {
    for (let index = 0; index < 4095; index += 1) await named(`p${String(index).padStart(4, "0")}`, "SOUL.md");
    const boundary = listHermesProfiles(env);
    check(result, "4095 named profiles and default decode at the limit", decodeHermesProfiles(boundary).length, 4096);
    check(
      result,
      "default occurs once at the start",
      boundary[0] === "default" && boundary.lastIndexOf("default") === 0,
      true,
    );
    await named("p4095", "SOUL.md");
    let discovered: string[] | undefined;
    try {
      discovered = listHermesProfiles(env);
    } catch (error) {
      assert.ok(error instanceof Error);
      check(result, "overflow has a bounded discovery error", /could not list/i.test(error.message), true);
    }
    if (discovered) {
      check(result, "discovery includes default in the response bound", discovered.length <= 4096, true);
      check(result, "discovery retains default", discovered[0], "default");
      try {
        check(result, "discovery output decodes unchanged", decodeHermesProfiles(discovered), discovered);
      } catch (error) {
        check(
          result,
          "discovery output reaches the renderer",
          error instanceof Error ? error.message : String(error),
          "decoded",
        );
      }
    }
    await named("p4096", "SOUL.md");
    assert.throws(() => listHermesProfiles(env), /could not list/i, "directory scanning remains bounded");
    check(result, "more than 4096 directory entries fail closed", true, true);
    return;
  }
  const markers = ["config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db"];
  for (const [index, marker] of markers.entries()) await named(`marker-${index}`, marker);
  for (const id of [
    "default",
    "work",
    "test",
    "tmp",
    "hermes",
    "root",
    "sudo",
    "Upper",
    "with space",
    "_prefix",
    "a".repeat(65),
  ])
    await named(id);
  await named("a".repeat(64));
  await named("0-id_ok");
  await mkdir(join(profiles, "ghost"));
  await named("deleted");
  await mkdir(join(profiles, ".deleted"));
  await writeFile(join(profiles, ".deleted", "deleted"), "");
  await named("tomb-link");
  await symlink(join(fixture, "missing-tomb"), join(profiles, ".deleted", "tomb-link"));
  await mkdir(join(fixture, "linked-target"));
  await writeFile(join(fixture, "linked-target", "config.yaml"), "");
  await symlink(join(fixture, "linked-target"), join(profiles, "linked"));
  await mkdir(join(profiles, "marker-link"));
  await symlink(join(fixture, "missing-marker"), join(profiles, "marker-link", "config.yaml"));
  await mkdir(join(profiles, "marker-directory", "config.yaml"), { recursive: true });
  const expected = [
    "0-id_ok",
    "a".repeat(64),
    "linked",
    "marker-link",
    ...markers.map((_, index) => `marker-${index}`),
    "work",
  ].sort();
  const listed = listHermesProfiles(env);
  check(result, "discovery offers only valid live explicit selections", listed, ["default", ...expected]);
  check(result, "canonical default selects the root", resolveHermesRuntime("default", env).home, hermes);
  check(
    result,
    "named selection resolves its own home",
    resolveHermesRuntime("work", env).home,
    join(profiles, "work"),
  );
  check(
    result,
    "profile-shaped environment keeps explicit default canonical",
    resolveHermesRuntime("default", { ...env, HERMES_HOME: join(profiles, "work") }).home,
    hermes,
  );
  check(
    result,
    "inherited selection preserves the supplied home",
    resolveHermesRuntime(undefined, { ...env, HERMES_HOME: join(profiles, "work") }).home,
    join(profiles, "work"),
  );
  for (const id of expected) check(result, `${id} resolves`, resolveHermesRuntime(id, env).profileId, id);
  for (const id of [
    "test",
    "tmp",
    "hermes",
    "root",
    "sudo",
    "Upper",
    "../escape",
    "with space",
    "_prefix",
    "a".repeat(65),
    "missing",
    "ghost",
    "deleted",
    "tomb-link",
    "marker-directory",
  ]) {
    let rejected = false;
    try {
      resolveHermesRuntime(id, env);
    } catch {
      rejected = true;
    }
    check(result, `${id} fails explicit resolution`, rejected, true);
  }
  const executable = await fakeHermes(fixture);
  const driver = requireProviderDriver("hermes");
  for (const id of ["default", "work", "test", "tmp", "hermes", "root", "sudo"]) {
    const child = driver.createClient({ executable, version: "fixture", source: "system" }, 5_000, {
      ...NO_PROVIDER_CREDENTIALS,
      providerStateDirectory: join(fixture, "provider-state"),
      hermesProfile: { profileId: id, home: id === "default" ? hermes : join(profiles, id), identity: id },
    });
    let rejected = false;
    try {
      child.start();
      if (id === "default" || id === "work")
        await runCauseEffect(child.request("initialize", {}, decodeRecordResponse));
    } catch {
      rejected = true;
    } finally {
      await runCauseEffect(child.stop());
    }
    check(result, `${id} uses compatible explicit launch validation`, rejected, id !== "default" && id !== "work");
  }
  await rm(join(profiles, "work"), { recursive: true });
  assert.throws(() => resolveHermesRuntime("work", env), /missing, deleted, or unavailable/);
  check(
    result,
    "removed selection fails without a fallback or directory creation",
    existsSync(join(profiles, "work")),
    false,
  );
}

async function shutdownCase(result: CaseReport): Promise<void> {
  const fixture = join(root, result.name);
  await mkdir(fixture);
  const [a, b] = await seedAgents(fixture);
  assert.ok(a && b, "Both saved agents exist.");
  const { service } = await makeService(fixture);
  const log = join(fixture, "launch.jsonl");
  let stopped = false;
  const outcome = (error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`;
  try {
    await runCauseEffect(service.initialize());
    await runCauseEffect(service.readAgentSessionSettings(b));
    const bPid = launchRows(log)
      .filter((row) => row.argv?.join(" ") === "--profile default acp")
      .at(-1)?.pid;
    assert.ok(bPid, "The default agent owns a fake ACP process.");
    await runCauseEffect(service.listHermesModels("work"));
    await writeFile(join(fixture, "latch-enabled"), "");
    const settings = runCauseEffect(service.readAgentSessionSettings(a)).then(() => "fulfilled", outcome);
    await waitFor(fixture, () => launchRows(log).some((row) => row.event === "blocked"), "work catalog read");
    const aPid = launchRows(log).find((row) => row.event === "blocked")?.pid;
    assert.ok(aPid, "The work agent waits for its catalog response.");
    let stop: Promise<string>;
    if (result.name === "shutdown-race") {
      stop = runCauseEffect(service.stop()).then(() => "fulfilled", outcome);
      await waitFor(
        fixture,
        () => launchRows(log).some((row) => row.pid === bPid && ["stdin-end", "sigterm"].includes(row.event)),
        "default client disposal",
      );
      check(
        result,
        "the work client is blocked during disposal",
        launchRows(log).some((row) => row.pid === aPid && row.event === "released"),
        false,
      );
      await writeFile(join(fixture, "release"), "");
    } else {
      await writeFile(join(fixture, "release"), "");
      check(result, "the control completes settings before stop", await settings, "fulfilled");
      stop = runCauseEffect(service.stop()).then(() => "fulfilled", outcome);
    }
    const stopResult = await stop;
    stopped = true;
    const settingsResult = await settings;
    const events = launchRows(log);
    result.shutdown = {
      settings: settingsResult,
      stop: stopResult,
      aAliveAfterStop: alive(aPid),
      bAliveAfterStop: alive(bPid),
      aStoppedByOpenBot: events.some((row) => row.pid === aPid && ["stdin-end", "sigterm"].includes(row.event)),
      aBlockedWhenDisposed: result.name === "shutdown-race",
      aliveAfterStop: [...new Set(events.filter((row) => row.event === "launch").map((row) => row.pid))].filter(alive),
      cleanupKilled: [],
    };
    check(result, "service stop completes", stopResult, "fulfilled");
    check(
      result,
      "the work client exits after stop and the pending read settle",
      result.shutdown.aAliveAfterStop,
      false,
    );
    check(
      result,
      "the default client exits after stop and the pending read settle",
      result.shutdown.bAliveAfterStop,
      false,
    );
    check(result, "OpenBot stops the work client", result.shutdown.aStoppedByOpenBot, true);
    check(result, "no fake ACP process survives stop and the pending read", result.shutdown.aliveAfterStop, []);
    check(
      result,
      "a raced settings read fails after stop",
      settingsResult.startsWith("rejected:"),
      result.name === "shutdown-race",
    );
  } finally {
    await writeFile(join(fixture, "release"), "");
    if (!stopped) await runCauseEffect(service.stop()).catch(() => undefined);
    const launched = [
      ...new Set(
        launchRows(log)
          .filter((row) => row.event === "launch")
          .map((row) => row.pid),
      ),
    ];
    for (const pid of launched) {
      if (!alive(pid)) continue;
      process.kill(pid, "SIGKILL");
      result.shutdown?.cleanupKilled.push(pid);
    }
    if (existsSync(log)) await writeFile(join(output, `${result.name}-launch.jsonl`), readFileSync(log));
  }
}

try {
  await mkdir(output, { recursive: true });
  for (const name of selected ? [selected] : caseNames) {
    const result: CaseReport = { name, passed: false, checks: [] };
    report.cases.push(result);
    try {
      if (name.startsWith("shutdown-")) await shutdownCase(result);
      else await profileCase(result, name === "list-bound");
      assert.deepEqual(
        result.checks.filter((item) => !item.passed),
        [],
        `${name} must meet the profile contract.`,
      );
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.stack : String(error);
      process.exitCode = 1;
    }
  }
  report.passed = report.cases.every((item) => item.passed);
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(process.exitCode ?? 0));
