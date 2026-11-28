import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { zipSync } from "fflate";
import { runLocalSkillTool } from "../src/backend/agent/skill-tools";
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

async function writePythonCaches(directory: string, bytecode: string): Promise<void> {
  await mkdir(join(directory, "__pycache__"), { recursive: true });
  await writeFile(join(directory, "__pycache__/helper.cpython-312.pyc"), bytecode);
  await mkdir(join(directory, ".pytest_cache/v/cache"), { recursive: true });
  await writeFile(join(directory, ".pytest_cache/v/cache/lastfailed"), "{}\n");
}

await scenario("H Python cache folders are not a local change, and a save leaves them out", async (context) => {
  for (const folder of [".agents/skills", ".claude/skills"])
    await writePythonCaches(join(context.workspace, folder, context.slug), "bytecode");
  const before = await installedState(context);
  assert.equal(before, "installed@1");
  await writePythonCaches(join(context.workspace, "source"), "bytecode");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@2");
  const files = (await Effect.runPromise(context.library.get(context.skillId))).files.join(",");
  assert.equal(files, "SKILL.md");
  return { before, revise, after, files };
});

await scenario("I Python cache files that an older save kept do not block the next revision", async (context) => {
  const encoder = new TextEncoder();
  const older = zipSync({
    "SKILL.md": encoder.encode(skillMarkdown("First.", "Revision 2.")),
    "__pycache__/helper.cpython-312.pyc": encoder.encode("bytecode"),
  });
  await Effect.runPromise(context.library.reviseFromBundle(context.skillId, 1, older));
  const install = await failure(context.tools.install({ agentId: AGENT_ID, skillId: context.skillId, revision: 2 }));
  assert.equal(install, null);
  await writeCopies(context, "__pycache__/helper.cpython-312.pyc", "bytecode that Python wrote again");
  const before = await installedState(context);
  assert.equal(before, "installed@2");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 3."));
  const revise = await reviseFrom(context, 2, "source");
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@3");
  return { install, before, revise, after };
});

await scenario("J An edit next to Python cache folders still refuses", async (context) => {
  for (const folder of [".agents/skills", ".claude/skills"])
    await writePythonCaches(join(context.workspace, folder, context.slug), "bytecode");
  await writeCopies(context, "notes.md", "An edit that is not saved.\n");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.ok(revise?.includes(REFUSED), "The edit stops the install.");
  return { revise };
});

await scenario("K An empty runtime folder in an installed copy is not a local change", async (context) => {
  for (const folder of [".agents/skills", ".claude/skills"])
    await mkdir(join(context.workspace, folder, context.slug, ".claude/.cc-writes"), { recursive: true });
  const before = await installedState(context);
  assert.equal(before, "installed@1");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.equal(revise, null);
  const after = await installedState(context);
  assert.equal(after, "installed@2");
  return { before, revise, after };
});

await scenario("L A file inside a runtime folder still refuses", async (context) => {
  const folder = join(context.workspace, ".agents/skills", context.slug, ".claude/.cc-writes");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "notes.md"), "An edit that is not saved.\n");
  const before = await installedState(context);
  assert.equal(before, "modified@1");
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const revise = await reviseFrom(context, 1, "source");
  assert.ok(revise?.includes(REFUSED), "The file stops the install.");
  return { before, revise };
});

async function replaceWithOwnCopy(context: Context, text: string): Promise<string> {
  await Effect.runPromise(context.service.uninstall({ agentId: AGENT_ID, skillId: context.skillId }));
  const ownFile = join(context.workspace, ".claude/skills", context.slug, "SKILL.md");
  await mkdir(dirname(ownFile), { recursive: true });
  await writeFile(ownFile, text);
  return ownFile;
}

await scenario("M An own copy with the same files as the skill installs over it", async (context) => {
  const installedText = await readFile(join(context.workspace, ".claude/skills", context.slug, "SKILL.md"), "utf8");
  await replaceWithOwnCopy(context, installedText);
  const install = await failure(
    context.service.install({ agentId: AGENT_ID, skillId: context.skillId, replaceModified: false }),
  );
  assert.equal(install, null);
  const after = await installedState(context);
  assert.equal(after, "installed@1");
  return { install, after };
});

