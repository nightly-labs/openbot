import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { zipSync } from "fflate";
import { readSkillArchive } from "../src/main/skill-package";
import { emptyInstanceTransferService } from "./instance-transfer-e2e-fixture";

const run = Effect.runPromise;
const OUT = resolve(import.meta.dirname, "../.openbot-build/instance-transfer-skill-limit-e2e");
const FILE_LIMIT = 200;
const BYTE_LIMIT = 10 * 1024 * 1024;
const markdown = (name: string) =>
  new TextEncoder().encode(`---\nname: ${name}\ndescription: A skill with a large test corpus.\n---\nUse it.\n`);

const report: {
  checks: { name: string; passed: boolean; actual?: unknown }[];
  passed: boolean;
  error?: string;
} = { checks: [], passed: false };

function check(name: string, actual: unknown, expected: unknown): void {
  let passed = true;
  try {
    assert.deepEqual(actual, expected);
  } catch {
    passed = false;
  }
  report.checks.push({ name, passed, ...(passed ? {} : { actual }) });
}

function openArchive(bytes: Uint8Array): number | string {
  try {
    return Object.keys(readSkillArchive(bytes).files).length;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function agentSummary(root: string, id: string): AgentSummary {
  return {
    id,
    name: "Researcher",
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

async function transferSkipped(root: string, slug: string, corpus: (index: number) => Uint8Array) {
  const source = agentSummary(root, `agent-${slug}`);
  const folder = join(source.workspacePath, ".agents", "skills", slug);
  await mkdir(join(folder, "corpus"), { recursive: true });
  await writeFile(join(folder, "SKILL.md"), markdown(slug));
  for (let index = 0; index < FILE_LIMIT; index += 1)
    await writeFile(join(folder, "corpus", `case-${index}.txt`), corpus(index));
  const uploads = join(root, `uploads-${slug}`);
  await mkdir(uploads, { recursive: true });
  const file = join(root, `${slug}.zip`);
  await run(
    emptyInstanceTransferService(uploads, [source]).exportTo(file, {
      agentIds: [source.id],
      includeFiles: false,
      includeSettings: false,
    }),
  );
  const importer = emptyInstanceTransferService(uploads);
  const preview = await run(importer.stage(file));
  const result = await run(
    importer.apply({ token: preview.token, keys: preview.agents.map((agent) => agent.key), includeSettings: false }),
  );
  return { agents: result.agents.length, skipped: result.skipped.map(({ name, reason }) => ({ name, reason })) };
}

const tooManyFiles = sourceText("error.skill.tooManyFiles", { limit: FILE_LIMIT });
const skippedFor = (slug: string, reason = tooManyFiles) => ({
  agents: 0,
  skipped: [
    {
      name: "Researcher",
      reason: sourceText("error.import.transferSettingSkipped", { name: slug, reason }),
    },
  ],
});

const root = await mkdtemp(join(tmpdir(), "openbot-transfer-skill-limit-"));
try {
  check(
    "a transfer skips the agent of a 201-file skill and names the skill and the file limit",
    await transferSkipped(root, "big-corpus", (index) => new TextEncoder().encode(`case ${index}\n`)),
    skippedFor("big-corpus"),
  );
  const incompressible = Math.floor((BYTE_LIMIT - 4096) / FILE_LIMIT);
  check(
    "a transfer of a 201-file incompressible skill under 10 MB names the file limit",
    await transferSkipped(root, "random-corpus", () => randomBytes(incompressible)),
    skippedFor("random-corpus"),
  );
  check(
    "a transfer of a 201-file skill over 10 MB expanded names the expanded size limit",
    await transferSkipped(root, "huge-corpus", () => new Uint8Array(Math.ceil(BYTE_LIMIT / FILE_LIMIT) + 1)),
    skippedFor("huge-corpus", sourceText("error.skill.expandedTooLarge")),
  );

  const withFolders: Record<string, Uint8Array> = { "kit/": new Uint8Array(), "kit/corpus/": new Uint8Array() };
  withFolders["kit/SKILL.md"] = markdown("kit");
  for (let index = 1; index < FILE_LIMIT; index += 1) withFolders[`kit/corpus/case-${index}.txt`] = markdown("kit");
  check("a skill ZIP with 200 files and folder entries opens", openArchive(zipSync(withFolders)), FILE_LIMIT);
  check(
    "a skill ZIP over 10 MB expanded names the expanded size limit",
    openArchive(zipSync({ "SKILL.md": markdown("kit"), "data.bin": new Uint8Array(BYTE_LIMIT + 1) })),
    sourceText("error.skill.expandedTooLarge"),
  );
  check(
    "a damaged skill ZIP after a limit failure is still invalid",
    openArchive(randomBytes(512)),
    sourceText("error.skill.zipInvalid"),
  );
  report.passed = report.checks.every((entry) => entry.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
