// Actual store publication with generated facade data and owned child processes only.
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { link, lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import type { AgentSummary, MigrationAssessmentReport } from "@openbot/contracts/ipc";
import { decodeMigrationAssessmentReport } from "@openbot/contracts/ipc-migration-assessment";
import { Effect, Result } from "effect";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { readMigrationAssessmentInventory } from "../src/main/migration-assessment-inventory";
import { MigrationAssessmentService } from "../src/main/migration-assessment-service";
import { readMigrationAssessmentSource } from "../src/main/migration-assessment-source";
import { type MigrationAssessmentFailure, MigrationAssessmentStore } from "../src/main/migration-assessment-store";
import { MigrationPreparationService } from "../src/main/migration-preparation";
import { readMigrationPreparationInventory } from "../src/main/migration-preparation-inventory";
import { MIGRATION_PREPARATION_JOURNAL } from "../src/main/migration-preparation-store";

const output = resolve(import.meta.dirname, "../.openbot-build/migration-assessment-publication-e2e");
const CHILD = "--publication-child";
const CHECKPOINT = "ASSESSMENT_PUBLICATION_CHECKPOINT\n";
const SYNC_FAULT = "ASSESSMENT_SYNC_FAULT_INJECTED\n";
const PHASES = ["before-link", "after-link", "prelink-sync-failure", "postlink-sync-failure"] as const;
type Phase = (typeof PHASES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const now = "2026-01-01T12:00:00.000Z";
const groups: Array<{ name: string; passed: boolean }> = [];
const profiles: string[] = [];
const sourceBaselines: Array<Array<{ path: string; digest: string }>> = [];
interface ChildHandle {
  child: ChildProcessWithoutNullStreams;
  checkpoint: Promise<void>;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
  stop: () => Promise<void>;
}
const children: ChildHandle[] = [];

function profilePath(id: string): string {
  assert.ok(id.length === 36 && UUID.test(id));
  return join(output, `fixture-${id}`);
}
const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
function nextReport(first: MigrationAssessmentReport): MigrationAssessmentReport {
  return decodeMigrationAssessmentReport({
    ...first,
    id: randomUUID(),
    revision: 2,
    createdAt: "2026-01-01T12:01:00.000Z",
  });
}
async function refused<A>(
  operation: Effect.Effect<A, MigrationAssessmentFailure>,
  code: MigrationAssessmentFailure["code"],
) {
  const result = await Effect.runPromise(Effect.result(operation));
  assert.ok(Result.isFailure(result));
  assert.deepEqual(result.failure.toJSON(), { _tag: "MigrationAssessmentFailure", code });
}
async function check(name: string, run: () => Promise<void>) {
  const baselineStart = sourceBaselines.length;
  try {
    await run();
    for (const files of sourceBaselines.slice(baselineStart))
      for (const file of files) assert.equal(await hash(file.path), file.digest);
    groups.push({ name, passed: true });
  } catch (error) {
    if (error instanceof Error) process.stderr.write(`${error.message}\n`);
    groups.push({ name, passed: false });
  }
  process.stdout.write(`${groups.at(-1)?.passed ? "pass" : "FAIL"} ${name}\n`);
}

async function fixture() {
  const id = randomUUID();
  const profile = profilePath(id);
  await mkdir(profile, { mode: 0o700 });
  profiles.push(profile);
  await writeFile(join(profile, "synthetic-fixture"), id, { mode: 0o600 });
  const database = new OpenBotDatabase(profile);
  let first: MigrationAssessmentReport;
  try {
    await Effect.runPromise(database.initialize());
    const agent: AgentSummary = {
      id: "PRIVATE_SYNTHETIC_AGENT",
      name: "PRIVATE_SYNTHETIC_NAME",
      title: "Synthetic",
      description: "PRIVATE_SYNTHETIC_DESCRIPTION",
      notifications: false,
      provider: "codex",
      model: "synthetic-model",
      reasoningEffort: "medium",
      threadId: "PRIVATE_SYNTHETIC_THREAD",
      workspacePath: join(profile, "managed", "Agents", "synthetic"),
      preview: "",
      updatedAt: now,
      avatarSeed: "fixture",
      avatarHue: null,
      avatarUrl: null,
    };
    database.replaceAgents("publication-fixture", [agent], "agents.updated");
    database.persistConversation(
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 0,
        messages: [
          {
            id: "PRIVATE_SYNTHETIC_MESSAGE",
            author: "user",
            text: "PRIVATE_SYNTHETIC_TEXT",
            status: "completed",
            createdAt: now,
          },
        ],
      },
      "conversation.saved",
    );
    const preparation = new MigrationPreparationService({
      userDataPath: profile,
      now: () => now,
      readInventory: () => readMigrationPreparationInventory(() => database.connection),
    });
    const prepared = await Effect.runPromise(
      preparation.prepare({ destinationKind: "other-server", expectedRevision: 0 }),
    );
    assert.ok(prepared.plan);
    const service = new MigrationAssessmentService({
      userDataPath: profile,
      preparation,
      now: () => now,
      readSource: () =>
        readMigrationAssessmentSource({
          appVersion: () => "1.2.3",
          platform: () => "darwin",
          architecture: () => "arm64",
        }),
      readInventory: () =>
        readMigrationAssessmentInventory({
          connection: () => database.connection,
          userDataRoot: profile,
          managedRoot: join(profile, "managed"),
          sourcePlatform: "darwin",
        }),
    });
    const saved = await Effect.runPromise(
      service.assess({
        planId: prepared.plan.id,
        expectedPreparationRevision: prepared.revision,
        expectedAssessmentRevision: 0,
        destination: {
          platform: "darwin",
          architecture: "arm64",
          appVersion: "1.2.3",
          schemaVersion: 49,
          executor: "process",
          dataRoot: "owned",
          persistence: "persistent",
        },
      }),
    );
    assert.ok(saved.assessment);
    first = saved.assessment;
    assert.equal(first.inventory.categories.find((category) => category.category === "agents")?.rowCount, 1);
    assert.equal(
      first.inventory.categories.find((category) => category.category === "conversations")?.coverage,
      "metadata-counted",
    );
    assert.deepEqual(first.operations, { export: false, restore: false, activate: false });
    assert.equal(first.inventoryComplete, false);
    assert.equal(first.destinationVerified, false);
    assert.ok(!JSON.stringify(first).includes("PRIVATE_SYNTHETIC"));
    assert.ok(!JSON.stringify(first).includes(profile));
  } finally {
    database.close();
  }
  const report = nextReport(first);
  await writeFile(join(profile, "append-report.json"), JSON.stringify(report), { mode: 0o600 });
  sourceBaselines.push(
    await Promise.all(
      [
        database.path,
        join(profile, MIGRATION_PREPARATION_JOURNAL),
        join(profile, "synthetic-fixture"),
        join(profile, "append-report.json"),
      ].map(async (path) => ({ path, digest: await hash(path) })),
    ),
  );
  const directory = join(profile, "openbot-migration-assessments-v1", first.planId);
  const store = new MigrationAssessmentStore(profile);
  return {
    id,
    profile,
    directory,
    first,
    report,
    store,
    final: (revision: number) => join(directory, `${revision}.json`),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function linkedRecord(f: Fixture, revision: number): Promise<string> {
  const state = await Effect.runPromise(new MigrationAssessmentStore(f.profile).read(f.first.planId));
  assert.equal(state.revision, revision);
  assert.ok(state.assessment);
  const final = await lstat(f.final(revision));
  assert.ok(final.isFile());
  assert.equal(final.nlink, 2);
  const anchors = (await readdir(f.directory)).filter((name) => name.startsWith(".record-"));
  let matches = 0;
  let anchorPath = "";
  for (const name of anchors) {
    const path = join(f.directory, name, "record.json");
    let anchor: Awaited<ReturnType<typeof lstat>>;
    try {
      anchor = await lstat(path);
    } catch {
      continue;
    }
    if (anchor.ino !== final.ino || anchor.dev !== final.dev) continue;
    matches++;
    anchorPath = path;
    assert.ok(anchor.isFile());
    assert.equal(anchor.nlink, 2);
    assert.equal(await hash(path), await hash(f.final(revision)));
  }
  assert.equal(matches, 1);
  return anchorPath;
}
async function inventory(
  profile: string,
): Promise<Array<{ path: string; kind: string; value: string; links: number }>> {
  const entries: Array<{ path: string; kind: string; value: string; links: number }> = [];
  async function visit(path: string, prefix: string, depth: number): Promise<void> {
    assert.ok(depth < 6 && entries.length < 200);
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name);
      const relative = `${prefix}${name}`;
      const info = await lstat(full);
      if (info.isSymbolicLink())
        entries.push({ path: relative, kind: "symlink", value: await readlink(full), links: info.nlink });
      else if (info.isDirectory()) {
        entries.push({ path: relative, kind: "directory", value: "", links: info.nlink });
        await visit(full, `${relative}/`, depth + 1);
      } else {
        assert.ok(info.isFile());
        entries.push({ path: relative, kind: "file", value: await hash(full), links: info.nlink });
      }
    }
  }
  await visit(profile, "", 0);
  return entries;
}

async function runChild() {
  assert.equal(process.argv.length, 5);
  const id = process.argv[3];
  const phase = process.argv[4];
  assert.ok(typeof id === "string" && typeof phase === "string" && PHASES.some((item) => item === phase));
  const profile = profilePath(id);
  const directory = fs.lstatSync(profile);
  assert.ok(directory.isDirectory() && (directory.mode & 0o077) === 0);
  for (const [name, maximum] of [
    ["synthetic-fixture", 36],
    ["append-report.json", 128 * 1024],
  ] as const) {
    const info = fs.lstatSync(join(profile, name));
    assert.ok(info.isFile() && info.nlink === 1 && info.size > 0 && info.size <= maximum && (info.mode & 0o077) === 0);
  }
  assert.equal(fs.readFileSync(join(profile, "synthetic-fixture"), "utf8"), id);
  const report = decodeMigrationAssessmentReport(
    JSON.parse(fs.readFileSync(join(profile, "append-report.json"), "utf8")),
  );
  assert.equal(report.revision, 2);
  assert.deepEqual(report.operations, { export: false, restore: false, activate: false });
  const final = join(profile, "openbot-migration-assessments-v1", report.planId, "2.json");
  const originalLink = fs.linkSync;
  const originalFsync = fs.fsyncSync;
  let published = false;
  let faulted = false;
  function checkpoint() {
    fs.writeSync(1, CHECKPOINT);
    const byte = Buffer.alloc(1);
    assert.equal(fs.readSync(0, byte, 0, 1, null), 1);
  }
  fs.linkSync = (source, target) => {
    if (target === final && phase === "before-link") checkpoint();
    originalLink(source, target);
    if (target === final) published = true;
    if (target === final && phase === "after-link") checkpoint();
  };
  fs.fsyncSync = (handle) => {
    if (
      !faulted &&
      fs.fstatSync(handle).isDirectory() &&
      ((phase === "prelink-sync-failure" && !published) || (phase === "postlink-sync-failure" && published))
    ) {
      faulted = true;
      fs.writeSync(1, SYNC_FAULT);
      throw new Error("synthetic directory sync failure");
    }
    originalFsync(handle);
  };
  syncBuiltinESMExports();
  const result = await Effect.runPromise(Effect.result(new MigrationAssessmentStore(profile).append(1, report)));
  fs.writeSync(
    1,
    `${JSON.stringify(Result.isFailure(result) ? { outcome: "refused", code: result.failure.code } : { outcome: "saved" })}\n`,
  );
}

function startChild(f: Fixture, phase: Phase): ChildHandle {
  const child = spawn(process.execPath, ["--import", "tsx", resolve(import.meta.filename), CHILD, f.id, phase], {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let outputText = "";
  let errorText = "";
  let ready: (() => void) | null = null;
  let rejectReady: (() => void) | null = null;
  const checkpoint = new Promise<void>((resolveReady, rejectCheckpoint) => {
    ready = resolveReady;
    rejectReady = () => rejectCheckpoint(new Error("owned child ended before checkpoint"));
  });
  void checkpoint.catch(() => undefined);
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClosed) => {
    child.once("error", () => {
      rejectReady?.();
      resolveClosed({ code: null, signal: null });
    });
    child.once("close", (code, signal) => {
      rejectReady?.();
      resolveClosed({ code, signal });
    });
  });
  child.stdout.on("data", (bytes: Buffer) => {
    outputText += bytes.toString("utf8");
    if (outputText.includes(CHECKPOINT)) ready?.();
    if (outputText.length > 4096) child.kill("SIGKILL");
  });
  child.stderr.on("data", (bytes: Buffer) => {
    errorText += bytes.toString("utf8");
    if (errorText.length > 4096) child.kill("SIGKILL");
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  void closed.then(() => clearTimeout(timer));
  const value = {
    child,
    checkpoint,
    closed,
    output: () => outputText,
    stop: async () => {
      child.kill("SIGKILL");
      await closed;
    },
  };
  children.push(value);
  return value;
}

if (process.argv[2] === CHILD) {
  await runChild();
  // Output is synchronous and the actual store closes its owned descriptors before returning.
  process.exit(0);
}

try {
  assert.equal(process.argv.length, 2);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await check(
    "real facade and preparation service save a blocked first assessment with two permanent links",
    async () => {
      const f = await fixture();
      await linkedRecord(f, 1);
      assert.deepEqual((await Effect.runPromise(f.store.read(f.first.planId))).assessment, f.first);
    },
  );
  await check("SIGKILL before final publication preserves report1 and permits a new exclusive retry", async () => {
    const f = await fixture();
    const before = await hash(f.final(1));
    const child = startChild(f, "before-link");
    try {
      await child.checkpoint;
      assert.ok(!(await readdir(f.directory)).includes("2.json"));
      await child.stop();
      assert.equal((await child.closed).signal, "SIGKILL");
      assert.equal(await hash(f.final(1)), before);
      await linkedRecord(f, 1);
      const orphan = (await inventory(f.directory)).filter((entry) => entry.kind === "file" && entry.links === 1);
      assert.equal(orphan.length, 1);
      await Effect.runPromise(f.store.append(1, f.report));
      await linkedRecord(f, 2);
      assert.deepEqual(
        (await inventory(f.directory)).filter((entry) => orphan.some((item) => item.path === entry.path)),
        orphan,
      );
      assert.equal(await hash(f.final(1)), before);
    } finally {
      await child.stop();
    }
  });
  await check(
    "SIGKILL after final publication leaves a complete readable report2 and its permanent anchor",
    async () => {
      const f = await fixture();
      const before = await hash(f.final(1));
      const child = startChild(f, "after-link");
      try {
        await child.checkpoint;
        await child.stop();
        assert.equal((await child.closed).signal, "SIGKILL");
        await linkedRecord(f, 2);
        const published = await hash(f.final(2));
        assert.deepEqual((await Effect.runPromise(f.store.read(f.first.planId))).assessment, f.report);
        await refused(f.store.append(1, nextReport(f.first)), "revision-conflict");
        assert.equal(await hash(f.final(2)), published);
        assert.equal(await hash(f.final(1)), before);
      } finally {
        await child.stop();
      }
    },
  );
  await check("a racing parent wins revision2 and the paused child cannot overwrite its bytes", async () => {
    const f = await fixture();
    const first = await hash(f.final(1));
    const child = startChild(f, "before-link");
    try {
      await child.checkpoint;
      const winner = nextReport(f.first);
      await Effect.runPromise(f.store.append(1, winner));
      const before = await hash(f.final(2));
      child.child.stdin.write("x");
      assert.deepEqual(await child.closed, { code: 0, signal: null });
      assert.ok(child.output().includes('{"outcome":"refused","code":"revision-conflict"}'));
      assert.equal(await hash(f.final(2)), before);
      assert.deepEqual((await Effect.runPromise(f.store.read(f.first.planId))).assessment, winner);
      await linkedRecord(f, 2);
      assert.equal(await hash(f.final(1)), first);
    } finally {
      await child.stop();
    }
  });
  await check("prelink directory sync failure leaves report1 intact and retry publishes report2", async () => {
    const f = await fixture();
    const before = await hash(f.final(1));
    const child = startChild(f, "prelink-sync-failure");
    assert.deepEqual(await child.closed, { code: 0, signal: null });
    assert.ok(child.output().includes('{"outcome":"refused","code":"journal-unavailable"}'));
    assert.ok(child.output().includes(SYNC_FAULT));
    assert.ok(!(await readdir(f.directory)).includes("2.json"));
    assert.equal(await hash(f.final(1)), before);
    await linkedRecord(f, 1);
    await Effect.runPromise(f.store.append(1, f.report));
    await linkedRecord(f, 2);
    assert.equal(await hash(f.final(1)), before);
  });
  await check("postlink directory sync failure reports uncertainty and reload finds complete report2", async () => {
    const f = await fixture();
    const before = await hash(f.final(1));
    const child = startChild(f, "postlink-sync-failure");
    assert.deepEqual(await child.closed, { code: 0, signal: null });
    assert.ok(child.output().includes('{"outcome":"refused","code":"journal-unavailable"}'));
    assert.ok(child.output().includes(SYNC_FAULT));
    const final = await hash(f.final(2));
    await linkedRecord(f, 2);
    assert.deepEqual((await Effect.runPromise(f.store.read(f.first.planId))).assessment, f.report);
    await refused(f.store.append(1, nextReport(f.first)), "revision-conflict");
    assert.equal(await hash(f.final(2)), final);
    assert.equal(await hash(f.final(1)), before);
  });
  await check("unknown journal entries refuse without cleanup or publication", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "unknown-entry"), "SYNTHETIC_UNKNOWN", { mode: 0o600 });
    const before = await inventory(f.profile);
    await refused(f.store.read(f.first.planId), "journal-invalid");
    await refused(f.store.append(1, f.report), "journal-invalid");
    assert.deepEqual(await inventory(f.profile), before);
  });
  await check("tampered anchor content is preserved and never reset or overwritten", async () => {
    const f = await fixture();
    const anchor = await linkedRecord(f, 1);
    await writeFile(anchor, "SYNTHETIC_TAMPERED_RECORD", { mode: 0o600 });
    const before = await inventory(f.profile);
    await refused(f.store.read(f.first.planId), "journal-invalid");
    await refused(f.store.append(1, f.report), "journal-invalid");
    assert.deepEqual(await inventory(f.profile), before);
  });
  await check("a symlink at the expected anchor refuses and preserves both the link and target", async () => {
    const f = await fixture();
    const anchor = await linkedRecord(f, 1);
    await rename(anchor, join(f.profile, "held-anchor.json"));
    const target = join(f.profile, "synthetic-target");
    await writeFile(target, "SYNTHETIC_TARGET", { mode: 0o600 });
    await symlink(target, anchor);
    const before = await inventory(f.profile);
    await refused(f.store.read(f.first.planId), "journal-invalid");
    await refused(f.store.append(1, f.report), "journal-invalid");
    assert.deepEqual(await inventory(f.profile), before);
    assert.ok((await lstat(anchor)).isSymbolicLink());
    assert.equal(await readlink(anchor), target);
  });
  await check("an extra hard link refuses without changing any existing record", async () => {
    const f = await fixture();
    await link(f.final(1), join(f.profile, "unexpected-link.json"));
    const before = await inventory(f.profile);
    await refused(f.store.read(f.first.planId), "journal-invalid");
    await refused(f.store.append(1, f.report), "journal-invalid");
    assert.deepEqual(await inventory(f.profile), before);
  });
} finally {
  await Promise.all(children.map((child) => child.stop()));
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify(
      {
        syntheticOnly: true,
        actualFacadeWrites: true,
        actualStorePublication: true,
        ownedChildProcessesOnly: true,
        realDataAccessed: false,
        credentialsAccessed: false,
        appStarted: false,
        providersStarted: false,
        networkUsed: false,
        exportAvailable: false,
        restoreAvailable: false,
        activationAvailable: false,
        groups,
        platform: process.platform,
        limits: [
          "SIGKILL is not power-loss proof",
          "directory-sync faults are injected",
          "no native Windows publication adapter",
        ],
      },
      null,
      2,
    )}\n`,
  );
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}
if (groups.some((group) => !group.passed)) process.exitCode = 1;
