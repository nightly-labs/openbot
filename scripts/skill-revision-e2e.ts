// Run: bun run test:skill-revision
// Report: .openbot-build/skill-revision-e2e.json
// Drives the agent skill tools that create and revise a local skill through the real local skill
// library and installer, on temporary workspaces. Only the marketplace network boundary is a stub.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSummary, SkillConversationEvent } from "@openbot/contracts/ipc";
import { Effect, Exit, Schema } from "effect";
import { runLocalSkillTool } from "../src/backend/agent/skill-tools";
import { isMissingFileError } from "../src/backend/file-errors";
import { LocalSkillLibrary } from "../src/main/local-skill-library";
import { localSkillTools } from "../src/main/local-skill-tools";
import { SkillMarketplaceService } from "../src/main/skill-marketplace-service";

interface CaseReport {
  name: string;
  status: "pass" | "fail";
  reason?: string;
}

const report: {
  status: "running" | "pass" | "fail";
  cases: CaseReport[];
  events: SkillConversationEvent[];
} = { status: "running", cases: [], events: [] };

const decodeLock = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      skills: Schema.Record(
        Schema.String,
        Schema.Struct({ version: Schema.Number, files: Schema.Record(Schema.String, Schema.String) }),
      ),
    }),
  ),
);

const SLUG = "report-format";
const ROOTS = [".agents/skills", ".claude/skills"];
const skillFile = (body: string) =>
  `---\nname: ${SLUG}\ndescription: Write the weekly report in the user's format.\n---\n${body}\n`;
