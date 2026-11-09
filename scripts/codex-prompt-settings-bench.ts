// Measures what the Codex features that OpenBot agents do not use cost in each request. Runs the
// real `codex app-server` with a copy of the user's Codex login (see `codex-agent-harness.ts`), on
// GPT-6 Luna, with OpenBot's thread configuration and dynamic tools, in a temporary git workspace.
// `current` is the configuration that `thread-lifecycle.ts` sends; `base` is the same without
// `codexPromptSettings`; each other variant adds settings to `current`. Each variant runs these
// turns, each in a new thread:
//   1. a one-word reply: its one request is the fixed prefix of every request plus a short message,
//   2. a small task with tools, which makes two or more requests.
// Each variant runs `--runs` times (default 3) and the report gives the median. The account's
// ChatGPT plugins load before each thread starts, so each run lists the same skills.
//
// The `user-set` setup writes a `config.toml` that sets `features.tool_suggest` and enables
// `openai-docs`, and checks that OpenBot keeps both. Both setups check, from the rollout file of the
// reply thread, that `current` drops `request_plugin_install` and the unfit skills, and keeps
// `web__run` and all other skills.
//
// Costs a few dozen GPT-6 Luna turns. `bun run bench:codex-prompt-settings`; `--variant=<name>` runs
// one variant; `--runs=<n>`; `--model=<id>`. Writes .openbot-build/codex-prompt-settings-bench/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { CODEX_UNFIT_SKILLS, codexPromptSettings } from "../src/backend/agent/codex-prompt-settings";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type CodexAgent,
  listsSkill,
  makeCodexHome,
  makeGitWorkspace,
  openbotConfig,
  type PromptContents,
  promptContents,
  type RequestUsage,
  removeRun,
  startCodexAgent,
} from "./codex-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-prompt-settings-bench");
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT =
  "Read notes.md and count.txt with one shell command. Then reply with one line: the title of notes.md and the number in count.txt.";
const USER_CONFIG = [
  "[features]",
  "tool_suggest = true",
  "",
  "[[skills.config]]",
  'name = "openai-docs"',
  "enabled = true",
  "",
].join("\n");

interface Variant {
  name: string;
  /** False leaves out `codexPromptSettings`. */
  promptSettings: boolean;
  /** Settings added to the thread configuration. */
  config: DynamicRecord;
}

/**
 * Features measured as references on top of `current`. On 2026-11-07 the user kept the skill
 * descriptions, image generation and Codex's own web search (`bun run bench:codex-web-search`).
 */
const REFERENCES: Variant[] = [
  { name: "web-search-off", promptSettings: true, config: { web_search: "disabled" } },
  { name: "omit-skill-descriptions", promptSettings: true, config: { "features.omit_skill_descriptions": true } },
  { name: "image-generation-off", promptSettings: true, config: { "features.image_generation": false } },
];

const VARIANTS: Variant[] = [
  { name: "base", promptSettings: false, config: {} },
  { name: "current", promptSettings: true, config: {} },
  ...REFERENCES,
];

interface TurnReport {
  step: string;
  requests: RequestUsage[];
  /** Input tokens of the first request: the prompt that each request repeats. */
  firstRequestInput: number;
  /** Input tokens over all requests of the turn. */
  totalInput: number;
}

interface RunReport {
  variant: string;
  setup: "plain" | "user-set";
  run: number;
  turns: TurnReport[];
  error?: string;
}

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const onlyVariant = argument("variant");
const RUNS = Number(argument("runs") ?? 3);
const MODEL = argument("model") ?? "gpt-6-luna";
const variants = onlyVariant ? VARIANTS.filter((variant) => variant.name === onlyVariant) : VARIANTS;
if (variants.length === 0) throw new Error(`Unknown variant: ${onlyVariant}`);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-codex-prompt-bench-")));
const cli = await runCauseEffect(resolveCodexCli());
const report: {
  codexVersion: string;
  model: string;
  runs: RunReport[];
  medians: Array<{ variant: string; setup: string; reply: number; task: number; taskRequests: number }>;
  checks: Record<string, string>;
  /** The listing lines of the reply request that `current` drops. */
  dropped: Record<string, string[]>;
  passed: boolean;
  error?: string;
} = { codexVersion: cli.version, model: MODEL, runs: [], medians: [], checks: {}, dropped: {}, passed: false };

