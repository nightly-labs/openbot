// Real preparation + assessment services and generated facade profiles only. No app/bootstrap/network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentSummary,
  ConversationSnapshot,
  MigrationAssessmentDestinationDeclaration,
} from "@openbot/contracts/ipc";
import {
  decodeMigrationAssessmentState,
  MIGRATION_ASSESSMENT_CATEGORIES,
} from "@openbot/contracts/ipc-migration-assessment";
import { Deferred, Effect, Result } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  MigrationAssessmentInventoryFailure,
  readMigrationAssessmentInventory,
} from "../src/main/migration-assessment-inventory";
import { MigrationAssessmentService } from "../src/main/migration-assessment-service";
import { readMigrationAssessmentSource } from "../src/main/migration-assessment-source";
import type { MigrationAssessmentFailure } from "../src/main/migration-assessment-store";
import { MigrationPreparationService } from "../src/main/migration-preparation";
import { readMigrationPreparationInventory } from "../src/main/migration-preparation-inventory";
import { MIGRATION_PREPARATION_JOURNAL } from "../src/main/migration-preparation-store";

const output = resolve(import.meta.dirname, "../.openbot-build/migration-assessment-e2e");
await mkdir(output, { recursive: true, mode: 0o700 });
const base = await mkdtemp(join(output, "fixture-"));
const databases: OpenBotDatabase[] = [];
const groups: Array<{ name: string; passed: boolean }> = [];
const now = "2026-01-01T12:00:00.000Z";
const declared = (
  overrides: Partial<MigrationAssessmentDestinationDeclaration> = {},
): MigrationAssessmentDestinationDeclaration => ({
  platform: "darwin",
  architecture: "arm64",
  appVersion: "1.2.3",
  schemaVersion: 49,
  executor: "process",
  dataRoot: "owned",
  persistence: "persistent",
  ...overrides,
});
const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    groups.push({ name, passed: true });
  } catch {
    groups.push({ name, passed: false });
  }
  process.stdout.write(`${groups.at(-1)?.passed ? "pass" : "FAIL"} ${name}\n`);
}
async function refused<A>(
  operation: Effect.Effect<A, MigrationAssessmentFailure>,
  code: MigrationAssessmentFailure["code"],
) {
  const result = await Effect.runPromise(Effect.result(operation));
  assert.ok(Result.isFailure(result));
  assert.equal(result.failure.code, code);
  const publicError = result.failure.toJSON();
  assert.ok(publicError !== null && typeof publicError === "object");
  assert.deepEqual(Object.keys(publicError).sort(), ["_tag", "code"]);
}
async function fixture(workspaceOnly = false) {
  const profile = join(base, randomUUID());
  const managed = join(profile, "managed");
  await mkdir(profile, { mode: 0o700 });
  const database = new OpenBotDatabase(profile);
  databases.push(database);
  await Effect.runPromise(database.initialize());
  const agent: AgentSummary = {
    id: "PRIVATE_AGENT_ID",
    name: "PRIVATE_AGENT_NAME",
    title: "Synthetic",
    description: "PRIVATE_DESCRIPTION",
    notifications: false,
    provider: workspaceOnly ? "grok" : "codex",
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "PRIVATE_THREAD_ID",
    workspacePath: join(managed, "Agents", "PRIVATE_WORKSPACE"),
    preview: "",
    updatedAt: now,
    avatarSeed: "fixture",
    avatarHue: null,
    avatarUrl: null,
    access: workspaceOnly ? "workspace" : "full",
  };
  database.replaceAgents("fixture", [agent], "agents.updated");
  const conversation: ConversationSnapshot = {
    agentId: agent.id,
    threadId: agent.threadId,
    activeTurnId: null,
    revision: 0,
    messages: [
      { id: "PRIVATE_MESSAGE_ID", author: "user", text: "PRIVATE_MESSAGE_VALUE", createdAt: now, status: "completed" },
    ],
  };
  database.persistConversation(conversation, "conversation.saved");
  new AgentRoutineStore(database).create(
    {
      agentId: agent.id,
      name: "PRIVATE_ROUTINE",
      instruction: "Do not run",
      active: true,
      timezone: "Etc/UTC",
      schedule: { kind: "daily", time: "13:00" },
    },
    new Date(now),
  );
  await writeFile(join(profile, "PRIVATE_CREDENTIAL_FILE"), "PRIVATE_SYNTHETIC_TOKEN", { mode: 0o600 });
  const preparation = new MigrationPreparationService({
    userDataPath: profile,
    now: () => now,
    readInventory: () => readMigrationPreparationInventory(() => database.connection),
  });
  let inventoryReads = 0;
  const inventory = () => {
    inventoryReads++;
    return readMigrationAssessmentInventory({
      connection: () => database.connection,
      userDataRoot: profile,
      managedRoot: managed,
      sourcePlatform: "darwin",
    });
  };
  const source = () =>
    readMigrationAssessmentSource({ appVersion: () => "1.2.3", platform: () => "darwin", architecture: () => "arm64" });
  const service = () =>
    new MigrationAssessmentService({
      userDataPath: profile,
      preparation,
      readInventory: inventory,
      readSource: source,
      now: () => now,
    });
  return { profile, database, preparation, inventory, source, service, reads: () => inventoryReads };
}

