// Run: bun scripts/skill-install-local-changes-e2e.ts
// Report: .openbot-build/skill-install-local-changes-e2e.json; exit 0 = all pass.
// Drives the real local skill library and skill service in a temporary workspace (#7072).
// A copy with no unsaved edits installs the next revision: a Finder `.DS_Store`, the text before a
// save put quotes in the frontmatter, or the files of a newer saved revision than the lock.
// A copy with an edit that no revision has still refuses, and the user's replace still installs.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import { LocalSkillLibrary } from "../src/main/local-skill-library";
import { localSkillTools } from "../src/main/local-skill-tools";
import { SkillMarketplaceService } from "../src/main/skill-marketplace-service";

const AGENT_ID = "agent-7072";
const REFUSED = sourceText("error.skill.replaceModified");

interface Context {
  workspace: string;
  library: LocalSkillLibrary;
  service: SkillMarketplaceService;
  tools: ReturnType<typeof localSkillTools>;
  skillId: string;
  slug: string;
}

function skillMarkdown(description: string, body: string): string {
  return `---\nname: Demo Skill\ndescription: ${description}\n---\n\n${body}\n`;
}

/** The message of a failed Effect, or null when it succeeded. */
async function failure<A, E extends { cause: unknown }>(effect: Effect.Effect<A, E>): Promise<string | null> {
  const result = await Effect.runPromise(Effect.result(effect));
  if (Result.isSuccess(result)) return null;
  const cause = result.failure.cause;
  return cause instanceof Error ? cause.message : String(cause);
}

async function installedState(context: Context): Promise<string> {
  const [skill] = await Effect.runPromise(context.service.listInstalled(AGENT_ID));
  assert.ok(skill, "The agent has the skill.");
  return `${skill.state}@${skill.installedVersion}`;
}

async function writeCopies(context: Context, file: string, text: string): Promise<void> {
  for (const folder of [".agents/skills", ".claude/skills"])
    await writeFile(join(context.workspace, folder, context.slug, file), text);
}

async function reviseFrom(context: Context, expectedRevision: number, sourcePath: string): Promise<string | null> {
  return failure(context.tools.revise({ agentId: AGENT_ID, skillId: context.skillId, expectedRevision, sourcePath }));
}

const report: Array<{ name: string; passed: boolean; result?: Record<string, string | null>; error?: string }> = [];

async function scenario(name: string, run: (context: Context) => Promise<Record<string, string | null>>) {
  const root = await mkdtemp(join(tmpdir(), "openbot-skill-7072-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "source"), { recursive: true });
    const agent: AgentSummary = {
      id: AGENT_ID,
      name: "Skill Agent",
      title: "",
      description: "",
      notifications: false,
      provider: "codex",
      model: "gpt-5",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: workspace,
      preview: "",
      updatedAt: null,
      avatarSeed: AGENT_ID,
      avatarHue: null,
      avatarUrl: null,
    };
    const agents = () => [agent];
    const library = new LocalSkillLibrary(join(root, "library"), agents);
    // A local skill never reaches the account service, so this one has no session.
    const auth = new CentralAuthManager({
      apiUrl: "https://example.invalid",
      storagePath: join(root, "auth.json"),
      canPersist: () => false,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    });
    const service = new SkillMarketplaceService(auth, agents, () => Effect.void, library);
    const tools = localSkillTools(service);
    await writeFile(join(workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 1."));
    const created = await Effect.runPromise(tools.create({ agentId: AGENT_ID, sourcePath: "source" }));
    const result = await run({ workspace, library, service, tools, skillId: created.id, slug: created.slug });
    report.push({ name, passed: true, result });
  } catch (error) {
    report.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await scenario("A Finder file in an installed copy is not a local change", async (context) => {
  await writeFile(join(context.workspace, ".agents/skills", context.slug, ".DS_Store"), "finder");
  const before = await installedState(context);
  assert.equal(before, "installed@1");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@2");
  return { before, revise, after };
});

await scenario("B A save from the installed copy that quotes the frontmatter installs", async (context) => {
  await writeCopies(context, "SKILL.md", skillMarkdown("Use when: the user asks.", "Revision 1."));
  const revise = await reviseFrom(context, 1, `.agents/skills/${context.slug}`);
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@2");
  return { revise, after };
});

await scenario("C A copy with a newer saved revision than the lock installs", async (context) => {
  await mkdir(join(context.workspace, "other"), { recursive: true });
  await writeFile(join(context.workspace, "other/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  await Effect.runPromise(context.library.revise(AGENT_ID, context.skillId, 1, "other"));
  await writeCopies(context, "SKILL.md", skillMarkdown("First.", "Revision 2."));
  const before = await installedState(context);
  assert.equal(before, "modified@1");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 3."));
  const revise = await reviseFrom(context, 2, "source");
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@3");
  return { before, revise, after };
});

await scenario("D An edit that no revision has still refuses, and the user's replace installs", async (context) => {
  await writeCopies(context, "SKILL.md", skillMarkdown("First.", "An edit that is not saved."));
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.ok(revise?.includes(REFUSED), "The edit stops the install.");
  const retry = await failure(context.tools.install({ agentId: AGENT_ID, skillId: context.skillId, revision: 2 }));
  assert.equal(retry, REFUSED);
  const replace = await failure(
    context.service.install({ agentId: AGENT_ID, skillId: context.skillId, replaceModified: true }),
  );
  assert.equal(replace, null);
  const after = await installedState(context);
  assert.equal(after, "installed@2");
  return { revise, retry, replace, after };
});

await scenario("E A folder that a save leaves out still refuses", async (context) => {
  const folder = join(context.workspace, ".agents/skills", context.slug, "node_modules");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "tool.js"), "export {};\n");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.ok(revise?.includes(REFUSED), "The extra folder stops the install.");
  return { revise };
});

await scenario("F A quoted frontmatter with another unsaved edit still refuses", async (context) => {
  await writeCopies(context, "SKILL.md", skillMarkdown("Use when: the user asks.", "An edit that is not saved."));
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("Use when: the user asks.", "Revision 1."));
  const revise = await reviseFrom(context, 1, "source");
  assert.ok(revise?.includes(REFUSED), "The edit stops the install.");
  return { revise };
});

await scenario("G Copies at the new revision and at another saved revision install", async (context) => {
  await mkdir(join(context.workspace, "other"), { recursive: true });
  await writeFile(join(context.workspace, "other/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  await Effect.runPromise(context.library.revise(AGENT_ID, context.skillId, 1, "other"));
  const skillFile = (folder: string) => join(context.workspace, folder, context.slug, "SKILL.md");
  await writeFile(skillFile(".claude/skills"), skillMarkdown("First.", "Revision 2."));
  await writeFile(skillFile(".agents/skills"), skillMarkdown("First.", "Revision 3."));
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 3."));
  const revise = await reviseFrom(context, 2, "source");
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@3");
  return { revise, after };
});

await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/skill-install-local-changes-e2e.json", `${JSON.stringify(report, null, 2)}\n`);
if (report.some((entry) => !entry.passed)) process.exitCode = 1;
