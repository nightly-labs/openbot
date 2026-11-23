import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentModelOption, isAgentModel } from "@openbot/contracts/ipc";
import { generateTextWithoutTools } from "../src/backend/agent/profile-generation";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-throwaway-sessions-e2e");
const AGENTS = ["deletes", "keeps"] as const;
type AgentName = (typeof AGENTS)[number];

interface Entry {
  method: string;
  sessionId: string;
}

interface Case {
  name: string;
  answer: string | null;
  prompted: string[];
  deleted: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-throwaway-e2e-"));
const report: { passed: boolean; cases: Case[] } = { passed: false, cases: [] };
const clients: AgentClient[] = [];
const logPath = (agent: AgentName) => join(root, `${agent}.jsonl`);

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await installFakeAgent(executable, "throwaway-sessions");

  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  for (const agent of AGENTS) {
    await runCauseEffect(
      store.save({
        id: agent,
        name: agent,
        command: executable,
        args: [],
        env: [
          { name: "FAKE_DELETES", value: agent === "deletes" ? "1" : "0" },
          { name: "FAKE_LOG", value: logPath(agent) },
        ],
        usagePrompt: null,
      }),
    );
  }

  const driver = requireProviderDriver("acp");
  const createProfileClient = driver.createProfileClient;
  assert.ok(createProfileClient, "The custom ACP driver has a profile client.");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const modelOf = (agent: AgentName): AgentModelOption => {
    const id = `${agent}/default`;
    assert.ok(isAgentModel(id));
    return {
      provider: "acp",
      id,
      name: agent,
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium"],
    };
  };
  const entries = async (agent: AgentName, from: number) => (await readJsonl<Entry>(logPath(agent))).slice(from);
  const sessions = (log: Entry[], method: string) =>
    log.filter((entry) => entry.method === method).map((entry) => entry.sessionId);

  const toolless = async (name: string, agent: AgentName) => {
    const from = (await readJsonl<Entry>(logPath(agent))).length;
    const client = createProfileClient(cli, 20_000, context);
    clients.push(client);
    const answer = await runCauseEffect(generateTextWithoutTools(client, modelOf(agent), "Did the agent finish?"));
    const log = await entries(agent, from);
    const result: Case = {
      name,
      answer,
      prompted: sessions(log, "session/prompt"),
      deleted: sessions(log, "session/delete"),
    };
    report.cases.push(result);
    return result;
  };

  const deleted = await toolless("tool-less turn on an agent that deletes sessions", "deletes");
  assert.equal(deleted.answer?.trim(), '{"verdict":"done"}', "The tool-less turn answers.");
  assert.equal(deleted.prompted.length, 1, "The tool-less turn prompts one session.");
  assert.ok(
    deleted.prompted.every((id) => deleted.deleted.includes(id)),
    "OpenBot deletes the session of the tool-less turn.",
  );

  const kept = await toolless("tool-less turn on an agent without session/delete", "keeps");
  assert.equal(kept.answer?.trim(), '{"verdict":"done"}', "The tool-less turn answers.");
  assert.equal(kept.prompted.length, 1, "The tool-less turn prompts one session.");
  assert.deepEqual(kept.deleted, [], "OpenBot sends no session/delete to an agent that does not support it.");

  {
    const agent: AgentName = "deletes";
    const from = (await readJsonl<Entry>(logPath(agent))).length;
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    const model = modelOf(agent).id;
    const thread = await startThread(client, { model, cwd: workspace, runtimeWorkspaceRoots: [workspace] });
    const turn = await runTurn(client, thread, { model, text: "hello" });
    await runCauseEffect(client.stop());
    const log = await entries(agent, from);
    const result: Case = {
      name: "chat session on an agent that deletes sessions",
      answer: turn.reply,
      prompted: sessions(log, "session/prompt"),
      deleted: sessions(log, "session/delete"),
    };
    report.cases.push(result);
    assert.equal(result.prompted.length, 1, "The chat prompts one session.");
    assert.ok(
      result.prompted.every((id) => !result.deleted.includes(id)),
      "OpenBot keeps the chat session when the client stops.",
    );
  }

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
