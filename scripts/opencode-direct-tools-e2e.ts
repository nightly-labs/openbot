// Runs the real `opencode` provider driver and the real OpenCode binary against a fake
// OpenAI-compatible server (`opencode-agent-harness.ts`), as a llama.cpp user has it (#12058). OpenCode
// gives MCP tools only as JavaScript in `execute` (Code Mode), and a small Qwen model wrote
// `<tool_call><function=tools.openbot.ask_user>` as reply text. A session on a model of an
// OpenAI-compatible custom endpoint must run in the `openbot-direct` mode: the request lists
// `openbot_ask_user` as a function tool and has no `execute`, a direct call reaches OpenBot, and the
// instructions name the direct tools. A model change to a built-in model must give the session its
// own mode back, and a change back must select the direct mode again.
// `OPENCODE_CLI=<opencode> bun scripts/opencode-direct-tools-e2e.ts`.
// Writes .openbot-build/opencode-direct-tools-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OPENCODE_DIRECT_TOOLS_MODE } from "../src/backend/opencode-config";
import { openCodeDatabasePath, readOpenCodeDatabase } from "../src/backend/opencode-usage";
import { getRecord, getString } from "../src/backend/protocol";
import { OPENCODE_MODEL, startOpenCodeHarness } from "./opencode-agent-harness";
import { runTurn } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-direct-tools-e2e");
/** A built-in model that OpenCode lists with no account. No turn runs on it. */
const BUILT_IN_MODEL = "opencode/big-pickle";
const QUESTION = "Which color?";
const ASK = "Ask me for a color.";

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  /** The function tools of the first request of the turn. */
  tools: string[];
  /** The size of that request body, in bytes. */
  requestBytes?: number;
  /** The OpenBot tool calls that reached OpenBot, as `namespace.tool`. */
  toolCalls: string[];
  turn?: { reply: string; error: string | null; status: string | null };
  /** The OpenCode agent of the session after each step. */
  modes: { step: string; mode: string | null }[];
  /** The instructions name the direct tools and not `execute`. */
  instructions?: { direct: boolean; execute: boolean };
  error?: string;
}

const report: Report = { passed: false, tools: [], toolCalls: [], modes: [] };
const harness = await startOpenCodeHarness("opencode-direct-tools-e2e");

/** The OpenCode agent that the session runs, from OpenCode's own database. */
function sessionMode(threadId: string): string | null {
  const path = openCodeDatabasePath(process.env);
  if (!path) throw new Error("OpenCode has no database file.");
  return readOpenCodeDatabase(path, (database) => {
    const row = database.prepare("SELECT agent FROM session_v2 WHERE id = ?").get(threadId);
    return typeof row?.agent === "string" ? row.agent : null;
  });
}

/** Waits until OpenCode saved `mode` for the session, or fails with the last mode it saw. */
async function expectMode(step: string, threadId: string, mode: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let seen = sessionMode(threadId);
  while (seen !== mode && Date.now() < deadline) {
    await new Promise((next) => setImmediate(next));
    seen = sessionMode(threadId);
  }
  report.modes.push({ step, mode: seen });
  assert.equal(seen, mode, `${step}: the session must run in ${mode}.`);
}

async function resume(client: AgentClient, threadId: string, model: string): Promise<void> {
  await runCauseEffect(client.request("thread/resume", { threadId, cwd: harness.workspace, model }, (value) => value));
}

try {
  report.openCodeVersion = harness.cli.version ?? "unknown";
  harness.script = (request) =>
    request.lastUser.includes(ASK) && request.toolResults === 0
      ? { tool: "openbot_ask_user", arguments: { question: QUESTION } }
      : { text: "done" };

  const client = harness.createClient();
  client.on("request", (request) => {
    if (request.method !== "item/tool/call") return;
    report.toolCalls.push(`${getString(request.params, "namespace")}.${getString(request.params, "tool")}`);
    client.respond(request.id, { success: true, contentItems: [{ type: "inputText", text: "Blue" }] });
  });
  client.start();

  const started = await runCauseEffect(
    client.request(
      "thread/start",
      {
        cwd: harness.workspace,
        model: OPENCODE_MODEL,
        dynamicTools: [
          {
            type: "namespace",
            name: "openbot",
            tools: [
              {
                type: "function",
                name: "ask_user",
                description: "Ask the user a question.",
                inputSchema: { type: "object", properties: { question: { type: "string" } } },
              },
            ],
          },
        ],
      },
      (value) => value,
    ),
  );
  const thread = getString(getRecord(started, "thread"), "id");
  if (!thread) throw new Error("thread/start answers no thread id.");
  await expectMode("start on a custom model", thread, OPENCODE_DIRECT_TOOLS_MODE);

  // OpenCode connects the MCP servers after the session starts, and a turn of the fake model takes
  // milliseconds. Short turns run until a request lists an OpenBot tool.
  const deadline = Date.now() + 60_000;
  let warmups = 0;
  while (!harness.requests.some((request) => request.tools.some((tool) => tool.startsWith("openbot_")))) {
    assert.ok(Date.now() < deadline, "OpenCode gave the model no OpenBot tool.");
    warmups += 1;
    const warmup = await runTurn(client, thread, { text: `Say ${warmups}.`, timeoutMs: 120_000 });
    assert.equal(warmup.error, null, `A warm-up turn failed: ${warmup.error}`);
  }

  const turn = await runTurn(client, thread, { text: ASK, timeoutMs: 120_000 });
  report.turn = turn;
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  const first = harness.requests.find((request) => request.lastUser.includes(ASK));
  assert.ok(first, "The endpoint got no request for the turn.");
  report.tools = first.tools;
  report.requestBytes = JSON.stringify(first.body).length;
  assert.ok(first.tools.includes("openbot_ask_user"), "openbot_ask_user must be a direct tool.");
  assert.ok(!first.tools.includes("execute"), "The direct mode must have no execute.");
  assert.deepEqual(report.toolCalls, ["openbot.ask_user"], "The direct call must reach OpenBot.");

  assert.ok(client.directMcpTools?.(OPENCODE_MODEL), "The client must report direct tools for the custom model.");
  assert.ok(!client.directMcpTools?.(BUILT_IN_MODEL), "A built-in model must keep Code Mode.");
  const agent: AgentSummary = {
    id: "agent-1",
    name: "Tester",
    title: "",
    description: "",
    notifications: false,
    provider: "opencode",
    model: OPENCODE_MODEL,
    reasoningEffort: "medium",
    threadId: thread,
    workspacePath: harness.workspace,
    preview: "",
    updatedAt: null,
    avatarSeed: "agent-1",
    avatarHue: null,
    avatarUrl: null,
  };
  const prompt = (directMcpTools: boolean) =>
    developerInstructions(agent, "/shared", [], "/automation", DEFAULT_AGENT_DEFAULTS, { directMcpTools });
  const direct = prompt(true);
  report.instructions = { direct: direct.includes("openbot_ask_user"), execute: direct.includes("In execute") };
  assert.ok(report.instructions.direct && !report.instructions.execute, "The instructions must name the direct tools.");
  assert.ok(prompt(false).includes("In execute"), "The Code Mode instructions must stay for other models.");

  await resume(client, thread, BUILT_IN_MODEL);
  await expectMode("change to a built-in model", thread, "build");
  await resume(client, thread, OPENCODE_MODEL);
  await expectMode("change back to the custom model", thread, OPENCODE_DIRECT_TOOLS_MODE);

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await harness.stop();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}\n`);
}
process.exit(report.passed ? 0 : 1);
