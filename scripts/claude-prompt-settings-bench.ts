import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_UNFIT_SKILLS } from "../src/backend/claude-client";
import { type ClaudeCliInfo, resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { makeGitWorkspace, messageNames, observedQuery, removeRun, startClaudeAgent } from "./claude-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-prompt-settings-bench");
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT =
  "Read notes.md and count.txt. Then reply with one line: the title of notes.md and the number in count.txt. " +
  "Use the Read tool, not Bash.";

interface Variant {
  name: string;
  settings: Settings;
  remove?: ReadonlyArray<keyof Settings>;
  disallowedTools?: string[];
  env?: Record<string, string>;
}

const SINGLE_SETTINGS = [
  "disableArtifact",
  "disableBundledSkills",
  "disableWorkflows",
  "disableRemoteControl",
  "disableClaudeAiConnectors",
] as const;

const REFERENCES: Variant[] = [
  { name: "no-git-instructions", settings: { includeGitInstructions: false } },
  { name: "no-builtin-agents", settings: {}, env: { CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1" } },
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
    settings: { skillOverrides: Object.fromEntries(CLAUDE_UNFIT_SKILLS.map((skill) => [skill, "off"])) },
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
  firstRequestPrompt: number;
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
} = {
  cli: { executable: cli.executable, version: cli.version, ...(cli.source ? { source: cli.source } : {}) },
  model: MODEL,
  runs: [],
};

function withVariantSettings(options: Options, variant: Variant): Options {
  const current = options.settings;
  if (typeof current === "string") throw new Error("The query has a settings file; the bench expects an object.");
  const settings = { ...current, ...variant.settings };
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

for (const userSetup of setups) {
  for (const variant of variants) {
    const workspace = join(root, `${variant.name}-${userSetup ? "setup" : "plain"}`);
    mkdirSync(workspace, { recursive: true });
    await makeGitWorkspace(workspace);

    let requests = new Map<string, RequestUsage>();
    let init: InitReport | null = null;
    const createQuery = observedQuery(
      (message) => {
        if (message.type === "system" && message.subtype === "init") {
          init = {
            tools: [...message.tools].sort(),
            skills: messageNames(message.skills).sort(),
            slashCommands: messageNames(message.slash_commands).sort(),
            mcpServers: message.mcp_servers.map((server) => `${server.name}:${server.status}`).sort(),
            plugins: messageNames(message.plugins).sort(),
            agents: messageNames(message.agents).sort(),
          };
        }
        if (message.type === "assistant" && message.parent_tool_use_id === null) {
          const usage = message.message.usage;
          requests.set(message.message.id, {
            input: usage.input_tokens,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheWrite: usage.cache_creation_input_tokens ?? 0,
            output: usage.output_tokens,
          });
        }
      },
      (options) => withVariantSettings(options, variant),
    );
    const agent = startClaudeAgent(cli, createQuery, { userSetup, requestTimeoutMs: 120_000 });

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
      const threadId = await agent.startThread(threadParams);
      requests = new Map();
      init = null;
      try {
        await agent.runTurn(threadId, MODEL, prompt);
      } catch (error) {
        throw new Error(`Turn ${step} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await runCauseEffect(agent.client.releaseThread(threadId));
      }
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
      await agent.stop();
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

await removeRun(root);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.runs.some((run) => run.error) ? 1 : 0);
