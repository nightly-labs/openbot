// Measures what the Claude Code features that OpenBot agents do not use cost in each request. Runs
// the real Claude CLI with the user's Claude login, on Claude Haiku, through `ClaudeAgentClient`, in
// a temporary git workspace. `current` is the flag settings that `claude-client.ts` sends; each other
// variant adds settings to them, or takes them away, and runs these turns, each in a new session:
//   1. a one-word reply: the request prompt is the fixed prefix of every request (system prompt,
//      tools, skills) plus a short message,
//   2. a small task with tools, which makes several requests.
// Each variant runs with the user's Claude Code setup off (the default) and on.
// The report holds, for each run: the tools, skills, slash commands, MCP servers and plugins that the
// CLI reports in its `init` message, and the input, cache read and cache write tokens of each
// request. A variant that drops a feature shows it as a missing tool or skill.
// Costs a few dozen Haiku turns. `bun run bench:claude-prompt-settings`; `--variant=<name>` runs one
// variant; `--setup=off|on` runs one setup; `--model=<id>` replaces Claude Haiku. Writes .openbot-build/claude-prompt-settings-bench/report.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Options, query, type Settings } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { type ClaudeCliInfo, resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-prompt-settings-bench");
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT =
  "Read notes.md and count.txt. Then reply with one line: the title of notes.md and the number in count.txt. " +
  "Use the Read tool, not Bash.";

interface Variant {
  name: string;
  /** Settings added to the query's flag settings. */
  settings: Settings;
  /** Settings taken away from them. */
  remove?: ReadonlyArray<keyof Settings>;
  /** Tools added to the query's disallowed tools. */
  disallowedTools?: string[];
  /** Environment values added to the query's environment. */
  env?: Record<string, string>;
}

const SINGLE_SETTINGS = [
  "disableArtifact",
  "disableBundledSkills",
  "disableWorkflows",
  "disableRemoteControl",
  "disableClaudeAiConnectors",
] as const;

/** The skills that `claude-client.ts` turns off, for a variant that keeps the others listed in full. */
const UNFIT_SKILLS = [
  "deep-research",
  "design",
  "design-sync",
  "doctor",
  "fewer-permission-prompts",
  "keybindings-help",
  "loop",
  "plugin-authoring",
  "schedule",
  "send-to-project",
  "update-config",
  "workflow-authoring",
];

/**
 * Features that OpenBot agents keep, measured as references on top of `current`. On 2026-11-07:
 * `includeGitInstructions: false` saved 561 tokens, but takes away the commit and pull request rules.
 * The built-in agents saved 1,542, but take away `general-purpose`, `Explore`, `Plan` and `web-fetch`.
 * `ENABLE_TOOL_SEARCH=true` changed nothing on `claude-sonnet-5-5[1m]`: the CLI already defers the
 * OpenBot MCP tools there.
 */
