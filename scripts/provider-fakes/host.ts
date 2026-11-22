import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MemoryContext } from "../../src/backend/agent/developer-instructions";
import type { AgentClient } from "../../src/backend/agent-client";
import { runCauseEffect } from "../../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../../src/backend/protocol";
import type { CustomProviderCipher } from "../../src/main/custom-provider-store";

export async function installFakeAgent(
  executable: string,
  agent: string,
  env: Readonly<Record<string, string>> = {},
): Promise<string> {
  const file = resolve(import.meta.dirname, "agents", `${agent}.ts`);
  const exports = Object.entries(env)
    .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
    .join("");
  await mkdir(dirname(executable), { recursive: true });
  if (process.platform === "win32") {
    const cmdPath = `${executable}.cmd`;
    const envLines = Object.entries(env).map(([name, value]) => `set "${name}=${value.replaceAll('"', '""')}"`);
    await writeFile(cmdPath, `@echo off\r\n${envLines.join("\r\n")}\r\n"${process.execPath}" "${file}" %*\r\n`);
    return cmdPath;
  }
  await writeFile(executable, `#!/bin/sh\n${exports}exec "${process.execPath}" "${file}" "$@"\n`);
  await chmod(executable, 0o755);
  return executable;
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export const xorCipher: CustomProviderCipher = {
  canPersist: () => true,
  encrypt: (value) => Buffer.from(Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a)),
  decrypt: (value) => Buffer.from(value.map((byte) => byte ^ 0x5a)).toString("utf8"),
};

export interface ThreadStartParams {
  cwd: string;
  model?: string;
  runtimeWorkspaceRoots?: string[];
  developerInstructions?: string;
  memoryContext?: MemoryContext;
}

export async function startThread(client: AgentClient, params: ThreadStartParams): Promise<string> {
  const response = await runCauseEffect(client.request("thread/start", params, (value) => value));
  const id = getString(getRecord(response, "thread"), "id");
  if (!id) throw new Error("thread/start answers no thread id.");
  return id;
}

export interface TurnResult {
  reply: string;
  error: string | null;
  status: string | null;
}

const TURN_TIMEOUT_MS = 300_000;

export async function runTurn(
  client: AgentClient,
  thread: string,
  options: { model?: string; effort?: string; text?: string; images?: readonly string[]; timeoutMs?: number } = {},
): Promise<TurnResult> {
  const result: TurnResult = { reply: "", error: null, status: null };
  let finished = false;
  let timer: NodeJS.Timeout | undefined;
  let notified: ((notification: AppServerNotification) => void) | undefined;
  let exited: ((error: Error) => void) | undefined;
  const done = new Promise<void>((finish, fail) => {
    notified = (notification) => {
      if (finished || getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "item/completed" && isRecord(notification.params)) {
        result.reply += getString(notification.params.item, "text") ?? "";
      }
      if (notification.method === "error") result.error = getString(notification.params, "message") ?? "error";
      if (notification.method === "turn/completed") {
        result.status = getString(getRecord(notification.params, "turn"), "status");
        finished = true;
        finish();
      }
    };
    client.on("notification", notified);
    exited = (error) => fail(new Error(`The agent exited before the turn completed: ${error.message}`));
    client.once("exit", exited);
    const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
    timer = setTimeout(() => fail(new Error(`The turn did not complete in ${timeoutMs / 1000} s.`)), timeoutMs);
  });
  done.catch(() => undefined);
  try {
    const input = [
      { type: "text", text: options.text ?? "hello", text_elements: [] },
      ...(options.images ?? []).map((path) => ({ type: "localImage", path })),
    ];
    await runCauseEffect(
      client.request(
        "turn/start",
        {
          threadId: thread,
          ...(options.model ? { model: options.model } : {}),
          ...(options.effort ? { effort: options.effort } : {}),
          input,
        },
        (value) => value,
      ),
    );
    await done;
    return result;
  } finally {
    finished = true;
    clearTimeout(timer);
    if (notified) client.off("notification", notified);
    if (exited) client.off("exit", exited);
  }
}

export async function stopClients(clients: readonly AgentClient[]): Promise<void> {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
}
