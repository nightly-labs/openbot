// Runs the real ACP client against owned stdio agents. No account or model request is used.
// bun scripts/acp-audio-input-e2e.ts
// An agent that advertises audio input gets an attached MP3 as an audio block with unchanged bytes,
// and the path as text. An agent with no audio input, a video, and audio over the 20 MB prompt
// limit get the path only (#4210).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";

const out = resolve(import.meta.dirname, "../.openbot-build/acp-audio-input-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-acp-audio-"));
const MB = 1024 * 1024;

// The agent records the blocks of each prompt. `audio` selects its `promptCapabilities.audio`.
const childSource = String.raw`
const fs = require("node:fs");
const crypto = require("node:crypto");
const readline = require("node:readline");
const [audio, logPath] = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(logPath, JSON.stringify({ pid: process.pid, ...entry }) + "\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
log({ event: "start" });
let sessions = 0;
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize") return reply({ protocolVersion: 1,
    agentInfo: { name: "audio-fixture", version: "1" },
    agentCapabilities: { promptCapabilities: { image: true, audio: audio === "audio" } } });
  if (message.method === "session/new") return reply({ sessionId: "fixture-" + (++sessions) });
  if (message.method === "session/prompt") {
    log({ event: "prompt", blocks: message.params.prompt.map((block) => {
      if (block.type !== "audio") return { type: block.type, text: block.text };
      const bytes = Buffer.from(block.data, "base64");
      return { type: "audio", mimeType: block.mimeType, size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    }) });
    return reply({ stopReason: "end_turn" });
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Fixture does not implement " + message.method } });
});
`;

interface Block {
  type: string;
  text?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
}
interface CaseResult {
  name: string;
  agent: "audio" | "plain";
  files: { name: string; size: number; sha256: string }[];
  expectedAudio: string[];
  observed: Block[];
  passed: boolean;
}
const report: {
  passed: boolean;
  networkModelRequests: false;
  sourceHashes: Record<string, string>;
  cases: CaseResult[];
  cleanup: { pid: number; stopped: boolean }[];
  errors: string[];
} = { passed: false, networkModelRequests: false, sourceHashes: {}, cases: [], cleanup: [], errors: [] };

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function promptLog(path: string): Promise<Block[][]> {
  const content = await readFile(path, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "prompt")
    .map((entry) => entry.blocks);
}

async function childPids(paths: string[]): Promise<number[]> {
  const pids: number[] = [];
  for (const path of paths) {
    const content = await readFile(path, "utf8").catch(() => "");
    for (const line of content.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.event === "start") pids.push(entry.pid);
    }
  }
  return pids;
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return false;
    throw error;
  }
}

/** Subscribe before the request. The deadline bounds failure; it is not a sleep. */
async function turn(client: AgentClient, threadId: string, model: string, paths: string[]): Promise<void> {
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const done = new Promise<void>((resolveTurn, reject) => {
    finish = resolveTurn;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error("Turn completion deadline expired.")), 15_000);
  const listener = (event: AppServerNotification) => {
    if (getString(event.params, "threadId") !== threadId) return;
    if (event.method === "error") fail(new Error("Provider reported a turn error."));
    if (event.method === "turn/completed") {
      const status = isRecord(event.params) ? getString(event.params.turn, "status") : null;
      if (status === "completed") finish();
      else fail(new Error(`Turn ended with status ${status}.`));
    }
  };
  client.on("notification", listener);
  try {
    await Promise.all([
      runCauseEffect(
        client.request(
          "turn/start",
          {
            threadId,
            model,
            input: [
              { type: "text", text: "Listen to the attached files." },
              ...paths.map((path) => ({ type: "mention", name: path, path })),
            ],
          },
          (value) => value,
        ),
      ),
      done,
    ]);
  } finally {
    clearTimeout(timer);
    client.off("notification", listener);
  }
}