await scenario("N An own skill with the same name and other files stays and names the skill", async (context) => {
  const ownText = skillMarkdown("First.", "The agent's own skill.");
  const ownFile = await replaceWithOwnCopy(context, ownText);
  const install = await failure(
    context.service.install({ agentId: AGENT_ID, skillId: context.skillId, replaceModified: false }),
  );
  assert.equal(install, sourceText("error.skill.ownSkillExists", { slug: context.slug }));
  const kept = await readFile(ownFile, "utf8");
  assert.equal(kept, ownText);
  return { install, kept: kept === ownText ? "unchanged" : "changed" };
});

interface LocalSkillToolArguments {
  agentId?: string;
  skillId: string;
  revision?: number;
  expectedRevision?: number;
  sourcePath?: string;
}

await scenario("O A refused replace sends the agent to the user's Repair step, not to a retry", async (context) => {
  const edit = skillMarkdown("First.", "An edit that is not saved.");
  await writeCopies(context, "SKILL.md", edit);
  await writeFile(join(context.workspace, "source/SKILL.md"), skillMarkdown("First.", "Revision 2."));
  const callTool = (sender: string, tool: string, args: LocalSkillToolArguments) =>
    failure(runLocalSkillTool(context.tools, sender, tool, args, (agentId) => agentId ?? sender));
  const revise = await callTool(AGENT_ID, "revise_skill", {
    skillId: context.skillId,
    expectedRevision: 1,
    sourcePath: "source",
  });
  const install = await callTool(AGENT_ID, "install_local_skill", { skillId: context.skillId, revision: 2 });
  const ownById = await callTool(AGENT_ID, "install_local_skill", {
    agentId: AGENT_ID,
    skillId: context.skillId,
    revision: 2,
  });
  const older = await callTool(AGENT_ID, "install_local_skill", { skillId: context.skillId, revision: 1 });
  const forOther = await callTool("agent-lead", "install_local_skill", {
    agentId: AGENT_ID,
    skillId: context.skillId,
    revision: 2,
  });
  for (const text of [revise, install, ownById, older, forOther]) {
    assert.ok(text !== null, "The tool fails.");
    assert.ok(text.includes("This skill has local changes, and only the user can replace them."));
    assert.ok(text.includes("Replace skill: when the user confirms, this installs the newest revision"));
    assert.ok(!text.includes("Confirm replacement"), "The text does not ask the agent to confirm.");
    assert.ok(!text.includes("with install_local_skill."), "The text does not send the agent to a retry.");
  }
  assert.ok(revise?.startsWith(`Skill ${context.skillId} was saved as revision 2,`), "The revision is saved.");
  assert.ok(install !== null, "The install fails.");
  assert.ok(install.startsWith("This skill has local changes"));
  assert.ok(install.includes("show_setting with agent.skills"));
  assert.ok(install.includes("If the user needs revision 2 exactly, ask the user before they use Repair"));
  assert.ok(revise !== null, "The revise fails.");
  assert.ok(!revise.includes("If the user needs revision"), "A revise saves the newest revision.");
  assert.equal(ownById, install);
  assert.ok(older?.includes("If the user needs revision 1 exactly, ask the user before they use Repair"));
  assert.ok(forOther?.includes("that agent's settings") && !forOther.includes("show_setting"));
  const missing = { skillId: context.skillId, revision: 9 };
  const otherFailure = await callTool(AGENT_ID, "install_local_skill", missing);
  const serviceFailure = await failure(context.tools.install({ agentId: AGENT_ID, ...missing }));
  assert.ok(otherFailure !== null && otherFailure === serviceFailure, "Other failures keep their text.");
  const after = await installedState(context);
  assert.equal(after, "modified@1");
  for (const folder of [".agents/skills", ".claude/skills"])
    assert.equal(await readFile(join(context.workspace, folder, context.slug, "SKILL.md"), "utf8"), edit);
  return { revise, install, older, forOther, otherFailure, after };
});

await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/skill-install-local-changes-e2e.json", `${JSON.stringify(report, null, 2)}\n`);
if (report.some((entry) => !entry.passed)) process.exitCode = 1;