async function runVariant(
  agent: CodexAgent,
  workspace: string,
  variant: Variant,
  setup: RunReport["setup"],
  run: number,
) {
  const config = { ...openbotConfig(agent.read, variant.promptSettings), ...variant.config };
  const result: RunReport = { variant: variant.name, setup, run, turns: [] };
  let contents: PromptContents | null = null;
  try {
    for (const [step, prompt] of [
      ["reply", REPLY_PROMPT],
      ["task", TASK_PROMPT],
    ] as const) {
      const thread = await agent.startThread(workspace, MODEL, config);
      const requests = await agent.runTurn(thread.id, prompt);
      if (step === "reply") contents = await promptContents(thread.path);
      result.turns.push({
        step,
        requests,
        firstRequestInput: requests[0]?.input ?? 0,
        totalInput: requests.reduce((total, usage) => total + usage.input, 0),
      });
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  report.runs.push(result);
  const [reply, task] = result.turns;
  process.stdout.write(
    `${variant.name.padEnd(24)} ${setup.padEnd(8)} run=${run} reply=${reply?.firstRequestInput ?? "-"} ` +
      `task.requests=${task?.requests.length ?? "-"} task=${task?.totalInput ?? "-"}` +
      `${result.error ? ` (failed: ${result.error})` : ""}\n`,
  );
  return contents;
}

const setups: Array<{ setup: RunReport["setup"]; config: string; variants: Variant[]; runs: number }> = [
  { setup: "plain", config: "", variants, runs: RUNS },
  // One run is enough to check what OpenBot keeps of the user's settings.
  {
    setup: "user-set",
    config: USER_CONFIG,
    variants: variants.filter((variant) => variant.name === "base" || variant.name === "current"),
    runs: 1,
  },
];

try {
  for (const { setup, config, variants: setupVariants, runs } of setups) {
    if (setupVariants.length === 0) continue;
    const home = await makeCodexHome(join(root, `home-${setup}`), config);
    const workspace = join(root, `workspace-${setup}`);
    await makeGitWorkspace(workspace);
    const agent = await startCodexAgent(cli, home, workspace);
    const contents = new Map<string, PromptContents | null>();
    try {
      for (let run = 1; run <= runs; run++)
        for (const variant of setupVariants) {
          const found = await runVariant(agent, workspace, variant, setup, run);
          if (run === 1) contents.set(variant.name, found);
        }
    } finally {
      await agent.stop();
    }

    for (const variant of setupVariants) {
      const runsOf = report.runs.filter((run) => run.variant === variant.name && run.setup === setup && !run.error);
      if (runsOf.length === 0) continue;
      report.medians.push({
        variant: variant.name,
        setup,
        reply: median(runsOf.map((run) => run.turns[0]?.firstRequestInput ?? 0)),
        task: median(runsOf.map((run) => run.turns[1]?.totalInput ?? 0)),
        taskRequests: median(runsOf.map((run) => run.turns[1]?.requests.length ?? 0)),
      });
    }

    const base = contents.get("base");
    const current = contents.get("current");
    if (!base || !current) continue;
    const settings = codexPromptSettings(agent.read);
    if (setup === "plain") {
      assert.ok(
        base.tools.includes("request_plugin_install"),
        `Codex ${cli.version} declares no request_plugin_install.`,
      );
      assert.ok(!current.tools.includes("request_plugin_install"), "current still declares request_plugin_install.");
      assert.ok(current.tools.includes("web__run"), "current declares no web__run.");
      const listed = CODEX_UNFIT_SKILLS.filter((skill) => listsSkill(base.context, skill));
      assert.ok(listed.includes("openai-docs"), "base lists no openai-docs skill.");
      for (const skill of listed) assert.ok(!listsSkill(current.context, skill), `current still lists ${skill}.`);
      report.checks.plain = `request_plugin_install and ${listed.join(", ")} dropped; web__run kept`;
    } else {
      assert.ok(!("features.tool_suggest" in settings), "OpenBot overrides the user's tool_suggest.");
      assert.deepEqual(
        settings["skills.config"]?.[0],
        { name: "openai-docs", enabled: true },
        "The user's skill entry is lost.",
      );
      assert.ok(current.tools.includes("request_plugin_install"), "The user's tool_suggest is not kept.");
      assert.ok(listsSkill(current.context, "openai-docs"), "The user's openai-docs entry is not kept.");
      for (const skill of CODEX_UNFIT_SKILLS.filter((name) => name !== "openai-docs" && listsSkill(base.context, name)))
        assert.ok(!listsSkill(current.context, skill), `current still lists ${skill}.`);
      report.checks["user-set"] = "tool_suggest and openai-docs kept; other unfit skills dropped";
    }
    // Only the unfit skills leave the listing. A skill line is `- <name>: <description>`; the skill
    // root lines (- `r4` = ...) are numbered again when a root loses all its skills.
    const skillNames = (context: string) =>
      context
        .split("\n")
        .filter((line) => line.startsWith("- ") && !line.startsWith("- `") && line.includes(": "))
        .map((line) => line.slice(2, line.indexOf(": ")));
    const kept = new Set(skillNames(current.context));
    report.dropped[setup] = skillNames(base.context).filter((name) => !kept.has(name));
    assert.deepEqual(
      [...report.dropped[setup]].sort(),
      CODEX_UNFIT_SKILLS.filter(
        (skill) => listsSkill(base.context, skill) && (setup === "plain" || skill !== "openai-docs"),
      ).sort(),
      "current drops other skills too.",
    );
  }
  report.passed = !report.runs.some((run) => run.error);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await removeRun(root);
}

process.stdout.write("\nMedians (input tokens):\n");
for (const row of report.medians)
  process.stdout.write(
    `${row.variant.padEnd(24)} ${row.setup.padEnd(8)} reply=${row.reply} task=${row.task} task.requests=${row.taskRequests}\n`,
  );
for (const [name, check] of Object.entries(report.checks)) process.stdout.write(`check ${name}: ${check}\n`);
if (report.error) process.stdout.write(`\nFailed: ${report.error}\n`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.passed ? 0 : 1);
