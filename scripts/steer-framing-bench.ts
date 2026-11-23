import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, watch } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { steerNoteFor } from "../src/backend/agent/queue-controls";
import { resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getRecord, getString } from "../src/backend/protocol";
import { observedQuery, startClaudeAgent } from "./claude-agent-harness";

type Provider = Extract<AgentProviderId, "claude" | "codex">;
type Event = { at: number; kind: "tool" | "text"; detail: string };

const OUT = resolve(import.meta.dirname, "../.openbot-build/steer-framing-bench");
const RUNTIMES = join(homedir(), "Library/Application Support/OpenBot/provider-runtimes");
const CLAUDE_BIN = process.env.STEER_BENCH_CLAUDE ?? join(RUNTIMES, "claude/darwin-arm64/2.1.330/bin/claude");
const CODEX_BIN = process.env.STEER_BENCH_CODEX ?? join(RUNTIMES, "codex/darwin-arm64/0.171.0/bin/codex");
const STEPS = 8;
const STEER_AFTER_STEP = 2;
const TURN_LIMIT_MS = 8 * 60_000;
const DIRECT_TASK = [
  `In the current folder, make ${STEPS} files named step-1.txt to step-${STEPS}.txt, in order.`,
  "Make each file with its own shell command, one command per tool call, in this form: `sleep 5 && echo <n> > step-<n>.txt`.",
  "Never combine two steps in one command. When all files exist, reply with one line that lists them.",
].join(" ");
const TASKS: Record<string, string> = {
  direct: DIRECT_TASK,
  subagent: `Give this job to one subagent with your subagent tool, and wait for it to finish. The job: ${DIRECT_TASK}`,
  script: `Write a shell script run.sh that makes ${STEPS} files named step-1.txt to step-${STEPS}.txt, in order, with \`sleep 5\` before each file. Then run it in the foreground with one command and wait for it. When all files exist, reply with one line that lists them.`,
};
const TASK = TASKS[process.env.STEER_BENCH_TASK ?? "direct"] ?? DIRECT_TASK;
const STEER =
  "Change of plan: give the files that you have not made yet the .md extension, not .txt. Which step are you on?";

const label = process.argv[2] ?? "run";
const providers = (process.env.STEER_BENCH_PROVIDERS ?? "claude,codex")
  .split(",")
  .filter((value): value is Provider => value === "claude" || value === "codex");
const repeats = Number(process.env.STEER_BENCH_REPEATS ?? "2");
const models: Record<Provider, string> = {
  claude: process.env.STEER_BENCH_CLAUDE_MODEL ?? "claude-sonnet-5-5",
  codex: process.env.STEER_BENCH_CODEX_MODEL ?? "gpt-6-luna",
};

function steerInput(provider: Provider): string {
  const note = steerNoteFor(provider, { kind: "user" }, STEER);
  return note ? `${note}\n${STEER}` : STEER;
}

function waitForFile(dir: string, name: string, done: Promise<unknown>): Promise<boolean> {
  return new Promise((resolveWait) => {
    if (existsSync(join(dir, name))) return resolveWait(true);
    const watcher = watch(dir, () => {
      if (!existsSync(join(dir, name))) return;
      watcher.close();
      resolveWait(true);
    });
    void done.finally(() => {
      watcher.close();
      resolveWait(false);
    });
  });
}

async function runClaude(dir: string, events: Event[], steered: { at: number }): Promise<string[]> {
  const createQuery = observedQuery((message) => {
    if (message.type === "assistant" && !message.parent_tool_use_id) {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim())
          events.push({ at: Date.now(), kind: "text", detail: block.text });
        if (block.type === "tool_use")
          events.push({ at: Date.now(), kind: "tool", detail: JSON.stringify(block.input).slice(0, 200) });
      }
    }
    if (message.type === "result") {
      const taken = JSON.stringify(message.user_message_uuids ?? message.user_message_uuid ?? null);
      events.push({
        at: Date.now(),
        kind: "text",
        detail: `[result ${message.terminal_reason ?? message.subtype} ${taken}]`,
      });
    }
  });
  const cli = await runCauseEffect(resolveClaudeCli({ systemCandidates: [CLAUDE_BIN], bundledExecutable: null }));
  const agent = startClaudeAgent(cli, createQuery, { userSetup: false, requestTimeoutMs: TURN_LIMIT_MS });
  let threadId = "";
  try {
    threadId = await agent.startThread({ cwd: dir, model: models.claude, developerInstructions: "" });
    let finish: (status: string) => void = () => {};
    const finished = new Promise<string>((done) => {
      finish = done;
    });
    agent.client.on("notification", (notification) => {
      if (notification.method !== "turn/completed" || getString(notification.params, "threadId") !== threadId) return;
      const status = getString(getRecord(notification.params, "turn"), "status") ?? "unknown";
      events.push({ at: Date.now(), kind: "text", detail: `[openbot turn ${status}]` });
      finish(status);
    });
    const turnId = await runCauseEffect(
      agent.client.request(
        "turn/start",
        { threadId, model: models.claude, input: [{ type: "text", text: TASK }] },
        (value) => getString(getRecord(value, "turn"), "id") ?? "",
      ),
    );
    void waitForFile(dir, `step-${STEER_AFTER_STEP}.txt`, finished).then(async (ready) => {
      if (!ready) return;
      steered.at = Date.now();
      events.push({ at: Date.now(), kind: "text", detail: "[steer]" });
      await runCauseEffect(
        agent.client.request(
          "turn/steer",
          { threadId, expectedTurnId: turnId, input: [{ type: "text", text: steerInput("claude") }] },
          (value) => value,
        ),
      ).catch((error) => events.push({ at: Date.now(), kind: "text", detail: `[steer failed ${String(error)}]` }));
    });
    const limit = setTimeout(() => finish("timed out"), TURN_LIMIT_MS);
    await finished;
    clearTimeout(limit);
  } finally {
    await agent.stop();
  }
  return threadId ? claudeSteerFraming(dir, threadId) : [];
}

