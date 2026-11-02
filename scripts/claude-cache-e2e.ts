// Measures how much of each Claude request reads the prompt cache after the events that OpenBot
// causes between turns. Runs the real Claude CLI with the user's Claude login, on Claude Haiku, in
// a temporary git workspace. Each variant runs these turns in one session:
//   1. the first turn of a new process,
//   2. a second turn in the same process (the baseline: it reads the cache),
//   3. a turn after an idle release, with no change in the workspace,
//   4. a turn after a file change in the git workspace and another idle release,
//   5. a turn with another effort,
//   6. a turn after `thread/resume` with other section-mates (a sidebar move): the list goes in the
//      turn, so the query stays and the prompt reads the cache,
//   7. a turn after `thread/resume` with other developer instructions (a profile edit),
//   8. the first turn of a new session in the same workspace (a runtime refresh),
//   9. and 10. two routine runs: each in an ephemeral session of its own, as `startRoutineThread`
//      starts them.
// The variants change the system prompt options the way `ClaudeAgentClient` could. Measured on
// 2026-10-24 with CLI 2.1.305: the variants keep the same cache as `current`. A routine session reads
// the prefix that another session of the agent wrote, so the 1-hour cache is the better one for runs
// less than an hour apart.
// Costs a few Haiku turns. `bun run test:claude-cache`; `--variant=<name>` runs one variant.
// Writes .openbot-build/claude-cache-e2e/report.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-cache-e2e");
const MODEL = "claude-haiku-5-5";
const PROMPT = "Reply with the single word OK. Do not use any tool.";

interface Variant {
  name: string;
  description: string;
  options: (options: Options) => Options;
}

const VARIANTS: Variant[] = [
  { name: "current", description: "The options that OpenBot sends now.", options: (options) => options },
  {
    name: "snapshot-on",
    description: "`--system-prompt-snapshot on`: the CLI records the system prompt and resumes with it.",
    options: (options) => ({ ...options, extraArgs: { ...options.extraArgs, "system-prompt-snapshot": "on" } }),
  },
  {
    name: "exclude-dynamic",
    description: "`excludeDynamicSections`: working directory, memory path and git status go to the first message.",
    options: (options) =>
      typeof options.systemPrompt === "object" &&
      !Array.isArray(options.systemPrompt) &&
      "preset" in options.systemPrompt
        ? { ...options, systemPrompt: { ...options.systemPrompt, excludeDynamicSections: true } }
        : options,
  },
  {
    name: "cache-5m",
    description: "`FORCE_PROMPT_CACHING_5M`: the CLI writes the cache for 5 minutes, at 1.25 times the input price.",
    options: (options) => ({ ...options, env: { ...options.env, FORCE_PROMPT_CACHING_5M: "1" } }),
  },
];

interface RequestUsage {
  id: string;
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** The part of the cache write that lives one hour. It costs twice the input price, not 1.25 times. */
  cacheWriteOneHour: number;
  output: number;
}

interface TurnReport {
  step: string;
  processes: number;
  requests: RequestUsage[];
  /** The share of the first request's prompt that came from the cache. */
  firstRequestCacheShare: number;
}

const only = process.argv.find((arg) => arg.startsWith("--variant="))?.slice("--variant=".length);
const variants = only ? VARIANTS.filter((variant) => variant.name === only) : VARIANTS;
if (variants.length === 0) throw new Error(`Unknown variant: ${only}`);

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-claude-cache-e2e-")));
const cli = await runCauseEffect(resolveClaudeCli());
const report: {
  cli: { executable: string; version: string };
  model: string;
  variants: Array<{ name: string; description: string; turns: TurnReport[]; error?: string }>;
  /** Whether the session transcripts hold the changed section-mates in a turn block. */
  teammatesBlockSent?: boolean;
} = { cli: { executable: cli.executable, version: cli.version }, model: MODEL, variants: [] };

function startedThreadId(value: unknown): string {
  const id = getString(getRecord(value, "thread"), "id");
  if (!id) throw new Error("thread/start returned no thread id.");
  return id;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=OpenBot", "-c", "user.email=e2e@openbot.invalid", ...args], { cwd });
}

