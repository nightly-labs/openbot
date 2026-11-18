// The shared parts of the Claude agent scripts (`claude-agent-smoke.ts`,
// `claude-prompt-settings-bench.ts`): a real `ClaudeAgentClient` on the real SDK, a temporary git
// workspace, and the clean-up of the CLI sessions of that workspace.
import { execFileSync } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";

/** The real SDK query. `onMessage` sees each message; `changeOptions` can change the query options. */
export function observedQuery(
  onMessage: (message: SDKMessage) => void,
  changeOptions: (options: Options) => Options = (options) => options,
) {
  return (params: Parameters<typeof query>[0]) => {
    const options = params.options ? changeOptions(params.options) : params.options;
    const real = query({ ...params, ...(options ? { options } : {}) });
    const iterate = real[Symbol.asyncIterator].bind(real);
    return Object.assign(real, {
      async *[Symbol.asyncIterator]() {
        const iterator = iterate();
        for (;;) {
          const next = await iterator.next();
          if (next.done) return;
          onMessage(next.value);
          yield next.value;
        }
      },
    });
  };
}

/** The names in an init message list, whose entries are strings or records with a `name`. */
export const messageNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry : (getString(entry, "name") ?? JSON.stringify(entry))))
    : [];

/**
 * A started client that accepts each tool approval, as a user who allows the step. `runTurn` waits
 * for `turn/completed` and fails on an error notification or a turn that did not complete.
 */
export function startClaudeAgent(
  cli: ClaudeCliInfo,
  createQuery: ReturnType<typeof observedQuery>,
  options: { userSetup: boolean; requestTimeoutMs: number },
) {
  const client = new ClaudeAgentClient(
    cli,
    createQuery,
    undefined,
    options.requestTimeoutMs,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => options.userSetup,
  );
  const completions = new Map<string, () => void>();
  const failures: string[] = [];
  client.on("notification", (notification: AppServerNotification) => {
    if (notification.method === "error") failures.push(JSON.stringify(notification.params));
    if (notification.method !== "turn/completed") return;
    // A turn can end as failed or interrupted with no error notification.
    const status = getString(getRecord(notification.params, "turn"), "status");
    if (status !== "completed") failures.push(`turn ended as ${status ?? "unknown"}`);
    const threadId = getString(notification.params, "threadId");
    if (threadId) completions.get(threadId)?.();
  });
  client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
  client.start();

  const startThread = (params: { cwd: string; model: string; developerInstructions: string }) =>
    runCauseEffect(
      client.request("thread/start", params, (value) => {
        const id = getString(getRecord(value, "thread"), "id");
        if (!id) throw new Error("thread/start returned no thread id.");
        return id;
      }),
    );
  const runTurn = async (threadId: string, model: string, prompt: string) => {
    const done = new Promise<void>((resolve) => completions.set(threadId, resolve));
    await runCauseEffect(
      client.request("turn/start", { threadId, model, input: [{ type: "text", text: prompt }] }, (value) => value),
    );
    await done;
    completions.delete(threadId);
    if (failures.length > 0) throw new Error(failures.splice(0).join("; "));
  };
  const stop = () => runCauseEffect(client.stop()).catch(() => undefined);
  return { client, startThread, runTurn, stop };
}

/**
 * A git workspace with two small files and one commit. With `origin`, the repository is its own
 * `origin` with `origin/HEAD` set, for skills that compare with the default branch.
 */
export async function makeGitWorkspace(workspace: string, origin = false): Promise<(...args: string[]) => string> {
  await writeFile(join(workspace, "notes.md"), "# Garden plan\n\nTomatoes by the wall.\n");
  await writeFile(join(workspace, "count.txt"), "42\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "OpenBot");
  git("config", "user.email", "e2e@openbot.invalid");
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  if (origin) {
    git("remote", "add", "origin", workspace);
    git("fetch", "-q", "origin");
    git("remote", "set-head", "origin", "-a");
  }
  return git;
}

/**
 * Removes the run's temporary folder and the CLI sessions of its workspaces. The CLI keeps each
 * session under ~/.claude/projects in a folder named after the workspace path; only the folders
 * of this run are removed.
 */
export async function removeRun(root: string): Promise<void> {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  const runName = basename(root);
  for (const entry of await readdir(projects).catch(() => []))
    if (entry.includes(runName)) await rm(join(projects, entry), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}
