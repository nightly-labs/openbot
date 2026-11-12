// Run: bun scripts/agent-import-large-e2e.ts
// Report: .openbot-build/agent-import-large-e2e.json
//
// Imports Grok Bot exports that real zip tools write in the ZIP64 format through the real
// AgentImportService and local skill library: Info-ZIP `zip -fz`, and Python `zipfile` with more than
// 65,535 entries and with an entry over 4 GiB. It checks that the files arrive unchanged, that a large
// file streams to disk instead of into memory, that an agent whose files do not fit on the disk is
// skipped, that a replaced export is refused, and that a damaged entry is skipped with a warning.
// Needs `python3` and `zip` on PATH. It writes about 1 GB of temporary files and removes them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { type AgentImportAgents, AgentImportService } from "../src/main/agent-import-service";
import { LocalSkillLibrary } from "../src/main/local-skill-library";

const run = Effect.runPromise;
const root = await mkdtemp(join(tmpdir(), "openbot-import-large-"));
const reportPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".openbot-build", "agent-import-large-e2e.json");
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const MANY_FILES = 70_000;
const HUGE_BYTES = 4.5 * GiB;
const BIG_BYTES = 600 * MiB;

interface Report {
  status: "running" | "pass" | "fail";
  infoZip?: {
    zip64End: boolean;
    files: number;
    skill: string | null;
    previewWarnings: string[];
    warnings: string[];
  };
  manyEntries?: { zip64End: boolean; previewFiles: number; written: number; seconds: number };
  hugeEntry?: { zipBytes: number; previewBytes: number; skipped: string | null; deleted: number };
  bigEntry?: { fileBytes: number; rssGrowthMiB: number };
  changedExport?: string;
  damagedEntry?: { imported: boolean; warnings: string[] };
  wrongCount?: { endRecordCount: number; written: number };
  brokenDeflate?: string[];
  reason?: string;
}
const report: Report = { status: "running" };

const agents: AgentSummary[] = [];
const deleted: string[] = [];

function agentSummary(id: string, name: string): AgentSummary {
  return {
    id,
    name,
    title: "",
    description: "",
    notifications: false,
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, "agents", id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

const agentBoundary: AgentImportAgents = {
  listAgents: () => agents,
  createAgentProfile: (input) =>
    Effect.promise(async () => {
      const created = agentSummary(`agent-${agents.length + 1}`, input.name);
      await mkdir(created.workspacePath, { recursive: true });
      agents.push(created);
      return created;
    }),
  createRoutine: () => {
    throw new Error("The export has no routines.");
  },
  createMemory: () => undefined,
  memoryLimit: () => 50,
  initializeMemorySelection: () => undefined,
  setAvatar: () => Effect.die("The export has no avatars."),
  deleteAgent: (agentId) =>
    Effect.sync(() => {
      deleted.push(agentId);
      agents.splice(
        agents.findIndex((agent) => agent.id === agentId),
        1,
      );
    }),
  channels: { command: () => Effect.die("The export has no group chats.") },
  createChannelMemory: () => undefined,
  createChannelRoutine: () => undefined,
  deleteChannel: () => Effect.die("The export has no group chats."),
};

const library = new LocalSkillLibrary(join(root, "local-skills"), () => agents);
function service(freeDiskBytes?: (path: string) => Effect.Effect<number | null>): AgentImportService {
  return new AgentImportService(
    agentBoundary,
    { library: () => library, installLocal: () => Effect.void },
    () => ({ id: "local", name: "Local" }),
    () => "UTC",
    null,
    freeDiskBytes,
  );
}

function manifest(key: string, options: { skill?: boolean } = {}): string {
  return JSON.stringify({
    format: "openbot-agent-import",
    version: 1,
    source: { app: "grok-bot", exportedAt: "2026-11-09T10:00:00Z" },
    agents: [
      {
        key,
        name: `Agent ${key}`,
        title: "",
        description: "You test large imports.",
        avatar: null,
        skills: options.skill ? [`agents/${key}/skills/notes`] : [],
        routines: [],
        memories: ["The user moves agents from Grok Bot."],
        files: `agents/${key}/files`,
      },
    ],
  });
}

/** Runs Python with the script on stdin, so nothing in the export folders can load as a module. */
function python(script: string, ...args: string[]): void {
  const result = spawnSync("python3", ["-I", "-", ...args], { input: script, encoding: "utf8" });
  assert.equal(result.status, 0, `python3 failed: ${result.stderr}`);
}

async function hasZip64End(path: string): Promise<boolean> {
  const { size } = await stat(path);
  const handle = await open(path, "r");
  try {
    const length = Math.min(size, 128 * 1024);
    const tail = Buffer.alloc(length);
    await handle.read(tail, 0, length, size - length);
    return tail.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  } finally {
    await handle.close();
  }
}

async function tree(folder: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.set(relative(folder, path), await readFile(path));
    }
  };
  await visit(folder);
  return files;
}

