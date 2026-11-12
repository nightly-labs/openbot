// Runs the real `pi` provider driver over a fake Pi (`provider-fakes/agents/pi-instructions.ts`) to
// check that a turn with long developer instructions reaches the CLI (#3738). The instructions go
// to `--append-system-prompt` as a file, so the launch line stays short. Before the fix they went
// on the command line: on Windows the `.cmd` wrapper starts through `cmd.exe`, which stops at 8191
// characters, and the turn failed with `Pi process closed (1).` The fake logs its own command line
// and the instructions that arrive. Cases: a turn with instructions that fill the old limit, and a
// turn with none.
// `bun run test:pi-long-instructions`. Writes .openbot-build/pi-long-instructions-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-long-instructions-e2e");
/** Longer than the 8191-character command line of `cmd.exe`, with the rest of the launch line. */
const INSTRUCTIONS = `You are a careful assistant.\n${"Rule for the assistant: prefer the smallest change that solves the problem. ".repeat(200)}`;

interface LogEntry {
  event: string;
  commandLine?: string;
  promptIsFile?: boolean;
  promptLength?: number;
  text?: string;
}

interface Report {
  passed: boolean;
  withInstructions?: {
    reply: string;
    status: string | null;
    error: string | null;
    commandLineLength: number;
    promptIsFile: boolean;
    instructionsArrived: boolean;
  };
  withoutInstructions?: { reply: string; status: string | null; promptArgument: boolean };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-long-instructions-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

/**
 * Writes the fake Pi and its launcher, and returns the launcher path. On Windows the launcher is a
 * `.cmd`, like the Pi CLI that npm installs, so the spawn goes through `cmd.exe` exactly as in the
 * bug. Elsewhere it is a shell script.
 */
async function installFakePi(bin: string): Promise<string> {
  const fake = resolve(import.meta.dirname, "provider-fakes/agents/pi-instructions.ts");
  const env = { FAKE_LOG: join(root, "agent.jsonl"), FAKE_DIR: root };
  await mkdir(bin, { recursive: true });
  if (process.platform === "win32") {
    const wrapper = join(bin, "pi.cmd");
    const sets = Object.entries(env)
      .map(([name, value]) => `set "${name}=${value}"\r\n`)
      .join("");
    await writeFile(wrapper, `@echo off\r\n${sets}"${process.execPath}" "${fake}" %*\r\n`);
    return wrapper;
  }
  const wrapper = join(bin, "pi");
  const exports = Object.entries(env)
    .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
    .join("");
  await writeFile(wrapper, `#!/bin/sh\n${exports}exec "${process.execPath}" "${fake}" "$@"\n`);
  await chmod(wrapper, 0o755);
  return wrapper;
}

async function open(): Promise<AgentClient> {
  const executable = await installFakePi(join(root, "bin"));
  const client = requireProviderDriver("pi").createClient({ executable, version: "1.4.0", source: "managed" }, 10_000, {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
  });
  clients.push(client);
  client.start();
  return client;
}

const argvEntry = async (): Promise<LogEntry | undefined> =>
  (await readJsonl<LogEntry>(join(root, "agent.jsonl"))).find((entry) => entry.event === "argv");

try {
  const client = await open();

  // The instructions that fill the old limit arrive as one file, and the turn runs.
  const thread = await startThread(client, {
    cwd: root,
    developerInstructions: INSTRUCTIONS,
  });
  const turn = await runTurn(client, thread, { text: "summarize the rules", timeoutMs: 30_000 });
  const entry = await argvEntry();
  assert.ok(entry, "The fake Pi must log its command line.");
  assert.ok((entry.commandLine ?? "").length < 8191, "The launch line must stay under the cmd.exe limit.");
  assert.equal(entry.promptIsFile, true, "The instructions must arrive as a file path.");
  const path = (entry.commandLine ?? "").match(/--append-system-prompt (\S+)/u)?.[1];
  assert.ok(path, "The launch line must name the instructions file.");
  assert.equal(await readFile(path, "utf8"), INSTRUCTIONS, "The file must hold the full instructions.");
  assert.equal(turn.error, null);
  assert.equal(turn.status, "completed");
  assert.match(turn.reply, /long instructions ok/u);
  report.withInstructions = {
    reply: turn.reply,
    status: turn.status,
    error: turn.error,
    commandLineLength: (entry.commandLine ?? "").length,
    promptIsFile: entry.promptIsFile,
    instructionsArrived: true,
  };

  // A turn without instructions still runs, and no prompt argument reaches the CLI.
  const plain = await startThread(client, { cwd: root });
  const plainTurn = await runTurn(client, plain, { text: "say ok", timeoutMs: 30_000 });
  const entries = await readJsonl<LogEntry>(join(root, "agent.jsonl"));
  const last = entries.filter((entry2) => entry2.event === "argv").pop();
  assert.ok(last, "The fake Pi must log its command line.");
  assert.equal(plainTurn.error, null);
  assert.equal(plainTurn.status, "completed");
  assert.equal(last.promptLength, 0, "No prompt argument may reach the CLI without instructions.");
  report.withoutInstructions = {
    reply: plainTurn.reply,
    status: plainTurn.status,
    promptArgument: (last.promptLength ?? 0) > 0,
  };

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
