// Runs one real Grok agent session through `GrokAgentClient` with the settings that `grok-client.ts`
// sends, to check that an OpenBot agent can still do its work: a skill, the file and terminal
// tools, a subagent and a git commit. It uses a copy of the user's Grok login (see
// `grok-live-harness.ts`), Grok Build Fast and a temporary git workspace, and it checks that each
// request leaves out the features that OpenBot turns off. A second session sets
// `features.turn_summary = true` in `config.toml`, and checks that OpenBot keeps the user's value.
// Each session has a second short turn, so that a late turn summary falls in its session.
// Costs two Grok Build Fast sessions. `bun run smoke:grok-agent`; `--model=<id>` replaces Grok
// Build Fast. Writes .openbot-build/grok-agent-smoke/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveGrokCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { type GrokRequest, grokEnvironment, makeGitWorkspace, makeGrokHome, startGrokProxy } from "./grok-live-harness";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-agent-smoke");
const MODEL = process.argv.find((arg) => arg.startsWith("--model="))?.slice("--model=".length) ?? "grok-4.7-build-fast";
const WORD = "MARIGOLD-7";
const SKILL = `---
name: garden-word
description: Gives the garden word. Use it when a task asks for the garden word.
---

The garden word is ${WORD}.
`;
const TASK = [
  "Do these steps in order.",
  "1. Use the garden-word skill to get the garden word.",
  "2. Read count.txt with the read_file tool.",
  "3. Write result.txt with one line: the garden word, a space, and the number in count.txt.",
  "4. In the terminal, run: git add result.txt && git commit -m 'Add result'",
  "5. Spawn a subagent that reads notes.md and tells you its title.",
  "Then reply with one line: the garden word, the number and the title of notes.md.",
].join("\n");
const FOLLOW_UP = "Reply with the single word DONE.";
/** Tools that OpenBot turns off. */
const REMOVED = ["send_feedback", "workflow"];

interface SessionReport {
  name: string;
  reply: string;
  status: string | null;
  error: string | null;
  followUpStatus: string | null;
  requests: GrokRequest[];
  calls: string[];
  /** The methods of the requests that the agent sent to OpenBot, such as tool approvals. */
  serverRequests: string[];
  result?: string;
  commits?: string[];
}

const report: { passed: boolean; grokVersion?: string; model: string; sessions: SessionReport[]; error?: string } = {
  passed: false,
  model: MODEL,
  sessions: [],
};
const proxy = await startGrokProxy();
const saved = { ...process.env };
const roots: string[] = [];
const clients: AgentClient[] = [];

async function session(name: string, config: Record<string, boolean>, text: string): Promise<SessionReport> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-grok-agent-smoke-")));
  roots.push(root);
  const grokHome = await makeGrokHome(root, { config });
  mkdirSync(join(grokHome, "skills", "garden-word"), { recursive: true });
  writeFileSync(join(grokHome, "skills", "garden-word", "SKILL.md"), SKILL);
  const workspace = join(root, "workspace");
  makeGitWorkspace(workspace);
  process.env = grokEnvironment(root, grokHome, proxy.port);
  const cli = await runCauseEffect(resolveGrokCli({ bundledExecutable: process.env.GROK_CLI ?? null }));
  report.grokVersion = cli.version;
  const client = requireProviderDriver("grok").createClient(cli, 120_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  const serverRequests: string[] = [];
  // As the app does when the user allows a tool. The ACP client reads `accept`, not `acceptForSession`.
  client.on("request", (request) => {
    serverRequests.push(request.method);
    if (request.method === "item/permissions/requestApproval") {
      const permissions =
        isRecord(request.params) && isRecord(request.params.permissions) ? request.params.permissions : {};
      client.respond(request.id, { permissions, scope: "session" });
    } else if (request.method.endsWith("/requestApproval")) client.respond(request.id, { decision: "accept" });
    else client.respondError(request.id, { code: -32601, message: `The smoke does not answer ${request.method}.` });
  });
  client.start();
  const first = proxy.requests.length;
  const thread = await startThread(client, {
    cwd: workspace,
    model: MODEL,
    developerInstructions: "You are Ada, a careful assistant in an end-to-end smoke test.",
  });
  const turn = await runTurn(client, thread, { model: MODEL, text, timeoutMs: 300_000 });
  // Grok sends the turn summary after the turn ends. A second turn holds the session open until it
  // is sent, so that the requests of this session include it.
  const next = await runTurn(client, thread, { model: MODEL, text: FOLLOW_UP, timeoutMs: 120_000 });
  await proxy.idle();
  // Stop Grok before the next session changes the environment that the client reads at each spawn.
  await stopClients([client]);
  process.env = { ...saved };
  const requests = proxy.requests.slice(first);
  const main = requests.filter((request) => request.kind === "main");
  const result: SessionReport = {
    name,
    reply: turn.reply,
    status: turn.status,
    error: turn.error,
    followUpStatus: next.status,
    requests,
    // The last main request of the agent holds the whole history; a subagent's requests hold their own.
    calls: [...new Set(main.flatMap((request) => request.calls))],
    serverRequests,
  };
  try {
    result.result = readFileSync(join(workspace, "result.txt"), "utf8");
  } catch {
    // The agent did not write it; the check below fails.
  }
  result.commits = execFileSync("git", ["log", "--format=%s"], { cwd: workspace, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  report.sessions.push(result);
  return result;
}

try {
  const work = await session("work", {}, TASK);
  assert.equal(work.status, "completed", `The turn ended ${work.status}: ${work.error ?? ""}`);
  assert.equal(work.followUpStatus, "completed", `The second turn ended ${work.followUpStatus}.`);
  assert.match(work.result ?? "", new RegExp(`${WORD}\\s+42`), "result.txt has the garden word and the number.");
  assert.ok(work.commits?.includes("Add result"), "The agent committed result.txt.");
  assert.match(work.reply, new RegExp(WORD), "The reply has the garden word from the skill.");
  assert.match(work.reply, /Garden plan/i, "The reply has the title of notes.md.");
  for (const tool of ["read_file", "run_terminal_command", "spawn_subagent"])
    assert.ok(work.calls.includes(tool), `The agent called ${tool}; it called ${work.calls.join(", ")}.`);
  const declared = work.requests.filter((request) => request.kind === "main" && request.tools.length > 0);
  assert.ok(declared.length > 0, "The proxy saw the agent's requests.");
  for (const request of declared)
    for (const tool of REMOVED) assert.ok(!request.tools.includes(tool), `A request declares ${tool}.`);
  assert.ok(!work.requests.some((request) => request.kind === "summary"), "Grok wrote a turn summary.");

  // The user's own `config.toml` value wins over OpenBot's setting.
  const kept = await session("user-config", { "features.turn_summary": true }, "Reply with the single word OK.");
  assert.equal(kept.status, "completed", `The turn ended ${kept.status}: ${kept.error ?? ""}`);
  assert.equal(kept.followUpStatus, "completed", `The second turn ended ${kept.followUpStatus}.`);
  assert.ok(
    kept.requests.some((request) => request.kind === "summary"),
    "Grok did not write the turn summary that the user's config.toml turns on.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await stopClients(clients);
  process.env = { ...saved };
  proxy.close();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "Passed" : `Failed: ${report.error}`}\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.passed ? 0 : 1);