try {
  assert.equal(process.argv.length, 2);
  const a = await fixture();
  await check("construction-and-unprepared-state-do-not-inventory-or-create-assessment-storage", async () => {
    const before = await readdir(a.profile);
    const state = await Effect.runPromise(a.service().getState());
    assert.deepEqual(state, { preparation: null, revision: 0, applicability: "none", assessment: null });
    assert.equal(a.reads(), 0);
    await refused(
      a.service().assess({
        planId: randomUUID(),
        expectedPreparationRevision: 1,
        expectedAssessmentRevision: 0,
        destination: declared(),
      }),
      "preparation-unavailable",
    );
    assert.deepEqual(await readdir(a.profile), before);
  });
  const prepared = await Effect.runPromise(
    a.preparation.prepare({ destinationKind: "other-server", expectedRevision: 0 }),
  );
  assert.ok(prepared.plan);
  const input = {
    planId: prepared.plan.id,
    expectedPreparationRevision: 1,
    expectedAssessmentRevision: 0,
    destination: declared(),
  };
  const protectedFiles = [
    a.database.path,
    `${a.database.path}-wal`,
    join(a.profile, MIGRATION_PREPARATION_JOURNAL),
    join(a.profile, "PRIVATE_CREDENTIAL_FILE"),
  ];
  const before = await Promise.all(protectedFiles.map(hash));
  let current = await Effect.runPromise(a.service().getState());
  await check("real-inventory-assessment-is-offline-redacted-and-never-a-readiness-certificate", async () => {
    current = await Effect.runPromise(a.service().assess(input));
    assert.equal(current.revision, 1);
    assert.equal(current.applicability, "current");
    const report = current.assessment;
    assert.ok(report);
    assert.equal(report.comparison, "no-known-mismatch");
    assert.equal(report.provenance, "offline-declaration");
    assert.equal(report.destinationVerified, false);
    assert.equal(report.inventoryComplete, false);
    assert.deepEqual(report.operations, { export: false, restore: false, activate: false });
    assert.equal(report.blockers.length, 6);
    assert.deepEqual(
      report.inventory.categories.map((row) => row.category),
      [...MIGRATION_ASSESSMENT_CATEGORIES],
    );
    assert.equal(report.inventory.categories.filter((row) => row.coverage === "not-inspected").length, 11);
    assert.equal(report.inventory.liveState.activeRoutines, 1);
    assert.equal(report.inventory.credentials.reauthentication, "unresolved");
    assert.ok(report.findings.includes("source-quiescence-unverified"));
    assert.ok(report.findings.includes("destination-storage-unverified"));
    const wire = JSON.stringify(decodeMigrationAssessmentState(current));
    for (const value of ["PRIVATE_", a.profile]) assert.equal(wire.includes(value), false);
    assert.deepEqual(await Promise.all(protectedFiles.map(hash)), before);
    assert.equal(
      a.database.connection.prepare("SELECT count(*) AS total FROM projection_routine_runs").get()?.total,
      0,
    );
  });
  await check("restart-reloads-immutable-linked-record-with-identical-id-and-plan-binding", async () => {
    assert.deepEqual(await Effect.runPromise(a.service().getState()), current);
    const path = join(a.profile, "openbot-migration-assessments-v1", input.planId, "1.json");
    const envelope = JSON.parse(await readFile(path, "utf8"));
    assert.ok(envelope.reportJson);
    assert.equal(JSON.stringify(envelope).includes("PRIVATE_"), false);
  });
  await check("stale-revision-refuses-before-inventory-and-preserves-all-saved-bytes", async () => {
    const reads = a.reads();
    const path = join(a.profile, "openbot-migration-assessments-v1", input.planId, "1.json");
    const saved = await hash(path);
    await refused(a.service().assess(input), "revision-conflict");
    assert.equal(a.reads(), reads);
    assert.equal(await hash(path), saved);
  });
  await check("declared-version-schema-platform-root-and-persistence-gaps-are-explicit", async () => {
    const next = await Effect.runPromise(
      a.service().assess({
        ...input,
        expectedAssessmentRevision: 1,
        destination: declared({
          appVersion: "9.0.0",
          schemaVersion: 50,
          platform: "win32",
          architecture: "arm64",
          dataRoot: "external",
          persistence: "ephemeral",
        }),
      }),
    );
    assert.equal(next.assessment?.comparison, "declared-mismatch");
    for (const code of [
      "destination-version-mismatch",
      "destination-schema-mismatch",
      "destination-platform-unsupported",
      "external-root-mapping-required",
      "destination-storage-ephemeral",
    ])
      assert.ok(next.assessment?.findings.some((finding) => finding === code));
    current = next;
  });
  await check("undeclared-facts-remain-insufficient-and-do-not-change-destination-trust", async () => {
    current = await Effect.runPromise(
      a.service().assess({
        ...input,
        expectedAssessmentRevision: 2,
        destination: declared({
          platform: "unknown",
          architecture: "unknown",
          appVersion: null,
          schemaVersion: null,
          executor: "unknown",
          dataRoot: "unspecified",
          persistence: "unknown",
        }),
      }),
    );
    assert.equal(current.assessment?.comparison, "insufficient-info");
    assert.equal(current.assessment?.destinationVerified, false);
    assert.ok(current.assessment?.findings.includes("destination-executor-undeclared"));
  });
  await check("confined-workspace-agents-block-declared-linux-without-changing-access", async () => {
    const f = await fixture(true);
    const p = await Effect.runPromise(f.preparation.prepare({ destinationKind: "docker-host", expectedRevision: 0 }));
    assert.ok(p.plan);
    const dataBefore = await hash(`${f.database.path}-wal`);
    const report = (
      await Effect.runPromise(
        f.service().assess({
          planId: p.plan.id,
          expectedPreparationRevision: 1,
          expectedAssessmentRevision: 0,
          destination: declared({ platform: "linux", architecture: "x64", executor: "container" }),
        }),
      )
    ).assessment;
    assert.ok(report);
    assert.equal(report.inventory.liveState.confinedProcessAgents, 1);
    assert.equal(report.comparison, "declared-mismatch");
    assert.ok(report.findings.includes("workspace-isolation-unsupported"));
    assert.equal(await hash(`${f.database.path}-wal`), dataBefore);
  });
  await check("inventory-failure-and-defect-never-append-or-expose-causes", async () => {
    for (const defect of [false, true]) {
      const service = new MigrationAssessmentService({
        userDataPath: a.profile,
        preparation: a.preparation,
        readSource: a.source,
        now: () => now,
        readInventory: () =>
          defect
            ? Effect.die(new Error(`PRIVATE_TOKEN ${a.profile}`))
            : Effect.fail(new MigrationAssessmentInventoryFailure({ code: "unavailable" })),
      });
      await refused(service.assess({ ...input, expectedAssessmentRevision: 3 }), "inventory-unavailable");
      assert.deepEqual(await Effect.runPromise(a.service().getState()), current);
    }
  });
  await check("preparation-change-during-observation-refuses-publication-and-retains-stale-report", async () => {
    const reached = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const service = new MigrationAssessmentService({
      userDataPath: a.profile,
      preparation: a.preparation,
      readSource: a.source,
      now: () => now,
      readInventory: () =>
        Effect.gen(function* () {
          const inventory = yield* a.inventory();
          yield* Deferred.succeed(reached, undefined);
          yield* Deferred.await(release);
          return inventory;
        }),
    });
    const pending = Effect.runPromise(Effect.result(service.assess({ ...input, expectedAssessmentRevision: 3 })));
    await Effect.runPromise(Deferred.await(reached));
    await Effect.runPromise(a.preparation.cancel({ planId: input.planId, expectedRevision: 1 }));
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const outcome = await pending;
    assert.ok(Result.isFailure(outcome));
    assert.equal(outcome.failure.code, "preparation-changed");
    const state = await Effect.runPromise(a.service().getState());
    assert.equal(state.revision, 3);
    assert.equal(state.applicability, "stale");
    assert.deepEqual(state.assessment, current.assessment);
  });
  await check("replacement-plan-starts-separate-history-without-deleting-old-records", async () => {
    const replacement = await Effect.runPromise(
      a.preparation.prepare({ destinationKind: "local-desktop", expectedRevision: 2 }),
    );
    assert.ok(replacement.plan);
    const state = await Effect.runPromise(a.service().getState());
    assert.equal(state.preparation?.planId, replacement.plan.id);
    assert.equal(state.revision, 0);
    assert.equal(state.assessment, null);
    assert.ok((await readdir(join(a.profile, "openbot-migration-assessments-v1", input.planId))).includes("3.json"));
  });
  await check("unknown-root-symlink-refuses-without-following-or-modifying-target", async () => {
    const f = await fixture();
    const p = await Effect.runPromise(f.preparation.prepare({ destinationKind: "other-server", expectedRevision: 0 }));
    assert.ok(p.plan);
    const outside = join(base, randomUUID());
    await mkdir(outside, { mode: 0o700 });
    await writeFile(join(outside, "sentinel"), "untouched");
    await symlink(outside, join(f.profile, "openbot-migration-assessments-v1"));
    await refused(f.service().getState(), "journal-invalid");
    assert.equal(await readFile(join(outside, "sentinel"), "utf8"), "untouched");
    assert.deepEqual(await readdir(outside), ["sentinel"]);
  });
  await check("bom-prefixed-record-refuses-without-reset-or-cleanup", async () => {
    const f = await fixture();
    const p = await Effect.runPromise(f.preparation.prepare({ destinationKind: "other-server", expectedRevision: 0 }));
    assert.ok(p.plan);
    await Effect.runPromise(
      f.service().assess({
        planId: p.plan.id,
        expectedPreparationRevision: 1,
        expectedAssessmentRevision: 0,
        destination: declared(),
      }),
    );
    const path = join(f.profile, "openbot-migration-assessments-v1", p.plan.id, "1.json");
    const tampered = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(path)]);
    await writeFile(path, tampered);
    await refused(f.service().getState(), "journal-invalid");
    assert.deepEqual(await readFile(path), tampered);
  });
  await check("history-limit-preserves-32-immutable-reports-and-refuses-before-inventory", async () => {
    const f = await fixture();
    const p = await Effect.runPromise(f.preparation.prepare({ destinationKind: "other-server", expectedRevision: 0 }));
    assert.ok(p.plan);
    const request = {
      planId: p.plan.id,
      expectedPreparationRevision: 1,
      expectedAssessmentRevision: 0,
      destination: declared(),
    };
    await Effect.runPromise(f.service().assess(request));
    const firstPath = join(f.profile, "openbot-migration-assessments-v1", p.plan.id, "1.json");
    const firstHash = await hash(firstPath);
    for (let revision = 1; revision < 32; revision++)
      await Effect.runPromise(f.service().assess({ ...request, expectedAssessmentRevision: revision }));
    assert.equal((await Effect.runPromise(f.service().getState())).revision, 32);
    const reads = f.reads();
    await refused(f.service().assess({ ...request, expectedAssessmentRevision: 32 }), "assessment-limit");
    assert.equal(f.reads(), reads);
    assert.equal(await hash(firstPath), firstHash);
  });
  await check("noncanonical-host-version-is-unknown-and-unsupported-host-platform-refuses", async () => {
    const source = await Effect.runPromise(
      readMigrationAssessmentSource({
        appVersion: () => "PRIVATE_INVALID_VERSION",
        platform: () => "darwin",
        architecture: () => "arm64",
      }),
    );
    assert.equal(source.appVersion, null);
    await refused(
      readMigrationAssessmentSource({
        appVersion: () => "1.2.3",
        platform: () => "freebsd",
        architecture: () => "x64",
      }),
      "source-unavailable",
    );
  });
  await check("windows-reads-and-writes-refuse-before-filesystem-or-service-ports", async () => {
    const storeUrl = pathToFileURL(resolve(import.meta.dirname, "../src/main/migration-assessment-store.ts")).href;
    const serviceUrl = pathToFileURL(resolve(import.meta.dirname, "../src/main/migration-assessment-service.ts")).href;
    const profile = join(base, "unopened-windows-profile");
    const input = {
      planId: randomUUID(),
      expectedPreparationRevision: 1,
      expectedAssessmentRevision: 0,
      destination: declared(),
    };
    const child = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { Effect, Result } from 'effect';
      const { MigrationAssessmentStore } = await import(${JSON.stringify(storeUrl)});
      const { MigrationAssessmentService } = await import(${JSON.stringify(serviceUrl)});
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const calls = { filesystem: 0, preparation: 0, source: 0, inventory: 0 };
      for (const name of ['lstatSync', 'openSync', 'mkdirSync', 'opendirSync']) {
        fs[name] = () => { calls.filesystem++; throw new Error('Unexpected fixture access'); };
      }
      syncBuiltinESMExports();
      const unexpected = (port) => () => { calls[port]++; throw new Error('Unexpected fixture port'); };
      const store = new MigrationAssessmentStore(${JSON.stringify(profile)});
      const service = new MigrationAssessmentService({
        userDataPath: ${JSON.stringify(profile)},
        preparation: { getState: unexpected('preparation') },
        readSource: unexpected('source'), readInventory: unexpected('inventory')
      });
      const input = ${JSON.stringify(input)};
      for (const operation of [store.read(input.planId), service.getState(), service.assess(input)]) {
        const result = await Effect.runPromise(Effect.result(operation));
        assert.ok(Result.isFailure(result));
        assert.equal(result.failure.code, 'unsupported-platform');
      }
      assert.deepEqual(calls, { filesystem: 0, preparation: 0, source: 0, inventory: 0 });
      process.stdout.write('windows-zero-access');
    `;
    assert.equal(
      execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", child], {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 4096,
      }),
      "windows-zero-access",
    );
  });
} catch {
  groups.push({ name: "fixture-setup", passed: false });
} finally {
  for (const database of databases) database.close();
  await rm(base, { recursive: true, force: true });
  const report = {
    passed: groups.length === 15 && groups.every((group) => group.passed),
    groups,
    realDataRead: false,
    credentialsRead: false,
    destinationContacted: false,
    inventoryComplete: false,
    destinationVerified: false,
    exportAvailable: false,
    restoreAvailable: false,
    activationAvailable: false,
  };
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!report.passed) process.exitCode = 1;
}
