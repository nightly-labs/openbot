// Runs the real `acp` provider driver over two fake agents to check that a session gets the OpenBot
// instructions once and not with every prompt. The instructions are 20-30 k characters, so each
// prompt that repeats them costs thousands of input tokens. The "context" agent reports its context
// size as OpenCode does: the instructions must come again after a change, a compaction, a failed
// prompt and a restart. The "silent" agent reports nothing: the instructions come every 10 prompts.
// `bun run test:acp-instructions-once`. Writes .openbot-build/acp-instructions-once-e2e/report.json.
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
const MODES = ["context", "silent"] as const;
type Mode = (typeof MODES)[number];

const INSTRUCTIONS = "You are a teammate in OpenBot. Memory: the user likes short answers.";
const CHANGED = `${INSTRUCTIONS} Memory: the user works in Kraków.`;

interface Prompt {
  sessionId: string;
  instructions: boolean;
  instructionsText: string | null;
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
          { name: "FAKE_MODE", value: mode },
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

  // The context agent: one thread through each event that can take the instructions out of context.
  {
    const model = "context/default";
    const steps: Step[] = [];
    let client = open();
    const thread = await startThread(client, threadParams(model, INSTRUCTIONS));
    const turn = async (text: string, instructions: boolean) => {
      const result = await runTurn(client, thread, { model, text });
      steps.push({ text, instructions, status: result.status });
    };
    await turn("one", true);
    await turn("two", false);
    // A memory change reaches the held session through a resume, as `ThreadLifecycle` does.
    await runCauseEffect(
      client.request("thread/resume", { threadId: thread, ...threadParams(model, CHANGED) }, (v) => v),
    );
    await turn("three", true);
    await turn("four", false);
    await turn("compact-now", false);
    await turn("five", true);
    await turn("compaction-update", false);
    await turn("six", true);
    await turn("fail-now", false);
    await turn("seven", true);
    await turn("eight", false);
    // A new process opens the saved session, which may have lost its context.
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
    assert.ok(prompts[0]?.instructionsText?.includes(INSTRUCTIONS), "context: the first prompt has the instructions.");
    assert.ok(
      !prompts[0]?.instructionsText?.includes("Kraków"),
      "context: the first prompt has the instructions before the change.",
    );
    for (const prompt of prompts.slice(2).filter((entry) => entry.instructions))
      assert.ok(prompt.instructionsText?.includes("Kraków"), `context: "${prompt.text}" has the changed instructions.`);
  }

  // The silent agent cannot show a compaction, so the instructions come again after 10 prompts.
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

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

/** Compares the prompts that the agent got with the expected steps, one prompt for each step. */
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