const V1 = skillFile("1. Collect the numbers.\n2. Write a long summary.");
const V2 = skillFile("1. Collect the numbers.\n2. Write three bullets, no summary.");
const V3 = skillFile("1. Collect the numbers from the CSV column `total_eur`.\n2. Write three bullets, no summary.");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function agent(id: string, workspacePath: string): AgentSummary {
  return {
    id,
    name: id,
    title: "",
    description: "",
    notifications: false,
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath,
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

async function writeSkill(workspace: string, folder: string, text: string): Promise<void> {
  const path = join(workspace, folder, "SKILL.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function installed(workspace: string): Promise<{ version: number; texts: string[] } | null> {
  const lock = decodeLock(await readFile(join(workspace, ".openbot/skills-lock.json"), "utf8"));
  const entry = Object.values(lock.skills)[0];
  if (!entry) return null;
  const texts = await Promise.all(ROOTS.map((root) => readFile(join(workspace, root, SLUG, "SKILL.md"), "utf8")));
  return { version: entry.version, texts };
}

async function main(): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "openbot-skill-revision-"));
  const callerWorkspace = join(base, "caller");
  const otherWorkspace = join(base, "other");
  await mkdir(callerWorkspace);
  await mkdir(otherWorkspace);
  const agents = [agent("caller", callerWorkspace), agent("other", otherWorkspace)];
  const library = new LocalSkillLibrary(join(base, "library"), () => agents);
  const network = () => Effect.die(new Error("A local skill must not use the marketplace."));
  const service = new SkillMarketplaceService(
    { requestAuthorized: network, downloadAuthorized: network, resolveApiUrl: (value) => value },
    () => agents,
    () => Effect.void,
    library,
  );
  const tools = localSkillTools(service);
  const run = (agentId: string, tool: string, args: unknown) =>
    Effect.runPromiseExit(
      runLocalSkillTool(
        tools,
        agentId,
        tool,
        args,
        (target) => target ?? agentId,
        (event) => report.events.push(event),
      ),
    );
  let skillId = "";

  async function scenario(name: string, check: () => Promise<void>): Promise<void> {
    try {
      await check();
      report.cases.push({ name, status: "pass" });
    } catch (error) {
      // Do not copy messages, stacks or values into the report.
      const reason = error instanceof assert.AssertionError ? "Assertion failed." : "An operation failed.";
      report.cases.push({ name, status: "fail", reason });
    }
  }

  try {
    await scenario("create installs revision 1 for the caller", async () => {
      await writeSkill(callerWorkspace, "drafts/v1", V1);
      const created = await run("caller", "create_skill", { sourcePath: "drafts/v1" });
      assert.ok(Exit.isSuccess(created));
      skillId = report.events.at(-1)?.skillId ?? "";
      assert.match(skillId, /^local-skill-/u);
      assert.deepEqual(await installed(callerWorkspace), { version: 1, texts: [V1, V1] });
      assert.ok(Exit.isSuccess(await run("caller", "install_local_skill", { agentId: "other", skillId, revision: 1 })));
      assert.deepEqual(await installed(otherWorkspace), { version: 1, texts: [V1, V1] });
    });

    await scenario("revise installs the new revision for the caller only", async () => {
      await writeSkill(callerWorkspace, "drafts/v2", V2);
      const before = report.events.length;
      const revised = await run("caller", "revise_skill", { skillId, expectedRevision: 1, sourcePath: "drafts/v2" });
      assert.ok(Exit.isSuccess(revised));
      // One "Revised skill" line, and no separate "Installed skill" line.
      assert.deepEqual(
        report.events.slice(before).map((event) => [event.action, event.revision]),
        [["revised", 2]],
      );
      assert.deepEqual(await installed(callerWorkspace), { version: 2, texts: [V2, V2] });
      assert.deepEqual(await installed(otherWorkspace), { version: 1, texts: [V1, V1] });
    });

    await scenario("revise from the agent's edited installed copy", async () => {
      await writeFile(join(callerWorkspace, ".agents/skills", SLUG, "SKILL.md"), V3);
      const revised = await run("caller", "revise_skill", {
        skillId,
        expectedRevision: 2,
        sourcePath: `.agents/skills/${SLUG}`,
      });
      assert.ok(Exit.isSuccess(revised));
      assert.deepEqual(await installed(callerWorkspace), { version: 3, texts: [V3, V3] });
    });

    await scenario("a user's edit of the installed copy is kept", async () => {
      const edited = `${V3}\nMy own note.\n`;
      await writeFile(join(callerWorkspace, ".claude/skills", SLUG, "SKILL.md"), edited);
      await writeSkill(callerWorkspace, "drafts/v4", V2);
      const revised = await run("caller", "revise_skill", { skillId, expectedRevision: 3, sourcePath: "drafts/v4" });
      assert.ok(Exit.isFailure(revised));
      assert.ok(String(revised.cause).includes("was saved as revision 4"));
      assert.equal((await Effect.runPromise(library.get(skillId))).version, 4);
      assert.equal(await readFile(join(callerWorkspace, ".claude/skills", SLUG, "SKILL.md"), "utf8"), edited);
      assert.equal(hash(await readFile(join(callerWorkspace, ".agents/skills", SLUG, "SKILL.md"), "utf8")), hash(V3));
    });

    await scenario("create quotes an unquoted colon in the frontmatter", async () => {
      const description = "Use when: the user asks for the monthly report";
      const draft = `---\nname: monthly-report\ndescription: ${description}\n---\nWrite it.\n`;
      await writeSkill(otherWorkspace, "drafts/colon", draft);
      const created = await run("other", "create_skill", { sourcePath: "drafts/colon" });
      assert.ok(Exit.isSuccess(created));
      const saved = await Effect.runPromise(library.get(report.events.at(-1)?.skillId ?? ""));
      assert.equal(saved.description, description);
      assert.equal(saved.instructions, "Write it.");
      // The draft in the workspace stays as the agent wrote it.
      assert.equal(await readFile(join(otherWorkspace, "drafts/colon/SKILL.md"), "utf8"), draft);
    });

    await scenario("create saves a name with no Latin letter", async () => {
      // A review writes the name in the user's language.
      const name = "月次レポート";
      await writeSkill(
        otherWorkspace,
        "drafts/japanese",
        `---\nname: ${name}\ndescription: 月次レポートを書く\n---\n書く。\n`,
      );
      const created = await run("other", "create_skill", { sourcePath: "drafts/japanese" });
      assert.ok(Exit.isSuccess(created));
      const saved = await Effect.runPromise(library.get(report.events.at(-1)?.skillId ?? ""));
      assert.equal(saved.name, name);
    });
  } finally {
    await rm(base, { recursive: true, force: true }).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }
  report.status = report.cases.every((item) => item.status === "pass") ? "pass" : "fail";
}

await main().catch(() => {
  report.status = "fail";
});
await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/skill-revision-e2e.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, cases: report.cases })}\n`);
process.exitCode = report.status === "pass" ? 0 : 1;
