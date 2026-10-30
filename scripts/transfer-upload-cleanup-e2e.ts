// Run: bun scripts/transfer-upload-cleanup-e2e.ts
// Report: .openbot-build/transfer-upload-cleanup-e2e.json

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_MANIFEST,
  INSTANCE_TRANSFER_VERSION,
} from "../src/main/instance-transfer-manifest";
import { type InstanceTransferOptions, InstanceTransferService } from "../src/main/instance-transfer-service";
import { LocalSkillFailure } from "../src/main/local-skill-library";
import { SkillMarketplaceFailure } from "../src/main/skill-marketplace-service";

const run = Effect.runPromise;
const exportInput = { agentIds: [], includeFiles: false, includeSettings: false };
const manifest = {
  format: INSTANCE_TRANSFER_FORMAT,
  version: INSTANCE_TRANSFER_VERSION,
  source: { appVersion: "e2e", exportedAt: "2026-10-14T00:00:00.000Z" },
  agents: [],
  settings: { mcpServers: [], customProviders: [], customAgents: [], sidebarSections: [], routineFlows: [] },
  shared: null,
  signedIn: [],
};
const bytes = zipSync({ [INSTANCE_TRANSFER_MANIFEST]: strToU8(JSON.stringify(manifest)) });
// Empty exports omit settings and cannot be imported. Check their wire manifest too.
const decodeArchiveManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      format: Schema.Literal(INSTANCE_TRANSFER_FORMAT),
      version: Schema.Literal(INSTANCE_TRANSFER_VERSION),
      source: Schema.Struct({ appVersion: Schema.Literal("e2e"), exportedAt: Schema.String }),
      agents: Schema.Array(Schema.Never),
      settings: Schema.NullOr(
        Schema.Struct({
          mcpServers: Schema.Array(Schema.Never),
          customProviders: Schema.Array(Schema.Never),
          customAgents: Schema.Array(Schema.Never),
          sidebarSections: Schema.Array(Schema.Never),
          routineFlows: Schema.Array(Schema.Never),
        }),
      ),
      shared: Schema.Null,
      signedIn: Schema.Array(Schema.Never),
    }),
  ),
);

function unexpected(operation: string): Error {
  return new Error(`Unexpected boundary call: ${operation}`);
}