async function countFiles(folder: string) {
  return (await readdir(folder, { withFileTypes: true, recursive: true })).filter((entry) => entry.isFile()).length;
}

function importedFolder(agentId: string | undefined): string {
  const agent = agents.find((candidate) => candidate.id === agentId);
  assert.ok(agent, "The import creates the agent.");
  return join(agent.workspacePath, "imported");
}

try {
  // 1. Info-ZIP with -fz: the ZIP64 extra field holds only the compressed size, and a ZIP64 end record.
  const source = join(root, "source-fz");
  const files = join(source, "agents/alpha/files");
  await mkdir(join(files, "notes/deep"), { recursive: true });
  await mkdir(join(source, "agents/alpha/skills/notes"), { recursive: true });
  await writeFile(join(source, "openbot-import.json"), manifest("alpha", { skill: true }));
  await writeFile(
    join(source, "agents/alpha/skills/notes/SKILL.md"),
    "---\nname: notes\ndescription: Keep notes.\n---\nKeep short notes.\n",
  );
  await writeFile(join(files, "notes/plan.md"), "# Plan\n\nMove every agent.\n");
  await writeFile(join(files, "notes/deep/empty.txt"), "");
  await writeFile(join(files, "random.bin"), randomBytes(3 * MiB));
  await writeFile(join(files, "run.sh"), "#!/bin/sh\necho ok\n");
  await chmod(join(files, "run.sh"), 0o755);
  const expected = await tree(files);
  // A tool makes these again: the import leaves them out with one warning, and keeps the rest.
  await mkdir(join(files, "node_modules/pkg"), { recursive: true });
  await writeFile(join(files, "node_modules/pkg/index.js"), "module.exports = 1;\n");
  await mkdir(join(files, ".git"), { recursive: true });
  await writeFile(join(files, ".git/HEAD"), "ref: refs/heads/main\n");
  await mkdir(join(source, "agents/alpha/skills/notes/node_modules"), { recursive: true });
  await writeFile(join(source, "agents/alpha/skills/notes/node_modules/x.js"), "export {};\n");
  const infoZip = join(root, "export-fz.zip");
  const zipped = spawnSync("zip", ["-q", "-r", "-fz", infoZip, "."], { cwd: source, encoding: "utf8" });
  assert.equal(zipped.status, 0, `zip failed: ${zipped.stderr}`);
  const local = service();
  const preview = await run(local.stage(infoZip));
  assert.equal(preview.agents[0]?.fileCount, 4);
  assert.deepEqual(preview.warnings, [sourceText("error.import.foldersSkipped", { number: 3 })]);
  const result = await run(local.apply({ token: preview.token, keys: ["alpha"], channelKeys: [] }));
  const written = await tree(importedFolder(result.agents[0]?.id));
  assert.deepEqual(written, expected, "The files arrive unchanged, without .git and node_modules.");
  const skill = (await run(library.list())).find((candidate) => candidate.slug === "notes");
  report.infoZip = {
    zip64End: await hasZip64End(infoZip),
    files: written.size,
    skill: skill?.slug ?? null,
    previewWarnings: preview.warnings,
    warnings: result.warnings,
  };
  assert.ok(report.infoZip.zip64End, "zip -fz writes a ZIP64 end record.");
  assert.ok(skill, "The skill is published to the library.");
  assert.deepEqual(result.warnings, []);

  // 2. Python zipfile with more than 65,535 entries: only the ZIP64 end record has the count.
  const many = join(root, "export-many.zip");
  python(
    `import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("openbot-import.json", sys.argv[2])
    for i in range(int(sys.argv[3])):
        z.writestr(f"agents/many/files/part-{i // 1000:03}/{i:05}.txt", f"file {i}\\n")
`,
    many,
    manifest("many"),
    String(MANY_FILES),
  );
  const started = performance.now();
  const manyPreview = await run(local.stage(many));
  const manyResult = await run(local.apply({ token: manyPreview.token, keys: ["many"], channelKeys: [] }));
  const manyFolder = importedFolder(manyResult.agents[0]?.id);
  report.manyEntries = {
    zip64End: await hasZip64End(many),
    previewFiles: manyPreview.agents[0]?.fileCount ?? 0,
    written: await countFiles(manyFolder),
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
  assert.ok(report.manyEntries.zip64End, "zipfile writes a ZIP64 end record above 65,535 entries.");
  assert.equal(report.manyEntries.previewFiles, MANY_FILES);
  assert.equal(report.manyEntries.written, MANY_FILES);
  assert.equal(await readFile(join(manyFolder, "part-069/69999.txt"), "utf8"), "file 69999\n");

  // 3. An entry over 4 GiB, from the ZIP64 extra field. The disk reports 1 GiB free, so the agent
  //    is skipped and removed before any file is written.
  const huge = join(root, "export-huge.zip");
  python(
    `import sys, zipfile
chunk = bytes(64 * 1024 * 1024)
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("openbot-import.json", sys.argv[2])
    with z.open("agents/huge/files/disk.img", "w", force_zip64=True) as f:
        left = int(sys.argv[3])
        while left:
            f.write(chunk[: min(left, len(chunk))])
            left -= min(left, len(chunk))
`,
    huge,
    manifest("huge"),
    String(HUGE_BYTES),
  );
  const small = service(() => Effect.succeed(GiB));
  const hugePreview = await run(small.stage(huge));
  const hugeResult = await run(small.apply({ token: hugePreview.token, keys: ["huge"], channelKeys: [] }));
  report.hugeEntry = {
    zipBytes: (await stat(huge)).size,
    previewBytes: hugePreview.agents[0]?.fileBytes ?? 0,
    skipped: hugeResult.skipped[0]?.reason ?? null,
    deleted: deleted.length,
  };
  assert.equal(report.hugeEntry.previewBytes, HUGE_BYTES);
  assert.equal(
    report.hugeEntry.skipped,
    sourceText("error.import.diskSpace", { name: "Agent huge", size: "4.5", free: "1.0" }),
  );
  assert.equal(hugeResult.agents.length, 0);
  assert.equal(deleted.length, 1, "The skipped agent is deleted.");

  // 4. A 600 MiB file streams to disk: memory grows much less than the file.
  const big = join(root, "export-big.zip");
  python(
    `import sys, zipfile
chunk = bytes(64 * 1024 * 1024)
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("openbot-import.json", sys.argv[2])
    with z.open("agents/big/files/big.img", "w") as f:
        left = int(sys.argv[3])
        while left:
            f.write(chunk[: min(left, len(chunk))])
            left -= min(left, len(chunk))
`,
    big,
    manifest("big"),
    String(BIG_BYTES),
  );
  const before = process.memoryUsage().rss;
  let peak = before;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 20);
  const bigPreview = await run(local.stage(big));
  const bigResult = await run(local.apply({ token: bigPreview.token, keys: ["big"], channelKeys: [] }));
  clearInterval(sampler);
  report.bigEntry = {
    fileBytes: (await stat(join(importedFolder(bigResult.agents[0]?.id), "big.img"))).size,
    rssGrowthMiB: Math.round((peak - before) / MiB),
  };
  assert.equal(report.bigEntry.fileBytes, BIG_BYTES);
  assert.ok(report.bigEntry.rssGrowthMiB < 200, "The file is not read into memory.");

  // 5. An export replaced after the preview is refused.
  const changed = join(root, "export-changed.zip");
  await copyFile(infoZip, changed);
  const changedPreview = await run(local.stage(changed));
  await copyFile(many, changed);
  const changedError = await run(
    Effect.flip(local.apply({ token: changedPreview.token, keys: ["alpha"], channelKeys: [] })),
  );
  const changedMessage = changedError.cause instanceof Error ? changedError.cause.message : "No message.";
  report.changedExport = changedMessage;
  assert.equal(changedMessage, sourceText("error.import.exportChanged"));

  // 6. A damaged entry fails its CRC check: that file is skipped, and the agent still imports.
  const damaged = join(root, "export-damaged.zip");
  await copyFile(infoZip, damaged);
  python(
    `import sys, zipfile
info = zipfile.ZipFile(sys.argv[1]).getinfo("agents/alpha/files/random.bin")
with open(sys.argv[1], "r+b") as f:
    f.seek(info.header_offset + 26)
    name, extra = int.from_bytes(f.read(2), "little"), int.from_bytes(f.read(2), "little")
    f.seek(info.header_offset + 30 + name + extra + 1000)
    byte = f.read(1)
    f.seek(-1, 1)
    f.write(bytes([byte[0] ^ 0xFF]))
`,
    damaged,
  );
  const damagedPreview = await run(local.stage(damaged));
  const damagedResult = await run(local.apply({ token: damagedPreview.token, keys: ["alpha"], channelKeys: [] }));
  const damagedFiles = await tree(importedFolder(damagedResult.agents[0]?.id));
  report.damagedEntry = { imported: damagedResult.agents.length === 1, warnings: damagedResult.warnings };
  assert.ok(report.damagedEntry.imported);
  assert.equal(damagedFiles.has("random.bin"), false, "The damaged file is not left on disk.");
  assert.equal(damagedFiles.get("notes/plan.md")?.toString(), "# Plan\n\nMove every agent.\n");
  assert.deepEqual(damagedResult.warnings, [
    sourceText("error.import.fileSkipped", {
      name: "Agent alpha",
      file: "random.bin",
      reason: sourceText("error.import.entryDamaged"),
    }),
  ]);

  // 7. The end record says 1 entry, as a tool that keeps only the low 16 bits of a count can write.
  //    The reader uses the whole central directory, so all 3 files arrive.
  const counted = join(root, "export-count.zip");
  python(
    `import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("openbot-import.json", sys.argv[2])
    z.writestr("agents/count/files/a.txt", "a\\n")
    z.writestr("agents/count/files/b.txt", "b\\n")
data = bytearray(open(sys.argv[1], "rb").read())
end = data.rfind(b"PK\\x05\\x06")
data[end + 8:end + 12] = (1).to_bytes(2, "little") * 2
open(sys.argv[1], "wb").write(data)
`,
    counted,
    manifest("count"),
  );
  const countPreview = await run(local.stage(counted));
  const countResult = await run(local.apply({ token: countPreview.token, keys: ["count"], channelKeys: [] }));
  report.wrongCount = {
    endRecordCount: 1,
    written: await countFiles(importedFolder(countResult.agents[0]?.id)),
  };
  assert.equal(report.wrongCount.written, 2);

  // 8. A deflate stream with an invalid block type: zlib fails, and the warning is the catalog text.
  const broken = join(root, "export-broken.zip");
  python(
    `import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("openbot-import.json", sys.argv[2])
    z.writestr("agents/broken/files/text.txt", "OpenBot " * 10000)
    z.writestr("agents/broken/files/ok.txt", "ok\\n")
info = zipfile.ZipFile(sys.argv[1]).getinfo("agents/broken/files/text.txt")
with open(sys.argv[1], "r+b") as f:
    f.seek(info.header_offset + 26)
    name, extra = int.from_bytes(f.read(2), "little"), int.from_bytes(f.read(2), "little")
    f.seek(info.header_offset + 30 + name + extra)
    f.write(b"\\xff")
`,
    broken,
    manifest("broken"),
  );
  const brokenPreview = await run(local.stage(broken));
  const brokenResult = await run(local.apply({ token: brokenPreview.token, keys: ["broken"], channelKeys: [] }));
  report.brokenDeflate = brokenResult.warnings;
  assert.deepEqual(brokenResult.warnings, [
    sourceText("error.import.fileSkipped", {
      name: "Agent broken",
      file: "text.txt",
      reason: sourceText("error.import.entryDamaged"),
    }),
  ]);
  assert.equal(await readFile(join(importedFolder(brokenResult.agents[0]?.id), "ok.txt"), "utf8"), "ok\n");

  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.reason = error instanceof Error ? error.message : "An operation failed.";
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