const REFERENCES: Variant[] = [
  { name: "no-git-instructions", settings: { includeGitInstructions: false } },
  { name: "no-builtin-agents", settings: {}, env: { CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1" } },
  // Tool search on for each request, whatever the model's context window.
  { name: "tool-search-on", settings: {}, env: { ENABLE_TOOL_SEARCH: "true" } },
];

const VARIANTS: Variant[] = [
  { name: "current", settings: {} },
  {
    name: "without-openbot-flag-settings",
    settings: {},
    remove: ["attribution", "disableRemoteControl", "skillOverrides"],
  },
  ...SINGLE_SETTINGS.map((setting) => ({ name: setting, settings: { [setting]: true } })),
  { name: "all-five", settings: Object.fromEntries(SINGLE_SETTINGS.map((setting) => [setting, true])) },
  {
    name: "unfit-skills-off-only",
    settings: { skillOverrides: Object.fromEntries(UNFIT_SKILLS.map((skill) => [skill, "off"])) },
    remove: ["skillOverrides"],
  },
  ...REFERENCES,
];

interface RequestUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface InitReport {
  tools: string[];
  skills: string[];
  slashCommands: string[];
  mcpServers: string[];
  plugins: string[];
  agents: string[];
}

interface TurnReport {
  step: string;
  requests: RequestUsage[];
  /** input + cache read + cache write of the first request: the prompt that each request repeats. */
  firstRequestPrompt: number;
  /** The same sum over all requests of the turn. */
  totalPrompt: number;
  output: number;
  init: InitReport | null;
}

interface RunReport {
  variant: string;
  userSetup: boolean;
  settings: Settings;
  remove: ReadonlyArray<keyof Settings>;
  disallowedTools: string[];
  env: Record<string, string>;
  turns: TurnReport[];
  error?: string;
}

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const onlyVariant = argument("variant");
const onlySetup = argument("setup");
const MODEL = argument("model") ?? "claude-haiku-5-5";
const variants = onlyVariant ? VARIANTS.filter((variant) => variant.name === onlyVariant) : VARIANTS;
if (variants.length === 0) throw new Error(`Unknown variant: ${onlyVariant}`);
const setups = onlySetup ? [onlySetup === "on"] : [false, true];

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-claude-prompt-bench-")));
const cli = await runCauseEffect(resolveClaudeCli());
const report: {
  cli: Pick<ClaudeCliInfo, "executable" | "version" | "source">;
  model: string;
  runs: RunReport[];
} = { cli: { executable: cli.executable, version: cli.version, source: cli.source }, model: MODEL, runs: [] };

function startedThreadId(value: unknown): string {
  const id = getString(getRecord(value, "thread"), "id");
  if (!id) throw new Error("thread/start returned no thread id.");
  return id;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=OpenBot", "-c", "user.email=e2e@openbot.invalid", ...args], { cwd });
}

/**
 * The query's flag settings with the variant's changes. The client has no state folder here, so it
 * writes no sign-in settings file and the flag settings are an object.
 */
function withVariantSettings(options: Options, variant: Variant): Options {
  const current = options.settings;
  if (typeof current === "string") throw new Error("The query has a settings file; the bench expects an object.");
  const settings = { ...current, ...variant.settings };
  // A variant's skill overrides add to the current ones, unless it removes them.
  if (current?.skillOverrides && variant.settings.skillOverrides && !variant.remove?.includes("skillOverrides"))
    settings.skillOverrides = { ...current.skillOverrides, ...variant.settings.skillOverrides };
  for (const key of variant.remove ?? [])
    if (key !== "skillOverrides" || !variant.settings.skillOverrides) delete settings[key];
  return {
    ...options,
    settings,
    disallowedTools: [...(options.disallowedTools ?? []), ...(variant.disallowedTools ?? [])],
    env: { ...options.env, ...variant.env },
  };
}

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry : (getString(entry, "name") ?? JSON.stringify(entry))))
    : [];

