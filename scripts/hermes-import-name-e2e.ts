import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import { type HermesImportAgents, HermesImportService } from "../src/main/hermes-import-service";

const REPO = resolve(import.meta.dirname, "..");
const OUT = join(REPO, ".openbot-build/hermes-import-name-e2e");
const GLOBAL_NAME = "Sol";
const CODEX_PATH = process.env.OPENBOT_CODEX_PATH?.trim() || "codex";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "ok" : "FAIL"} ${name}\n`);
};

async function write(path: string, text: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

function fakeAgents(root: string, agents: AgentSummary[]): HermesImportAgents {
  return {
    listAgents: () => agents,
    listMcpServers: () => [],
    createAgentProfile: (input) =>
      Effect.promise(async () => {
        const id = `agent-${agents.length + 1}`;
        const workspacePath = join(root, "workspaces", id);
        await mkdir(workspacePath, { recursive: true });
        const agent: AgentSummary = {
          id,
          name: input.name,
          title: input.title ?? "",
          description: input.description,
          notifications: false,
          provider: "codex",
          model: "gpt-6.2-sol",
          reasoningEffort: "high",
          threadId: null,
          workspacePath,
          preview: "",
          updatedAt: null,
          avatarSeed: input.avatarSeed,
          avatarHue: null,
          avatarUrl: null,
        };
        agents.push(agent);
        return agent;
      }),
    updateAgent: (input) =>
      Effect.sync(() => {
        const agent = agents.find((candidate) => candidate.id === input.agentId);
        if (!agent) throw new Error("missing agent");
        Object.assign(agent, input.description === undefined ? {} : { description: input.description });
        return agent;
      }),
    deleteAgent: () => Effect.void,
    createRoutine: () => undefined,
    listRoutines: () => [],
    createMemory: () => undefined,
    listMemories: () => [],
    memoryLimit: () => 64,
    initializeMemorySelection: () => undefined,
    saveMcpServer: () => Effect.void,
    instructionsSaving: () => () => undefined,
  };
}

async function importAll(service: HermesImportService, hermes: string) {
  const preview = await Effect.runPromise(service.stage(hermes));
  if (!preview) throw new Error("no Hermes profiles");
  return Effect.runPromise(
    service.apply({
      token: preview.token,
      profiles: preview.profiles.map((profile) => ({ key: profile.key, allow: [] })),
    }),
  );
}

const instructions = (agent: AgentSummary) => readFile(join(agent.workspacePath, "AGENTS.md"), "utf8");
const count = (text: string, part: string) => text.split(part).length - 1;

function openBotPrompt(agent: AgentSummary): string {
  return developerInstructions(agent, "/shared", [], "/automation", DEFAULT_AGENT_DEFAULTS, {
    computerUseInOwnChat: false,
    agentCursorDrawn: true,
    sideThread: false,
    passwordVault: false,
    storedMemoryCount: 0,
    memoriesInTurns: true,
    teammatesInTurns: true,
    sectionTeammates: null,
    homeSkills: [],
  });
}

function askCodex(workspace: string, codexHome: string): string {
  const result = spawnSync(
    CODEX_PATH,
    [
      "exec",
      "--skip-git-repo-check",
      "-C",
      workspace,
      "--sandbox",
      "read-only",
      "-m",
      "gpt-6.2-sol",
      "-c",
      'model_reasoning_effort="high"',
      "Introduce yourself in one sentence: what is your name?",
    ],
    { env: { ...process.env, CODEX_HOME: codexHome }, encoding: "utf8", timeout: 240_000 },
  );
  return (result.stdout ?? "").trim().split("\n").at(-1) ?? "";
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "openbot-hermes-name-"));
  const answers: Array<{ agent: string; answer: string }> = [];
  let failure: string | undefined;
  try {
    const hermes = join(root, ".hermes");
    await write(join(hermes, "SOUL.md"), "You are a careful research assistant.");
    await write(join(hermes, "profiles", "nova", "SOUL.md"), "You review pull requests.");
    await write(join(hermes, "profiles", "max", "SOUL.md"), "You plan trips.");
    const agents: AgentSummary[] = [];
    const service = new HermesImportService(
      fakeAgents(root, agents),
      {
        library: () => {
          throw new Error("unused");
        },
        installLocal: () => Effect.die("unused"),
      },
      join(root, "links.json"),
      () => "UTC",
    );

    const first = await importAll(service, hermes);
    check("the first import makes three agents", first.agents.length === 3, first.agents.map((a) => a.name).join(", "));
    check("the first import has no warnings", first.warnings.length === 0, first.warnings.join(" | "));
    for (const agent of agents) {
      const text = await instructions(agent);
      check(
        `${agent.name}: the Instructions file has its own name`,
        text === `# Identity\n\n- Your name is ${agent.name}. Introduce yourself as ${agent.name}.\n`,
        text,
      );
    }

    const nova = agents.find((agent) => agent.name === "Nova");
    const max = agents.find((agent) => agent.name === "Max");
    if (!nova || !max) throw new Error("missing imported agents");
    const userRules = "# Style\n\n- Answer in French.\n";
    await writeFile(join(nova.workspacePath, "AGENTS.md"), userRules);
    const ownRule = "# Me\n\n- Your name is Maxine.\n";
    await writeFile(join(max.workspacePath, "AGENTS.md"), ownRule);

    const second = await importAll(service, hermes);
    check(
      "a second import updates the same agents",
      agents.length === 3 && second.agents.length === 3,
      `${agents.length}`,
    );
    const novaText = await instructions(nova);
    check(
      "Nova: a second import keeps the user's text and adds the name once",
      novaText.startsWith(userRules.trimEnd()) && count(novaText, "Your name is Nova.") === 1,
      novaText,
    );
    check(
      "Max: a user's own name rule stays unchanged",
      (await instructions(max)) === ownRule,
      await instructions(max),
    );
    const hermesAgent = agents.find((agent) => agent.name === "Hermes");
    if (!hermesAgent) throw new Error("missing Hermes agent");
    const hermesText = await instructions(hermesAgent);
    check("Hermes: a second import adds no second name line", count(hermesText, "Your name is") === 1, hermesText);

    if (process.argv.includes("--codex")) {
      const codexHome = join(homedir(), ".cache", `openbot-hermes-name-${process.pid}`);
      await mkdir(codexHome, { recursive: true });
      try {
        const config = await readFile(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"), "utf8");
        await writeFile(
          join(codexHome, "config.toml"),
          `developer_instructions = '''\n${openBotPrompt(hermesAgent)}'''\n${config}`,
        );
        await writeFile(
          join(codexHome, "AGENTS.md"),
          `# About me\n\n- Your name is ${GLOBAL_NAME}. Always introduce yourself as ${GLOBAL_NAME}.\n`,
        );
        const answer = askCodex(hermesAgent.workspacePath, codexHome);
        answers.push({ agent: hermesAgent.name, answer });
        check(
          `Codex with a global name "${GLOBAL_NAME}": the imported agent uses its own name`,
          answer.includes(hermesAgent.name) && !answer.includes(GLOBAL_NAME),
          answer,
        );
      } finally {
        await rm(codexHome, { recursive: true, force: true });
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAIL ${failure}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const passed = failure === undefined && checks.length > 0 && checks.every((entry) => entry.ok);
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, checks, answers, ...(failure ? { failure } : {}) }, null, 2)}\n`,
  );
  process.stdout.write(`${passed ? "passed" : "FAILED"}: ${join(OUT, "report.json")}\n`);
  process.exitCode = passed ? 0 : 1;
}

await main();