function service(uploadDirectory: string): InstanceTransferService {
  // These checks transfer an empty instance. Other boundary calls must fail.
  const agents: InstanceTransferOptions["agents"] = {
    listAgents: () => [],
    listRoutines: (_agentId) => {
      throw unexpected("listRoutines");
    },
    listMemories: (_agentId) => {
      throw unexpected("listMemories");
    },
    getMemorySelection: (_agentId) => {
      throw unexpected("getMemorySelection");
    },
    setMemoryInclusion: (_input) => {
      throw unexpected("setMemoryInclusion");
    },
    resolveAvatar: (_agentId) => {
      throw unexpected("resolveAvatar");
    },
    listModels: () => {
      throw unexpected("listModels");
    },
    createAgentProfile: (_input) => Effect.fail(unexpected("createAgentProfile")),
    updateAgent: (_input) => Effect.fail(unexpected("updateAgent")),
    createRoutine: (_input, _options) => {
      throw unexpected("createRoutine");
    },
    createMemory: (_input) => {
      throw unexpected("createMemory");
    },
    memoryLimit: () => {
      throw unexpected("memoryLimit");
    },
    initializeMemorySelection: (_agentId) => {
      throw unexpected("initializeMemorySelection");
    },
    setAvatar: (_agentId, _image) => Effect.fail(unexpected("setAvatar")),
    deleteAgent: (_agentId) => Effect.fail(unexpected("deleteAgent")),
  };
  const library: ReturnType<InstanceTransferOptions["skills"]["library"]> = {
    list: () => Effect.fail(new LocalSkillFailure({ cause: unexpected("library.list") })),
    create: (_agentId, _folder) => Effect.fail(new LocalSkillFailure({ cause: unexpected("library.create") })),
    revise: (_agentId, _id, _revision, _folder) =>
      Effect.fail(new LocalSkillFailure({ cause: unexpected("library.revise") })),
    withdraw: (_id, _revision) => Effect.fail(new LocalSkillFailure({ cause: unexpected("library.withdraw") })),
  };
  const skills: InstanceTransferOptions["skills"] = {
    library: () => library,
    installLocal: (_input) => Effect.fail(new SkillMarketplaceFailure({ cause: unexpected("installLocal") })),
  };
  const settings: InstanceTransferOptions["settings"] = {
    mcpServers: () => {
      throw unexpected("mcpServers");
    },
    saveMcpServer: (_config) => Effect.fail(unexpected("saveMcpServer")),
    customProviders: () => {
      throw unexpected("customProviders");
    },
    saveCustomProvider: (_input) => Effect.fail(unexpected("saveCustomProvider")),
    customAgents: () => Effect.fail(unexpected("customAgents")),
    providersOff: () => {
      throw unexpected("providersOff");
    },
    sidebar: () => {
      throw unexpected("sidebar");
    },
    mutateSidebar: (_action) => Effect.fail(unexpected("mutateSidebar")),
    routineFlowLinks: (_agentId) => Effect.fail(unexpected("routineFlowLinks")),
    connectRoutineFlow: (_input) => Effect.fail(unexpected("connectRoutineFlow")),
    signedInProviders: () => [],
  };
  const options: InstanceTransferOptions = {
    uploadDirectory,
    sharedRoot: join(dirname(uploadDirectory), "shared"),
    appVersion: "e2e",
    agents,
    skills,
    settings,
    timezone: () => "UTC",
  };
  return new InstanceTransferService(options);
}

async function names(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

async function verifyArchives(directory: string, expected: number): Promise<string[]> {
  const files = await names(directory);
  assert.equal(files.length, expected);
  for (const file of files) {
    const archive = unzipSync(await readFile(join(directory, file)));
    const manifestBytes = archive[INSTANCE_TRANSFER_MANIFEST];
    assert.ok(manifestBytes, `Missing manifest: ${file}`);
    const value = decodeArchiveManifest(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    assert.ok(Number.isFinite(Date.parse(value.source.exportedAt)), `Invalid export date: ${file}`);
  }
  return files;
}

async function seed(directory: string): Promise<string[]> {
  const previous = service(directory);
  await run(previous.stageUpload(async () => bytes, "previous-owner"));
  await run(previous.exportForMember(exportInput));
  await writeFile(join(directory, "interrupted.zip.part"), bytes);
  return names(directory);
}

async function restart(directory: string): Promise<string[]> {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "--seed", directory],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const orphans = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(child.stdout);
  assert.equal(orphans.length, 3);
  return [...orphans];
}

async function checkRestart(root: string, firstWriter: "upload" | "export"): Promise<void> {
  const directory = join(root, firstWriter, "instance-transfer-uploads");
  const orphans = await restart(directory);
  const current = service(directory);
  let exported: string | undefined;
  if (firstWriter === "export") exported = await run(current.exportForMember(exportInput));
  const [alice, bob] = await Promise.all([
    run(current.stageUpload(async () => bytes, "alice")),
    run(current.stageUpload(async () => bytes, "bob")),
  ]);
  for (const orphan of orphans) {
    await assert.rejects(readFile(join(directory, orphan)), { code: "ENOENT" }, `Old file remains: ${orphan}`);
  }
  if (!exported) exported = await run(current.exportForMember(exportInput));
  await verifyArchives(directory, 3);
  const before = await names(directory);
  await run(current.discard(alice.token, "bob"));
  await assert.rejects(run(current.apply({ token: alice.token, keys: [], includeSettings: false }, "bob")));
  assert.deepEqual(await names(directory), before);
  await run(current.discard(alice.token, "alice"));
  await verifyArchives(directory, 2);
  const result = await run(current.apply({ token: bob.token, keys: [], includeSettings: false }, "bob"));
  assert.deepEqual(result.agents, []);
  assert.deepEqual(await names(directory), [exported.slice(directory.length + 1)]);
  await assert.rejects(run(current.apply({ token: bob.token, keys: [], includeSettings: false }, "bob")));
  await rm(exported);
}

async function checkConcurrent(root: string): Promise<void> {
  const directory = join(root, "concurrent", "instance-transfer-uploads");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "old.zip"), bytes);
  const current = service(directory);
  const [alice, exported, bob] = await Promise.all([
    run(current.stageUpload(async () => bytes, "alice")),
    run(current.exportForMember(exportInput)),
    run(current.stageUpload(async () => bytes, "bob")),
  ]);
  await verifyArchives(directory, 3);
  await assert.rejects(readFile(join(directory, "old.zip")), { code: "ENOENT" });
  await Promise.all([
    run(current.apply({ token: alice.token, keys: [], includeSettings: false }, "alice")),
    run(current.apply({ token: bob.token, keys: [], includeSettings: false }, "bob")),
  ]);
  await readFile(exported);
  await rm(exported);
}