for (const userSetup of setups) {
  for (const variant of variants) {
    const workspace = join(root, `${variant.name}-${userSetup ? "setup" : "plain"}`);
    mkdirSync(workspace, { recursive: true });
    await writeFile(join(workspace, "notes.md"), "# Garden plan\n\nTomatoes by the wall.\n");
    await writeFile(join(workspace, "count.txt"), "42\n");
    git(workspace, "init", "-q");
    git(workspace, "add", ".");
    git(workspace, "commit", "-q", "-m", "Start");

    let requests = new Map<string, RequestUsage>();
    let init: InitReport | null = null;
    const createQuery = (params: Parameters<typeof query>[0]) => {
      const options = params.options ? withVariantSettings(params.options, variant) : params.options;
      const real = query({ ...params, ...(options ? { options } : {}) });
      const iterate = real[Symbol.asyncIterator].bind(real);
      return Object.assign(real, {
        async *[Symbol.asyncIterator]() {
          const iterator = iterate();
          for (;;) {
            const next = await iterator.next();
            if (next.done) return;
            const message = next.value;
            if (message.type === "system" && message.subtype === "init") {
              init = {
                tools: [...message.tools].sort(),
                skills: names(message.skills).sort(),
                slashCommands: names(message.slash_commands).sort(),
                mcpServers: message.mcp_servers.map((server) => `${server.name}:${server.status}`).sort(),
                plugins: names(message.plugins).sort(),
                agents: names(message.agents).sort(),
              };
            }
            // A message repeats its request once per content block; the last copy has the final count.
            if (message.type === "assistant" && message.parent_tool_use_id === null) {
              const usage = message.message.usage;
              requests.set(message.message.id, {
                input: usage.input_tokens,
                cacheRead: usage.cache_read_input_tokens ?? 0,
                cacheWrite: usage.cache_creation_input_tokens ?? 0,
                output: usage.output_tokens,
              });
            }
            yield message;
          }
        },
      });
    };

    const client = new ClaudeAgentClient(
      cli,
      createQuery,
      undefined,
      120_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => userSetup,
    );
    const completions = new Map<string, () => void>();
    const failures: string[] = [];
    client.on("notification", (notification: AppServerNotification) => {
      if (notification.method === "error") failures.push(JSON.stringify(notification.params));
      if (notification.method !== "turn/completed") return;
      const threadId = getString(notification.params, "threadId");
      if (threadId) completions.get(threadId)?.();
    });
    // A tool call asks for approval. The bench accepts each one, as a user who allows the step.
    client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
    client.start();

    const run: RunReport = {
      variant: variant.name,
      userSetup,
      settings: variant.settings,
      remove: variant.remove ?? [],
      disallowedTools: variant.disallowedTools ?? [],
      env: variant.env ?? {},
      turns: [],
    };
    const threadParams = {
      cwd: workspace,
      model: MODEL,
      developerInstructions: "You are Ada, a careful assistant in an end-to-end benchmark.",
    };
    const runTurn = async (step: string, prompt: string) => {
      const threadId = await runCauseEffect(client.request("thread/start", threadParams, startedThreadId));
      requests = new Map();
      init = null;
      const done = new Promise<void>((resolve) => completions.set(threadId, resolve));
      await runCauseEffect(
        client.request(
          "turn/start",
          { threadId, model: MODEL, input: [{ type: "text", text: prompt }] },
          (value) => value,
        ),
      );
      await done;
      completions.delete(threadId);
      await runCauseEffect(client.releaseThread(threadId));
      if (failures.length > 0) throw new Error(`Turn ${step} failed: ${failures.join("; ")}`);
      const list = [...requests.values()];
      const prompted = (usage: RequestUsage) => usage.input + usage.cacheRead + usage.cacheWrite;
      run.turns.push({
        step,
        requests: list,
        firstRequestPrompt: list[0] ? prompted(list[0]) : 0,
        totalPrompt: list.reduce((total, usage) => total + prompted(usage), 0),
        output: list.reduce((total, usage) => total + usage.output, 0),
        init,
      });
    };

    try {
      await runTurn("reply", REPLY_PROMPT);
      await runTurn("task", TASK_PROMPT);
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      await runCauseEffect(client.stop()).catch(() => undefined);
    }
    report.runs.push(run);
    const reply = run.turns[0];
    const task = run.turns[1];
    process.stdout.write(
      `${variant.name.padEnd(26)} setup=${userSetup ? "on " : "off"} ` +
        `reply.prompt=${reply?.firstRequestPrompt ?? "-"} ` +
        `task.requests=${task?.requests.length ?? "-"} task.prompt=${task?.totalPrompt ?? "-"} ` +
        `tools=${reply?.init?.tools.length ?? "-"} skills=${reply?.init?.skills.length ?? "-"} ` +
        `agents=${reply?.init?.agents.length ?? "-"}` +
        `${run.error ? ` (failed: ${run.error})` : ""}\n`,
    );
  }
}

// The CLI keeps each session under ~/.claude/projects in a folder named after the workspace path.
// Only the folders of this run's temporary workspaces are removed.
const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
const runName = basename(root);
for (const entry of await readdir(projects).catch(() => [])) {
  if (entry.includes(runName)) await rm(join(projects, entry), { recursive: true, force: true });
}
await rm(root, { recursive: true, force: true });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.runs.some((run) => run.error) ? 1 : 0);
