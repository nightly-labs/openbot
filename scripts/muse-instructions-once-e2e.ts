// Drives MuseAgentClient and the installed SDK over a fake Muse server to check that a session gets
// the OpenBot instructions once and not with every turn. They must come again after a change, a
// compaction, a failed turn and a restart. A memory edit sends one small update block with the next
// turn, not the instructions again.
// `bun run test:muse-instructions-once`. Writes .openbot-build/muse-instructions-once-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXPECTED_SCHEMA_FINGERPRINT } from "@muse-code/sdk";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MuseAgentClient } from "../src/backend/muse-client";
import { readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/muse-instructions-once-e2e");
const INSTRUCTIONS = "You are a teammate in OpenBot. Memory: the user likes short answers.";
const CHANGED = `${INSTRUCTIONS} Memory: the user works in Kraków.`;

// The fake answers only the MSP requests that this test sends. A turn that says "compact-now"
// reports a completed compaction item, and one that says "fail-now" ends as failed.
const fixture = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const send = (entry) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...entry }) + "\\n");
let items = [];
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  const p = message.params || {};
  const result = (value) => send({ id: message.id, result: value });
  if (message.method === "initialize") {
    return result({ experimentalApi: false, grantedCapabilities: ["sessionMcp"],
      museHome: process.env.HOME, platformFamily: "unix", platformOs: process.platform,
      schema: { version: 1, fingerprint: process.env.FIXTURE_FINGERPRINT },
      serverInfo: { name: "instructions-fixture", version: "1" },
      sessionDurability: "durable", userAgent: "local-e2e" });
  }
  if (message.method === "initialized") return;
  if (message.method === "session/start" || message.method === "session/resume") {
    const file = path.join(process.env.HOME, p.sessionId + ".json");
    if (message.method === "session/start") fs.writeFileSync(file, "{}");
    else if (!fs.existsSync(file)) {
      return send({ id: message.id, error: { code: -32602, message: "saved session required" } });
    }
    return result({ session: { sessionId: p.sessionId } });
  }
  if (message.method === "session/read") {
    return result({ session: { sessionId: p.sessionId },
      history: { mode: "inline", items, snapshot: null }, pendingRequests: [], viewCursor: "1" });
  }
  if (message.method !== "turn/start") {
    return send({ id: message.id, error: { code: -32601, message: "unexpected " + message.method } });
  }
  const texts = p.input.map((block) => block.text);
  fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ texts }) + "\\n");
  const turnId = p.commandId;
  const sessionId = p.sessionId;
  result({ commandId: turnId, status: "accepted", turnId });
  const said = texts.join(" ");
  if (said.includes("compact-now")) {
    send({ method: "item/completed", params: { sessionId, item: {
      itemId: turnId + "-compaction", turnId, kind: "compaction", revision: 1, status: "completed" } } });
  }
  if (said.includes("fail-now")) {
    items = [];
    return send({ method: "turn/completed", params: { sessionId, turnId, terminal: "failed",
      error: { message: "the model failed" } } });
  }
  const reply = { itemId: turnId + "-reply", turnId, kind: "agentMessage", revision: 1, status: "completed", text: "OK" };
  items = [reply];
  send({ method: "item/completed", params: { sessionId, item: reply } });
  send({ method: "turn/completed", params: { sessionId, turnId, terminal: "completed" } });
});
`;

interface Step {
  text: string;
  instructions: string | null;
  status: string | null;
}

interface Report {
  passed: boolean;
  steps: Step[];
  prompts: { texts: string[] }[];
  memoryPrompts: { texts: string[] }[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-muse-instructions-e2e-"));
const report: Report = { passed: false, steps: [], prompts: [], memoryPrompts: [] };
const clients: AgentClient[] = [];

try {
  const executable = join(root, "fixture.cjs");
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const log = join(root, "prompts.jsonl");
  const memoryLog = join(root, "memory-prompts.jsonl");
  await mkdir(workspace);
  await mkdir(home);
  await writeFile(executable, fixture);
  await chmod(executable, 0o700);
  const open = (fixtureLog = log) => {
    const client = new MuseAgentClient(
      { executable, version: "fixture" },
      {
        apiKey: () => null,
        requestTimeoutMs: 8_000,
        env: { HOME: home, TMPDIR: root, FIXTURE_LOG: fixtureLog, FIXTURE_FINGERPRINT: EXPECTED_SCHEMA_FINGERPRINT },
      },
    );
    clients.push(client);
    client.start();
    return client;
  };
  const params = (developerInstructions: string) => ({
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    developerInstructions,
  });

  let client = open();
  const thread = await startThread(client, params(INSTRUCTIONS));
  const turn = async (text: string, instructions: string | null) => {
    const result = await runTurn(client, thread, { text, timeoutMs: 15_000 });
    report.steps.push({ text, instructions, status: result.status });
  };
  await turn("one", INSTRUCTIONS);
  await turn("two", null);
  // A memory change reaches the held session through a resume, as `ThreadLifecycle` does.
  await runCauseEffect(client.request("thread/resume", { threadId: thread, ...params(CHANGED) }, (v) => v));
  await turn("three", CHANGED);
  await turn("compact-now", null);
  await turn("four", CHANGED);
  await turn("fail-now", null);
  await turn("five", CHANGED);
  await turn("six", null);
  // A new process opens the saved session, which may have lost its context.
  await runCauseEffect(client.stop());
  client = open();
  await runCauseEffect(client.request("thread/resume", { threadId: thread, ...params(CHANGED) }, (v) => v));
  await turn("seven", CHANGED);
  await turn("eight", null);
  await runCauseEffect(client.stop());

  report.prompts = await readJsonl<{ texts: string[] }>(log);
  assert.equal(report.steps.find((step) => step.text === "fail-now")?.status, "failed", "The failing turn fails.");
  assert.deepEqual(
    report.prompts.map((prompt) => prompt.texts),
    report.steps.map((step) => (step.instructions ? [step.instructions, step.text] : [step.text])),
    "The instructions come only when the session lacks them.",
  );

  // A memory edit keeps the instructions, so the session cache stays valid.
  const memoryClient = open(memoryLog);
  const memory = (id: string, text: string) => ({ id, text, origin: "manual" as const });
  // Enough memories that an update block is shorter than the full list, as in a real agent.
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
  const memoryThread = await startThread(memoryClient, { ...params(INSTRUCTIONS), memoryContext: first });
  const memoryTurn = (text: string) => runTurn(memoryClient, memoryThread, { text, timeoutMs: 15_000 });
  await memoryTurn("one");
  await memoryTurn("two");
  await runCauseEffect(
    memoryClient.request(
      "thread/resume",
      { threadId: memoryThread, ...params(INSTRUCTIONS), memoryContext: edited },
      (v) => v,
    ),
  );
  await memoryTurn("three");
  await memoryTurn("four");
  await memoryTurn("compact-now");
  await memoryTurn("five");
  await runCauseEffect(memoryClient.stop());

  report.memoryPrompts = await readJsonl<{ texts: string[] }>(memoryLog);
  const [one = [], two, three = [], four, compact, five = []] = report.memoryPrompts.map((prompt) => prompt.texts);
  const [oneMemories = "", oneText] = one.slice(1);
  const [threeUpdate = ""] = three;
  const fiveMemories = five[1] ?? "";
  assert.equal(one[0], INSTRUCTIONS, "memory: the first turn has the instructions.");
  assert.ok(oneMemories.startsWith("<openbot_saved_memories>"), "memory: the first turn has all memories.");
  assert.ok(!oneMemories.includes("Kraków"), "memory: the first block has the first list.");
  assert.equal(oneText, "one", "memory: the user text comes last.");
  assert.deepEqual(two, ["two"], "memory: an unchanged list sends no block.");
  assert.equal(three.length, 2, "memory: the edit sends one block and no instructions.");
  assert.ok(threeUpdate.startsWith("<openbot_saved_memories_update>"), "memory: the edit sends an update block.");
  assert.ok(
    threeUpdate.includes("Kraków") && !threeUpdate.includes("short answers"),
    "memory: the update has only the change.",
  );
  assert.deepEqual(four, ["four"], "memory: the update is sent once.");
  assert.deepEqual(compact, ["compact-now"], "memory: the compacting turn sends no block.");
  assert.equal(five[0], INSTRUCTIONS, "memory: after a compaction, the instructions come again.");
  assert.ok(
    fiveMemories.startsWith("<openbot_saved_memories>") &&
      fiveMemories.includes("short answers") &&
      fiveMemories.includes("Kraków"),
    "memory: after a compaction, the turn has all memories again.",
  );
  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