async function checkRetry(root: string): Promise<void> {
  const blocker = join(root, "blocked");
  const directory = join(blocker, "instance-transfer-uploads");
  await writeFile(blocker, "A file blocks the parent directory.");
  const current = service(directory);
  const failed = await Promise.allSettled([
    run(current.stageUpload(async () => bytes, "alice")),
    run(current.exportForMember(exportInput)),
  ]);
  assert.ok(failed.every((result) => result.status === "rejected"));
  await rm(blocker);
  const preview = await run(current.stageUpload(async () => bytes, "alice"));
  await verifyArchives(directory, 1);
  await run(current.discard(preview.token, "alice"));
  assert.deepEqual(await names(directory), []);
}

async function checkLocal(root: string): Promise<void> {
  const path = join(root, "user-owned.zip");
  await writeFile(path, bytes);
  const current = service(join(root, "local", "instance-transfer-uploads"));
  const local = await run(current.stage(path));
  const uploaded = await run(current.stageUpload(async () => bytes, "alice"));
  await run(current.discard(local.token));
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
  await assert.rejects(run(current.stageUpload(async () => new Uint8Array([1, 2, 3]), "alice")));
  await verifyArchives(join(root, "local", "instance-transfer-uploads"), 1);
  await run(current.apply({ token: uploaded.token, keys: [], includeSettings: false }, "alice"));
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
}

interface Report {
  status: "running" | "passed" | "failed";
  checks: Array<{ name: string; status: "passed" | "failed" }>;
  error?: string;
}

if (process.argv[2] === "--seed") {
  const directory = process.argv[3];
  assert.ok(directory, "The seed directory is required.");
  process.stdout.write(JSON.stringify(await seed(directory)));
} else {
  const reportPath = fileURLToPath(new URL("../.openbot-build/transfer-upload-cleanup-e2e.json", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "transfer-upload-cleanup-"));
  const report: Report = { status: "running", checks: [] };
  let activeCheck: string | undefined;
  try {
    const checks: Array<[string, () => Promise<void>]> = [
      ["restart-upload-first", () => checkRestart(root, "upload")],
      ["restart-export-first", () => checkRestart(root, "export")],
      ["concurrent-writers", () => checkConcurrent(root)],
      ["preparation-retry", () => checkRetry(root)],
      ["local-file-and-invalid-upload", () => checkLocal(root)],
    ];
    for (const [name, check] of checks) {
      activeCheck = name;
      await check();
      report.checks.push({ name, status: "passed" });
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    if (activeCheck) report.checks.push({ name: activeCheck, status: "failed" });
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}