const logs = { audio: join(root, "audio.jsonl"), plain: join(root, "plain.jsonl") };
let client: AgentClient | undefined;
try {
  await writeFile(join(root, "fixture.cjs"), childSource);
  for (const path of ["scripts/acp-audio-input-e2e.ts", "src/backend/acp-client.ts"])
    report.sourceHashes[path] = hash(await readFile(resolve(import.meta.dirname, "..", path)));
  const agents = (["audio", "plain"] as const).map((agent) => ({
    id: `${agent}-fixture`,
    name: `${agent} fixture`,
    command: join(root, `${agent}-fixture`),
    args: [],
    env: [],
    usagePrompt: null,
  }));
  for (const agent of ["audio", "plain"] as const) {
    const args = [process.execPath, join(root, "fixture.cjs"), agent, logs[agent]];
    await writeFile(join(root, `${agent}-fixture`), `#!/bin/sh\nexec ${args.map(shellQuote).join(" ")}\n`);
    await chmod(join(root, `${agent}-fixture`), 0o700);
  }
  client = requireProviderDriver("acp").createClient(
    { executable: "acp", version: "fixture" },
    15_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [], customAgents: () => agents },
    undefined,
  );
  client.start();
  const threads: Record<"audio" | "plain", string> = { audio: "", plain: "" };
  for (const agent of ["audio", "plain"] as const) {
    const opened = await runCauseEffect(
      client.request("thread/start", { cwd: root, model: `${agent}-fixture/default` }, (value) => value),
    );
    const id = isRecord(opened) ? getString(opened.thread, "id") : null;
    assert.ok(id, "thread/start must return an id.");
    threads[agent] = id;
  }

  const cases: { name: string; agent: "audio" | "plain"; files: [string, number][]; audio: string[] }[] = [
    { name: "mp3 to an audio agent", agent: "audio", files: [["voice.mp3", 4096]], audio: ["voice.mp3"] },
    { name: "uppercase MP3 extension", agent: "audio", files: [["VOICE.MP3", 2048]], audio: ["VOICE.MP3"] },
    { name: "mp3 to an agent with no audio input", agent: "plain", files: [["voice.mp3", 4096]], audio: [] },
    { name: "mp4 video stays a path", agent: "audio", files: [["clip.mp4", 4096]], audio: [] },
    { name: "mp3 over the prompt limit", agent: "audio", files: [["long.mp3", 20 * MB + 1]], audio: [] },
    {
      name: "second mp3 over the prompt total",
      agent: "audio",
      files: [
        ["first.mp3", 12 * MB],
        ["second.mp3", 12 * MB],
      ],
      audio: ["first.mp3"],
    },
  ];
  for (const item of cases) {
    const files: CaseResult["files"] = [];
    const paths = [];
    for (const [name, size] of item.files) {
      const bytes = randomBytes(size);
      const path = join(root, name);
      await writeFile(path, bytes);
      files.push({ name, size, sha256: hash(bytes) });
      paths.push(path);
    }
    const before = (await promptLog(logs[item.agent])).length;
    await turn(client, threads[item.agent], `${item.agent}-fixture/default`, paths);
    const prompts = await promptLog(logs[item.agent]);
    assert.equal(prompts.length, before + 1, "Each turn must reach the agent once.");
    const observed = prompts.at(-1) ?? [];
    const audio = observed.filter((block) => block.type === "audio");
    const expected = item.audio.map((name) => files.find((file) => file.name === name));
    const passed =
      paths.every((path) => observed.some((block) => block.type === "text" && block.text?.includes(path))) &&
      audio.length === expected.length &&
      expected.every(
        (file, index) =>
          audio[index]?.mimeType === "audio/mpeg" &&
          audio[index]?.size === file?.size &&
          audio[index]?.sha256 === file?.sha256,
      );
    report.cases.push({ name: item.name, agent: item.agent, files, expectedAudio: item.audio, observed, passed });
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  try {
    if (client) await runCauseEffect(client.stop());
  } catch (error) {
    report.errors.push(`Client shutdown failed: ${String(error)}`);
  }
  report.cleanup = (await childPids(Object.values(logs))).map((pid) => ({ pid, stopped: !running(pid) }));
  const cleaned = report.cleanup.every((child) => child.stopped);
  if (!cleaned) report.errors.push("Owned child cleanup was not confirmed.");
  report.passed = report.errors.length === 0 && report.cases.length === 6 && report.cases.every((item) => item.passed);
  if (cleaned) await rm(root, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      passed: report.passed,
      report: join(out, "report.json"),
      cases: report.cases.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}`),
      errors: report.errors,
    })}\n`,
  );
  process.exitCode = report.passed ? 0 : 1;
}