for (const variant of variants) {
  const workspace = join(root, variant.name);
  mkdirSync(workspace, { recursive: true });
  await writeFile(join(workspace, "notes.md"), "# Notes\n");
  git(workspace, "init", "-q");
  git(workspace, "add", ".");
  git(workspace, "commit", "-q", "-m", "Start");

  // The real SDK, with the variant's options and a copy of each request's usage. A message repeats
  // its request once per content block; the last copy has the final count.
  let requests = new Map<string, RequestUsage>();
  let processes = 0;
  const createQuery = (params: Parameters<typeof query>[0]) => {
    processes += 1;
    const options = params.options ? variant.options(params.options) : params.options;
    const real = query({ ...params, ...(options ? { options } : {}) });
    const iterate = real[Symbol.asyncIterator].bind(real);
    return Object.assign(real, {
      async *[Symbol.asyncIterator]() {
        const iterator = iterate();
        for (;;) {
          const next = await iterator.next();
          if (next.done) return;
          const message = next.value;
          if (message.type === "assistant" && message.parent_tool_use_id === null) {
            const usage = message.message.usage;
            requests.set(message.message.id, {
              id: message.message.id,
              model: message.message.model,
              input: usage.input_tokens,
              cacheRead: usage.cache_read_input_tokens ?? 0,
              cacheWrite: usage.cache_creation_input_tokens ?? 0,
              cacheWriteOneHour: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
              output: usage.output_tokens,
            });
          }
          yield message;
        }
      },
    });
  };

  const client = new ClaudeAgentClient(cli, createQuery);
  const completions = new Map<string, () => void>();
  const failures: string[] = [];
  client.on("notification", (notification: AppServerNotification) => {
    if (notification.method === "error") failures.push(JSON.stringify(notification.params));
    if (notification.method !== "turn/completed") return;
    const threadId = getString(notification.params, "threadId");
    if (threadId) completions.get(threadId)?.();
  });
  client.start();

  const turns: TurnReport[] = [];
  const threadParams = {
    cwd: workspace,
    model: MODEL,
    developerInstructions: "You are Ada, a careful assistant in an end-to-end cache test.",
    sectionTeammates: { name: "Research", members: [{ id: "agent-1", name: "Ben", title: "Analyst" }] },
  };
  const runTurn = async (threadId: string, step: string, effort?: string) => {
    requests = new Map();
    const before = processes;
    const done = new Promise<void>((resolve) => completions.set(threadId, resolve));
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, model: MODEL, ...(effort ? { effort } : {}), input: [{ type: "text", text: PROMPT }] },
        (value) => value,
      ),
    );
    await done;
    completions.delete(threadId);
    if (failures.length > 0) throw new Error(`Turn ${step} failed: ${failures.join("; ")}`);
    const list = [...requests.values()];
    const first = list[0];
    const prompt = first ? first.input + first.cacheRead + first.cacheWrite : 0;
    turns.push({
      step,
      processes: processes - before,
      requests: list,
      firstRequestCacheShare: first && prompt > 0 ? Number((first.cacheRead / prompt).toFixed(3)) : 0,
    });
  };

  try {
    const threadId = await runCauseEffect(client.request("thread/start", threadParams, startedThreadId));
    await runTurn(threadId, "1 first turn");
    await runTurn(threadId, "2 same process");
    await runCauseEffect(client.releaseIdleThreads());
    await runTurn(threadId, "3 after idle release");
    await writeFile(join(workspace, "notes.md"), "# Notes\n\nThe agent changed this file.\n");
    await writeFile(join(workspace, "draft.md"), "A new file.\n");
    await runCauseEffect(client.releaseIdleThreads());
    await runTurn(threadId, "4 after file change and idle release");
    await runTurn(threadId, "5 another effort", "low");
    await runCauseEffect(
      client.request(
        "thread/resume",
        {
          ...threadParams,
          threadId,
          sectionTeammates: { name: "Research", members: [{ id: "agent-2", name: "Cleo", title: "Editor" }] },
        },
        (value) => value,
      ),
    );
    await runTurn(threadId, "6 after a section teammates change");
    await runCauseEffect(
      client.request(
        "thread/resume",
        { ...threadParams, threadId, developerInstructions: `${threadParams.developerInstructions} Be brief.` },
        (value) => value,
      ),
    );
    await runTurn(threadId, "7 after a developer instructions change");
    await runCauseEffect(client.releaseThread(threadId));
    const fresh = await runCauseEffect(client.request("thread/start", threadParams, startedThreadId));
    await runTurn(fresh, "8 new session (runtime refresh)");
    for (const step of ["9 routine run", "10 next routine run"]) {
      const routine = await runCauseEffect(
        client.request("thread/start", { ...threadParams, ephemeral: true, persistSession: false }, startedThreadId),
      );
      await runTurn(routine, step);
      await runCauseEffect(client.releaseThread(routine));
    }
    report.variants.push({ name: variant.name, description: variant.description, turns });
  } catch (error) {
    report.variants.push({
      name: variant.name,
      description: variant.description,
      turns,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await runCauseEffect(client.stop()).catch(() => undefined);
  }
}

// The CLI keeps each session under ~/.claude/projects in a folder named after the workspace path.
// Only the folders of this run's temporary workspaces are removed.
const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
const runName = basename(root);
let transcripts = "";
for (const entry of await readdir(projects).catch(() => [])) {
  if (!entry.includes(runName)) continue;
  for (const file of await readdir(join(projects, entry)).catch(() => []))
    if (file.endsWith(".jsonl")) transcripts += await readFile(join(projects, entry, file), "utf8");
  await rm(join(projects, entry), { recursive: true, force: true });
}
report.teammatesBlockSent = transcripts.includes("<openbot_section_teammates>") && transcripts.includes("Cleo");
await rm(root, { recursive: true, force: true });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const variant of report.variants) {
  process.stdout.write(`\n${variant.name}${variant.error ? ` (failed: ${variant.error})` : ""}\n`);
  for (const turn of variant.turns) {
    const first = turn.requests[0];
    process.stdout.write(
      `  ${turn.step.padEnd(40)} processes=${turn.processes} requests=${turn.requests.length} ` +
        `input=${first?.input ?? 0} read=${first?.cacheRead ?? 0} write=${first?.cacheWrite ?? 0} ` +
        `write1h=${first?.cacheWriteOneHour ?? 0} ` +
        `share=${turn.firstRequestCacheShare}\n`,
    );
  }
}
process.stdout.write(`\nteammatesBlockSent=${report.teammatesBlockSent}\n`);
process.exit(report.variants.some((variant) => variant.error) || !report.teammatesBlockSent ? 1 : 0);
