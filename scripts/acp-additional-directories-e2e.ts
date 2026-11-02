// Runs the real `acp` provider driver over three fake agents to check which ACP session requests
// carry the agent's workspace roots as `additionalDirectories`. Grok 1.0.60 does not advertise the
// field and refuses it on `session/new`, `session/load` and `session/resume`, so every new Grok
// session failed. The fake "strict" agents answer as Grok does: one resumes with `session/resume`,
// one with `session/load`. The "wide" agent advertises the field and must still get the roots.
// `bun run test:acp-directories`. Writes .openbot-build/acp-additional-directories-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-additional-directories-e2e");

const MODES = ["strict-resume", "strict-load", "wide"] as const;
type Mode = (typeof MODES)[number];

interface SessionRequest {
  method: string;
  cwd: string;
  additionalDirectories: string[] | null;
}

interface AgentResult {
  requests: SessionRequest[];
  firstReply: string;
  resumedReply: string;
}

interface Report {
  passed: boolean;
  roots?: string[];
  agents: Partial<Record<Mode, AgentResult>>;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-directories-e2e-"));
const report: Report = { passed: false, agents: {} };
const clients: AgentClient[] = [];

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  const shared = join(root, "shared");
  const roots = [workspace, shared];
  report.roots = roots;
  await mkdir(workspace);
  await mkdir(shared);
  await installFakeAgent(executable, "directories");

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

  for (const mode of MODES) {
    const model = `${mode}/default`;
    // A new session, a turn, then a new process that opens the saved session again.
    let client = open();
    const thread = await startThread(client, { model, cwd: workspace, runtimeWorkspaceRoots: roots });
    const firstReply = await reply(client, thread, model);
    await runCauseEffect(client.stop());
    client = open();
    await runCauseEffect(
      client.request(
        "thread/resume",
        { threadId: thread, model, cwd: workspace, runtimeWorkspaceRoots: roots },
        (v) => v,
      ),
    );
    const resumedReply = await reply(client, thread, model);
    await runCauseEffect(client.stop());

    // The client also opens sessions of its own to list models. They carry no roots.
    const requests = await readJsonl<SessionRequest>(join(root, `${mode}.jsonl`));
    const resumeMethod = mode === "strict-load" ? "session/load" : "session/resume";
    const withRoots = requests.filter((request) => request.additionalDirectories !== null);
    assert.ok(
      requests.some((request) => request.method === resumeMethod && request.cwd === workspace),
      `${mode}: the restart opens the saved session with ${resumeMethod}.`,
    );
    if (mode === "wide") {
      assert.deepEqual(
        withRoots.map((request) => request.method),
        ["session/new", "session/resume"],
        "wide: the thread's session requests carry the roots.",
      );
      for (const request of withRoots) assert.deepEqual(request.additionalDirectories, roots);
    } else {
      assert.deepEqual(withRoots, [], `${mode}: no session request carries a field the agent does not advertise.`);
    }
    assert.equal(firstReply, "OK", `${mode}: the first turn answers.`);
    assert.equal(resumedReply, "OK", `${mode}: the turn after the restart answers.`);
    report.agents[mode] = { requests, firstReply, resumedReply };
  }

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

/** Runs a turn that must succeed and answers its reply. */
async function reply(client: AgentClient, thread: string, model: string): Promise<string> {
  const turn = await runTurn(client, thread, { model, text: "Reply with OK only." });
  assert.equal(turn.error, null, `The turn on ${model} succeeds.`);
  return turn.reply;
}
