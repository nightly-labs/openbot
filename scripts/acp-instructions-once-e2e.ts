import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-instructions-once-e2e");
const MODES = ["context", "silent", "memory"] as const;
type Mode = (typeof MODES)[number];

const INSTRUCTIONS = "You are a teammate in OpenBot. Memory: the user likes short answers.";
const CHANGED = `${INSTRUCTIONS} Memory: the user works in Kraków.`;

interface Prompt {
  sessionId: string;
  instructions: boolean;
  instructionsText: string | null;
  context: string[];
  text: string;
}

interface Step {
  text: string;
  instructions: boolean;
  status: string | null;
}

interface Report {
  passed: boolean;
  agents: Partial<Record<Mode, { steps: Step[]; prompts: Prompt[] }>>;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-instructions-e2e-"));
const report: Report = { passed: false, agents: {} };
const clients: AgentClient[] = [];

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await installFakeAgent(executable, "instructions");

  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  for (const mode of MODES) {
    await runCauseEffect(
      store.save({
        id: mode,
        name: mode,
        command: executable,
        args: [],
        env: [
          { name: "FAKE_MODE", value: mode === "memory" ? "context" : mode },
          { name: "FAKE_LOG", value: join(root, `${mode}.jsonl`) },
        ],
        usagePrompt: null,
      }),
    );
  }

  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const open = () => {
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    return client;
  };
  const threadParams = (model: string, developerInstructions: string) => ({
    model,
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    developerInstructions,
  });

  {
    const model = "context/default";
    const steps: Step[] = [];
    let client = open();
    const thread = await startThread(client, threadParams(model, INSTRUCTIONS));
    const turn = async (text: string, instructions: boolean) => {
      const result = await runTurn(client, thread, { model, text });
      steps.push({ text, instructions, status: result.status });
    };
    await turn("/review", false);
    await turn("one", true);
    await turn("two", false);
    await runCauseEffect(
      client.request("thread/resume", { threadId: thread, ...threadParams(model, CHANGED) }, (v) => v),
    );
    await turn("/swarm count the files", false);
    await turn("three", true);
    await turn("four", false);
    await turn("compact-now", false);
    await turn("five", true);
    await turn("compaction-update", false);
    await turn("six", true);
    await turn("fail-now", false);
    await turn("seven", true);
    await turn("eight", false);
    await runCauseEffect(client.stop());
    client = open();
    await runCauseEffect(
      client.request("thread/resume", { threadId: thread, ...threadParams(model, CHANGED) }, (v) => v),
    );
    await turn("nine", true);
    await turn("ten", false);
    await runCauseEffect(client.stop());

    const prompts = await readJsonl<Prompt>(join(root, "context.jsonl"));
    report.agents.context = { steps, prompts };
    check("context", steps, prompts);
    assert.equal(
      steps.find((step) => step.text === "fail-now")?.status,
      "failed",
      "context: the failing prompt fails.",
    );
    const one = prompts.find((prompt) => prompt.text === "one");
    assert.ok(one?.instructionsText?.includes(INSTRUCTIONS), "context: the first prompt has the instructions.");
    assert.ok(
      !one?.instructionsText?.includes("Kraków"),
      "context: the first prompt has the instructions before the change.",
    );
    for (const prompt of prompts.slice(3).filter((entry) => entry.instructions))
      assert.ok(prompt.instructionsText?.includes("Kraków"), `context: "${prompt.text}" has the changed instructions.`);
  }

  {
    const model = "silent/default";
    const steps: Step[] = [];
    const client = open();
    const thread = await startThread(client, threadParams(model, INSTRUCTIONS));
    for (let index = 1; index <= 12; index += 1) {
      const text = `prompt ${index}`;
      const result = await runTurn(client, thread, { model, text });
      steps.push({ text, instructions: index === 1 || index === 11, status: result.status });
    }
    await runCauseEffect(client.stop());
    const prompts = await readJsonl<Prompt>(join(root, "silent.jsonl"));
    report.agents.silent = { steps, prompts };
    check("silent", steps, prompts);
  }

  {
    const model = "memory/default";
    const steps: Step[] = [];
    const client = open();
    const memory = (id: string, text: string) => ({ id, text, origin: "manual" as const });
    const facts = [
      "The user likes short answers.",
      "The user writes TypeScript and reviews pull requests every morning.",
      "The team ships a desktop release every second Thursday.",
      "The user prefers metric units and 24-hour times.",
      "The staging server is called staging-eu and must not be restarted on Fridays.",
      "The user reads changelogs before each upgrade.",
    ];
    const first = { memories: facts.map((text, index) => memory(`m-${index}`, text)), storedCount: 6, limit: 20 };
    const edited = {
      memories: [...first.memories, memory("m-new", "The user works in Kraków.")],
      storedCount: 7,
      limit: 20,
    };
    const thread = await startThread(client, { ...threadParams(model, INSTRUCTIONS), memoryContext: first });
    const turn = async (text: string, instructions: boolean) => {
      const result = await runTurn(client, thread, { model, text });
      steps.push({ text, instructions, status: result.status });
    };
    await turn("one", true);
    await turn("two", false);
    await runCauseEffect(
      client.request(
        "thread/resume",
        { threadId: thread, ...threadParams(model, INSTRUCTIONS), memoryContext: edited },
        (v) => v,
      ),
    );
    await turn("three", false);
    await turn("four", false);
    await turn("/review", false);
    await turn("after-command", false);
    await turn("compact-now", false);
    await turn("five", true);
    await runCauseEffect(client.stop());

    const prompts = await readJsonl<Prompt>(join(root, "memory.jsonl"));
    report.agents.memory = { steps, prompts };
    check("memory", steps, prompts);
    const contextOf = (text: string) => prompts.find((prompt) => prompt.text === text)?.context ?? [];
    const full = contextOf("one")[0] ?? "";
    assert.ok(full.startsWith("<openbot_saved_memories>"), "memory: the first prompt has all memories.");
    assert.ok(
      full.includes("short answers") && !full.includes("Kraków"),
      "memory: the first block has the first list.",
    );
    assert.deepEqual(contextOf("two"), [], "memory: an unchanged list sends no block.");
    const [update = "", ...others] = contextOf("three");
    assert.equal(others.length, 0, "memory: the edit sends one block.");
    assert.ok(update.startsWith("<openbot_saved_memories_update>"), "memory: the edit sends an update block.");
    assert.ok(
      update.includes("Kraków") && !update.includes("short answers"),
      "memory: the update has only the change.",
    );
    assert.deepEqual(contextOf("four"), [], "memory: the update is sent once.");
    assert.deepEqual(contextOf("/review"), [], "memory: a slash command gets no blocks.");
    assert.ok(
      contextOf("after-command")[0]?.startsWith("<openbot_saved_memories>"),
      "memory: the prompt after a slash command has all memories.",
    );
    const again = contextOf("five")[0] ?? "";
    assert.ok(
      again.startsWith("<openbot_saved_memories>") && again.includes("short answers") && again.includes("Kraków"),
      "memory: after a compaction, the prompt has all memories again.",
    );
  }

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function check(mode: Mode, steps: readonly Step[], prompts: readonly Prompt[]): void {
  assert.deepEqual(
    prompts.map((prompt) => prompt.text),
    steps.map((step) => step.text),
    `${mode}: the agent gets one prompt for each turn.`,
  );
  assert.deepEqual(
    prompts.map((prompt) => `${prompt.text}: ${prompt.instructions}`),
    steps.map((step) => `${step.text}: ${step.instructions}`),
    `${mode}: the instructions come only when the session lacks them.`,
  );
}
