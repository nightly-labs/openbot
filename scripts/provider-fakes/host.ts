// The test side of the fake agents in `agents/`: install one as an executable, read its log, and drive
// the real `AgentClient` through a thread and a turn.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AgentClient } from "../../src/backend/agent-client";
import { runCauseEffect } from "../../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../../src/backend/protocol";
import type { CustomProviderCipher } from "../../src/main/custom-provider-store";

/**
 * Writes an executable that starts `agents/<agent>.ts` with the Bun that runs the test. `env` is set
 * for this executable only, so one test can run several fakes that act differently.
 */
export async function installFakeAgent(
  executable: string,
  agent: string,
  env: Readonly<Record<string, string>> = {},
): Promise<void> {
  const file = resolve(import.meta.dirname, "agents", `${agent}.ts`);
  const exports = Object.entries(env)
    .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
    .join("");
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, `#!/bin/sh\n${exports}exec "${process.execPath}" "${file}" "$@"\n`);
  await chmod(executable, 0o755);
}

/** Reads the JSON lines that a fake wrote with `logEntry`. A missing file is an empty log. */
export async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Replaces the operating system's secret storage, which exists only in Electron. */
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
}

export async function startThread(client: AgentClient, params: ThreadStartParams): Promise<string> {
  const response = await runCauseEffect(client.request("thread/start", params, (value) => value));
  const id = JSON.stringify(response).match(/"id":"([^"]+)"/)?.[1];
  if (!id) throw new Error("thread/start answers no thread id.");
  return id;
}

export interface TurnResult {
  /** The text of the completed agent items. */
  reply: string;
  /** The message of the turn's error notification, or null. */
  error: string | null;
  /** The status of `turn/completed`, such as `completed` or `interrupted`. */
  status: string | null;
}

/** A turn that has not completed by then fails, so that a run writes its report before the job timeout. */
const TURN_TIMEOUT_MS = 300_000;

/** Starts a turn and waits for its completion, also after an error. It fails when the agent exits. */
export async function runTurn(
  client: AgentClient,
  thread: string,
  options: { model?: string; text?: string; timeoutMs?: number } = {},
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
  // `turn/start` can fail first; then nothing awaits `done`.
  done.catch(() => undefined);
  try {
    const input = [{ type: "text", text: options.text ?? "hello", text_elements: [] }];
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: thread, ...(options.model ? { model: options.model } : {}), input },
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
