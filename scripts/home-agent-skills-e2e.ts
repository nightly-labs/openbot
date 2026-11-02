// Every provider can use the skills in `~/.agents/skills` (nightly-labs/openbot#3204).
// A temporary HOME holds two skills; `npx skills` also linked one of them into `~/.claude/skills`.
// - The real Claude Agent SDK starts a stand-in Claude executable that records its arguments: the
//   session gets an `agents` plugin with the skill that Claude does not read already.
// - The installed Claude CLI, when there is one, loads that plugin and lists `agents:<name>`.
// - Antigravity gets the skills in its developer instructions; Codex, which reads the folder, does not.
// - The `$` list adds the home skill, and its tag names the skill's SKILL.md for the provider only.
// `bun run test:home-skills`; exit 0 = all pass. Writes .openbot-build/home-agent-skills-e2e/report.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { displayMessageReferences } from "../src/backend/agent/delivery-content";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { listHomeSkills } from "../src/backend/home-skills";
import { listHomeFolderSkills } from "../src/main/skill-folder-discovery";

const OUT = resolve(import.meta.dirname, "../.openbot-build/home-agent-skills-e2e");
const ROOT_VARIABLE = "OPENBOT_HOME_SKILLS_E2E_ROOT";

// `os.homedir()` reads HOME when the process starts, so the checks run in a child with the temporary HOME.
if (!process.env[ROOT_VARIABLE]) {
  const root = await mkdtemp(join(tmpdir(), "openbot-home-skills-e2e-"));
  const child = spawnSync(process.execPath, [import.meta.filename], {
    stdio: "inherit",
    env: { ...process.env, HOME: join(root, "home"), OPENBOT_REAL_HOME: process.env.HOME ?? "", [ROOT_VARIABLE]: root },
  });
  await rm(root, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

interface Report {
  passed: boolean;
  checks: {
    claudePlugin?: { plugin: string; linked: string[] };
    claudeCli?: { version: string; skills: string[] } | "skipped: no claude on PATH";
    instructions?: string;
    tag?: string;
  };
  error?: string;
}
const report: Report = { passed: false, checks: {} };
const realHome = process.env.OPENBOT_REAL_HOME;
const root = process.env[ROOT_VARIABLE] ?? "";
let client: ClaudeAgentClient | null = null;

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nSay ${name}.\n`);
}

try {
  const home = join(root, "home");
  const homeSkills = join(home, ".agents", "skills");
  await writeSkill(join(homeSkills, "zeta-skill"), "zeta-skill", "Answers with zeta.");
  await writeSkill(join(homeSkills, "linked-skill"), "linked-skill", "Already linked into Claude.");
  await writeSkill(join(homeSkills, "broken-skill"), "other-name", "Its name is not its folder.");
  await mkdir(join(home, ".claude", "skills"), { recursive: true });
  await symlink("../../.agents/skills/linked-skill", join(home, ".claude", "skills", "linked-skill"));
  delete process.env.CLAUDE_CONFIG_DIR;

  const listed = await runCauseEffect(listHomeSkills());
  assert.deepEqual(
    listed.map((skill) => skill.slug),
    ["linked-skill", "zeta-skill"],
    "The scan lists the valid skills and leaves out the one whose name is not its folder.",
  );

  // The Claude session gets a plugin with the skill that `~/.claude/skills` does not hold.
  const recorded = join(root, "claude-arguments.txt");
  const executable = join(root, "claude");
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${recorded}.tmp"\nmv "${recorded}.tmp" "${recorded}"\nexec cat > /dev/null\n`,
  );
  await chmod(executable, 0o755);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const state = join(root, "state");
  client = new ClaudeAgentClient(
    { executable, version: "2.1.310", source: "system" },
    undefined,
    undefined,
    30_000,
    () => [],
    undefined,
    undefined,
    undefined,
    state,
    () => ({}),
  );
  client.start();
  await runCauseEffect(client.request("thread/start", { cwd: workspace, persistSession: false }, (value) => value));
  const argumentsText = await new Promise<string>((done, fail) => {
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      fail(new Error("The Claude process did not start."));
    }, 10_000);
    const poll = () =>
      readFile(recorded, "utf8").then(
        (text) => {
          clearTimeout(deadline);
          done(text);
        },
        () => {
          if (!expired) setTimeout(poll, 50);
        },
      );
    poll();
  });
  const argv = argumentsText.split("\n");
  const pluginDirectories = argv.flatMap((value, index) => (value === "--plugin-dir" ? [argv[index + 1] ?? ""] : []));
  assert.equal(pluginDirectories.length, 1, "A Full access Claude session gets one plugin: the home skills.");
  const plugin = pluginDirectories[0] ?? "";
  const manifest = JSON.parse(await readFile(join(plugin, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "agents");
  const linked = (await readdir(join(plugin, "skills"))).sort();
  assert.deepEqual(linked, ["zeta-skill"], "The skill that ~/.claude/skills already links is left out.");
  assert.equal(await readlink(join(plugin, "skills", "zeta-skill")), join(homeSkills, "zeta-skill"));
  report.checks.claudePlugin = { plugin, linked };

  // The installed Claude CLI loads the linked skill from that plugin.
  const cli = spawnSync("claude", ["--version"], { encoding: "utf8", env: { ...process.env, HOME: realHome } });
  if (cli.status === 0) {
    const run = spawnSync(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", "--plugin-dir", plugin, "--max-turns", "1"],
      { cwd: workspace, input: "hi", encoding: "utf8", env: { ...process.env, HOME: realHome }, timeout: 120_000 },
    );
    const init = run.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((message) => message.type === "system" && message.subtype === "init");
    assert.ok(init, "The Claude CLI sends its init message.");
    assert.ok(init.skills.includes("agents:zeta-skill"), "The Claude CLI lists agents:zeta-skill.");
    assert.ok(!init.skills.includes("agents:linked-skill"), "The Claude CLI does not list the linked skill twice.");
    report.checks.claudeCli = {
      version: cli.stdout.trim(),
      skills: init.skills.filter((s: string) => s.startsWith("agents:")),
    };
  } else {
    report.checks.claudeCli = "skipped: no claude on PATH";
  }

  // Antigravity does not read the folder, so its instructions name each skill and its SKILL.md.
  const agent: AgentSummary = {
    id: "agent-1",
    name: "Tester",
    title: "",
    description: "",
    notifications: false,
    provider: "antigravity",
    model: "gemini-3-pro",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: workspace,
    preview: "",
    updatedAt: null,
    avatarSeed: "agent-1",
    avatarHue: null,
    avatarUrl: null,
  };
  const instructions = (homeSkillsOption?: typeof listed) =>
    developerInstructions(
      agent,
      join(root, "shared"),
      [],
      join(root, "automation"),
      DEFAULT_AGENT_DEFAULTS,
      homeSkillsOption ? { homeSkills: homeSkillsOption } : {},
    );
  const withSkills = instructions(listed);
  assert.ok(withSkills.includes(`- zeta-skill: Answers with zeta. (${join(homeSkills, "zeta-skill", "SKILL.md")})`));
  const withoutSkills = instructions();
  assert.ok(!withoutSkills.includes("~/.agents/skills"), "No list without home skills.");
  report.checks.instructions = "antigravity block present";

  // The `$` list adds a home skill that the agent's list does not have yet.
  const chat = await runCauseEffect(listHomeFolderSkills(new Set(["linked-skill"])));
  assert.deepEqual(
    chat.map((skill) => [skill.skillId, skill.origin, skill.location]),
    [["home:zeta-skill", "workspace", "~/.agents/skills/zeta-skill"]],
  );

  // The provider reads the SKILL.md path of a home tag; a person and an unsafe id get the name alone.
  const tagged = "Use @[zeta-skill](skill:home:zeta-skill) and @[x](skill:home:../x).";
  const provider = displayMessageReferences(tagged, [], new Map());
  assert.equal(provider, `Use zeta-skill at ${join(homeSkills, "zeta-skill", "SKILL.md")} (skill) and x (skill).`);
  assert.equal(
    displayMessageReferences(tagged, [], new Map(), { fileHeadings: false }),
    "Use zeta-skill (skill) and x (skill).",
  );
  report.checks.tag = provider;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (client) await runCauseEffect(client.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);