function claudeSteerFraming(dir: string, sessionId: string): string[] {
  const project = join(homedir(), ".claude/projects", realpathSync(dir).replace(/[^a-zA-Z0-9]/g, "-"));
  const transcript = join(project, `${sessionId}.jsonl`);
  if (!existsSync(transcript)) return [];
  const lines = readFileSync(transcript, "utf8")
    .split("\n")
    .filter((line) => line.includes("Change of plan"));
  void rm(project, { recursive: true, force: true });
  return lines.map((line) => line.slice(0, 1500));
}

function codexClient(child: ChildProcessWithoutNullStreams) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners: ((method: string, params: unknown) => void)[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined && message.method) {
      child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: "Not supported" } })}\n`);
      return;
    }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(JSON.stringify(message.error)));
      else waiter?.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message.method, message.params);
  });
  return {
    request(method: string, params: unknown): Promise<unknown> {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      return new Promise((resolveRequest, reject) => {
        pending.set(id, { resolve: resolveRequest, reject });
      });
    },
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ method })}\n`);
    },
    on(listener: (method: string, params: unknown) => void) {
      listeners.push(listener);
    },
  };
}

async function runCodex(dir: string, events: Event[], steered: { at: number }): Promise<string[]> {
  const child = spawn(CODEX_BIN, ["app-server"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  const client = codexClient(child);
  try {
    await client.request("initialize", {
      clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    client.notify("initialized");
    const thread = await client.request("thread/start", {
      cwd: dir,
      model: models.codex,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      ephemeral: true,
    });
    const threadId = getString(getRecord(thread, "thread"), "id") ?? "";
    let finish: () => void = () => {};
    const finished = new Promise<void>((done) => {
      finish = done;
    });
    client.on((method, params) => {
      const item = getRecord(params, "item");
      const type = getString(item, "type");
      const text = getString(item, "text")?.trim();
      if (method === "item/started" && type === "commandExecution")
        events.push({ at: Date.now(), kind: "tool", detail: (getString(item, "command") ?? "").slice(0, 200) });
      if (method === "item/completed" && type === "agentMessage" && text)
        events.push({ at: Date.now(), kind: "text", detail: text });
      if (method === "turn/completed") finish();
    });
    const started = await client.request("turn/start", { threadId, input: [{ type: "text", text: TASK }] });
    const turnId = getString(getRecord(started, "turn"), "id") ?? "";
    void waitForFile(dir, `step-${STEER_AFTER_STEP}.txt`, finished).then(async (ready) => {
      if (!ready) return;
      steered.at = Date.now();
      await client.request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: [{ type: "text", text: steerInput("codex") }],
      });
    });
    const limit = setTimeout(finish, TURN_LIMIT_MS);
    await finished;
    clearTimeout(limit);
    return [steerInput("codex")];
  } finally {
    child.kill();
  }
}

async function score(dir: string) {
  const names = (await readdir(dir)).filter((name) => /^step-\d+\.(txt|md)$/.test(name));
  const files = names
    .map((name) => ({ name, step: Number(name.match(/\d+/)?.[0]), at: statSync(join(dir, name)).mtimeMs }))
    .sort((left, right) => left.step - right.step);
  const firstMd = files.find((file) => file.name.endsWith(".md"))?.step ?? null;
  const lateTxt = files.filter((file) => file.name.endsWith(".txt") && file.step > STEER_AFTER_STEP + 1).length;
  return { files: files.map((file) => file.name), firstMd, lateTxt };
}

await mkdir(OUT, { recursive: true });
const results = [];
for (const provider of providers) {
  for (let attempt = 1; attempt <= repeats; attempt++) {
    const dir = await mkdtemp(join(tmpdir(), `steer-bench-${provider}-`));
    const events: Event[] = [];
    const steered = { at: 0 };
    const started = Date.now();
    let error: string | null = null;
    let framing: string[] = [];
    try {
      framing = provider === "claude" ? await runClaude(dir, events, steered) : await runCodex(dir, events, steered);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const scored = await score(dir);
    const afterSteer = events.filter((event) => steered.at > 0 && event.at >= steered.at);
    const result = {
      provider,
      model: models[provider],
      attempt,
      error,
      steered: steered.at > 0,
      ...scored,
      obeyed: scored.firstMd !== null && scored.lateTxt === 0,
      textAfterSteer: afterSteer.filter((event) => event.kind === "text").map((event) => event.detail),
      seconds: Math.round((Date.now() - started) / 1000),
      events: events.map((event) => ({ ...event, at: event.at - started })),
      steerAtSeconds: steered.at > 0 ? Math.round((steered.at - started) / 1000) : null,
      framing,
    };
    results.push(result);
    process.stdout.write(
      `${JSON.stringify({
        provider,
        attempt,
        obeyed: result.obeyed,
        firstMd: result.firstMd,
        lateTxt: result.lateTxt,
        files: result.files,
        error,
      })}\n`,
    );
    await rm(dir, { recursive: true, force: true });
  }
}
const report = join(OUT, `${label}.json`);
await writeFile(report, `${JSON.stringify({ label, task: TASK, steer: STEER, results }, null, 2)}\n`);
process.stdout.write(`${report}\n`);
