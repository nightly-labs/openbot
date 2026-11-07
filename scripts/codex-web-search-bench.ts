// Bench of web search in an OpenBot Codex agent: Codex's own inline `web__run` against the deferred
// `openbot.web_search` tool, which runs each search in a side Codex thread (`AgentService.searchWeb`).
// Runs the real `codex app-server` with a copy of the user's Codex login (see `codex-agent-harness.ts`),
// on GPT-6 Luna. Each variant runs the same chat on one thread: three searches, with a plain request
// before and after each, because inline search results stay in the context of each later request.
// The correct versions come from the npm registry and nodejs.org at the start of the run.
//   inline   The settings that OpenBot sends: the agent searches with `web__run` in `exec`.
//   openbot  `web_search = "disabled"` and the OpenBot catalog of an agent with no web search of its
//            own: the agent finds `openbot.web_search` there, and each call runs one side search.
// On 2026-11-07 both used about the same tokens and `openbot` took twice as long, so Codex agents
// keep `web__run` and do not get `openbot.web_search`.
// Costs about 30 GPT-6 Luna requests for each run of each variant. `bun run bench:codex-web-search`;
// `--runs=<n>` (default 2), `--model=<id>`. Writes .openbot-build/codex-web-search-bench/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getRecord, getString, isRecord } from "../src/backend/protocol";
import {
  answerCatalogTool,
  makeCodexHome,
  makeGitWorkspace,
  openbotConfig,
  promptContents,
  type RequestUsage,
  removeRun,
  type SideSearch,
  sideSearch,
  startCodexAgent,
  toolCallParams,
} from "./codex-agent-harness";

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const MODEL = argument("model") ?? "gpt-6-luna";
const RUNS = Number(argument("runs") ?? 2);
const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-web-search-bench");
const VARIANTS = ["inline", "openbot"] as const;
type Variant = (typeof VARIANTS)[number];

/** Fetches JSON from `url` and reads one version from it with `read`. */
async function fetchVersion(url: string, read: (body: unknown) => string | null | undefined): Promise<string> {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "openbot-bench" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const version = read(await response.json());
  if (!version) throw new Error(`${url} names no version.`);
  return version.replace(/^[^0-9]*/, "");
}

const latestNpmVersion = (name: string) =>
  fetchVersion(`https://registry.npmjs.org/${name}/latest`, (body) =>
    isRecord(body) ? getString(body, "version") : undefined,
  );
const latestNodeLts = () =>
  fetchVersion("https://nodejs.org/dist/index.json", (body) => {
    const release = Array.isArray(body) ? body.find((entry) => isRecord(entry) && entry.lts) : undefined;
    return isRecord(release) ? getString(release, "version") : undefined;
  });

const QUESTIONS = [
  {
    prompt: "Search the web: what is the latest version of the typescript package on npm?",
    answer: latestNpmVersion("typescript"),
  },
  {
    prompt: "Search the web: what is the latest release version of the Bun JavaScript runtime?",
    answer: latestNpmVersion("bun"),
  },
  { prompt: "Search the web: what is the latest Node.js LTS version?", answer: latestNodeLts() },
];
const REPLY_FORMAT = " Reply with the version number and one source URL only.";
const PLAIN = "Reply with OK only.";

interface TurnLog {
  prompt: string;
  expected?: string;
  correct?: boolean;
  reply: string;
  items: string[];
  requests: RequestUsage[];
  searches: SideSearch[];
  ms: number;
  error?: string;
}

interface Totals {
  agentRequests: number;
  agentInput: number;
  agentCached: number;
  agentOutput: number;
  sideRequests: number;
  sideInput: number;
  sideCached: number;
  sideOutput: number;
  input: number;
  uncached: number;
  output: number;
  correct: number;
  ms: number;
}

/** True when `reply` names `version` as a whole version, not as the start of a longer one. */
function names(reply: string, version: string): boolean {
  const escaped = version.replaceAll(".", "\\.");
  return new RegExp(`(^|[^0-9.])v?${escaped}(?![0-9]|\\.[0-9])`).test(reply);
}

function itemLabel(item: DynamicRecord): string {
  const type = getString(item, "type") ?? "?";
  const tool = getString(item, "tool");
  const called = tool === "tool_call" ? getString(getRecord(item, "arguments"), "name") : undefined;
  return tool ? `${type}:${tool}${called ? `:${called}` : ""}` : type;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function totals(turns: TurnLog[]): Totals {
  const agent = turns.flatMap((turn) => turn.requests);
  const side = turns.flatMap((turn) => turn.searches.flatMap((search) => search.requests));
  const all = [...agent, ...side];
  return {
    agentRequests: agent.length,
    agentInput: sum(agent.map((usage) => usage.input)),
    agentCached: sum(agent.map((usage) => usage.cachedInput)),
    agentOutput: sum(agent.map((usage) => usage.output)),
    sideRequests: side.length,
    sideInput: sum(side.map((usage) => usage.input)),
    sideCached: sum(side.map((usage) => usage.cachedInput)),
    sideOutput: sum(side.map((usage) => usage.output)),
    input: sum(all.map((usage) => usage.input)),
    uncached: sum(all.map((usage) => usage.input - usage.cachedInput)),
    output: sum(all.map((usage) => usage.output)),
    correct: turns.filter((turn) => turn.correct).length,
    ms: sum(turns.map((turn) => turn.ms)),
  };
}

const expected = await Promise.all(QUESTIONS.map((question) => question.answer));
const cli = await runCauseEffect(resolveCodexCli());

async function runChat(variant: Variant, run: number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-web-search-bench-")));
  const workspace = join(root, "ws");
  await makeGitWorkspace(workspace);
  const home = await makeCodexHome(join(root, "home"));
  let current: TurnLog | null = null;
  // Pi has no web search of its own, so its catalog offers `openbot.web_search`.
  const catalog = variant === "inline" ? "codex" : "pi";
  const agent = await startCodexAgent(cli, home, workspace, async (request) => {
    if (request.method !== "item/tool/call" || !isRecord(request.params)) return undefined;
    const { text, success } = await answerCatalogTool(
      toolCallParams(request.params),
      async (query) => {
        const search = await sideSearch(cli, home, MODEL, query);
        current?.searches.push(search);
        return search;
      },
      catalog,
    );
    return { contentItems: [{ type: "inputText", text }], success };
  });
  agent.client.on("notification", (notification) => {
    if (!current || !isRecord(notification.params) || notification.method !== "item/completed") return;
    const item = getRecord(notification.params, "item");
    if (!item) return;
    current.items.push(itemLabel(item));
    if (getString(item, "type") === "agentMessage") current.reply = getString(item, "text") ?? "";
  });
  const turns: TurnLog[] = [];
  let webRun = false;
  try {
    const base = openbotConfig(agent.read);
    const config = variant === "inline" ? base : { ...base, web_search: "disabled" };
    const thread = await agent.startThread(workspace, MODEL, config, catalog);
    const prompts = [
      PLAIN,
      ...QUESTIONS.flatMap((question, index) => [question.prompt + REPLY_FORMAT, `${PLAIN} (${index + 1})`]),
    ];
    for (const prompt of prompts) {
      const question = QUESTIONS.findIndex((candidate) => prompt.startsWith(candidate.prompt));
      current = { prompt, reply: "", items: [], requests: [], searches: [], ms: 0 };
      const answer = expected[question];
      if (answer !== undefined) current.expected = answer;
      const started = Date.now();
      try {
        current.requests = await agent.runTurn(thread.id, prompt, 300_000);
      } catch (error) {
        current.error = error instanceof Error ? error.message : String(error);
      }
      current.ms = Date.now() - started;
      if (current.expected) current.correct = names(current.reply, current.expected);
      turns.push(current);
      const turn = current;
      process.stdout.write(
        `${variant.padEnd(8)} run=${run} requests=${turn.requests.length}+${turn.searches.flatMap((search) => search.requests).length} ` +
          `input=${sum(turn.requests.map((usage) => usage.input))} ` +
          `${turn.expected ? `correct=${turn.correct} ` : ""}reply=${JSON.stringify(turn.reply.slice(0, 70))}` +
          `${turn.error ? ` (failed: ${turn.error})` : ""}\n`,
      );
    }
    webRun = (await promptContents(thread.path)).tools.includes("web__run");
  } finally {
    await agent.stop();
    await removeRun(root);
  }
  return { variant, run, webRun, totals: totals(turns), turns };
}

const runs: Awaited<ReturnType<typeof runChat>>[] = [];
for (let run = 1; run <= RUNS; run++) {
  // Alternate the order, so neither variant always runs with a warmer prompt cache.
  const order = run % 2 === 1 ? VARIANTS : [...VARIANTS].reverse();
  for (const variant of order) runs.push(await runChat(variant, run));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function medianTotals(variant: Variant): Totals {
  const own = runs.filter((entry) => entry.variant === variant).map((entry) => entry.totals);
  const pick = (key: keyof Totals) => median(own.map((entry) => entry[key]));
  return {
    agentRequests: pick("agentRequests"),
    agentInput: pick("agentInput"),
    agentCached: pick("agentCached"),
    agentOutput: pick("agentOutput"),
    sideRequests: pick("sideRequests"),
    sideInput: pick("sideInput"),
    sideCached: pick("sideCached"),
    sideOutput: pick("sideOutput"),
    input: pick("input"),
    uncached: pick("uncached"),
    output: pick("output"),
    correct: pick("correct"),
    ms: pick("ms"),
  };
}

const medians = Object.fromEntries(VARIANTS.map((variant) => [variant, medianTotals(variant)]));

const failures = [
  ...runs
    .filter((entry) => entry.variant === "inline" && !entry.webRun)
    .map((entry) => `inline run ${entry.run}: no web__run`),
  ...runs
    .filter((entry) => entry.variant !== "inline" && entry.webRun)
    .map((entry) => `openbot run ${entry.run}: web__run declared`),
  ...runs.flatMap((entry) =>
    entry.turns.filter((turn) => turn.error).map((turn) => `${entry.variant} run ${entry.run}: ${turn.error}`),
  ),
  ...runs
    .filter(
      (entry) => entry.variant !== "inline" && entry.turns.some((turn) => turn.expected && turn.searches.length === 0),
    )
    .map((entry) => `openbot run ${entry.run}: a search turn called no openbot.web_search`),
];
const report = { codexVersion: cli.version, model: MODEL, expected, medians, failures, runs };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write("\nMedians:\n");
for (const variant of VARIANTS) {
  const entry = medianTotals(variant);
  process.stdout.write(
    `${variant.padEnd(8)} input=${entry.input} uncached=${entry.uncached} output=${entry.output} ` +
      `agent=${entry.agentRequests}/${entry.agentInput} side=${entry.sideRequests}/${entry.sideInput} ` +
      `correct=${entry.correct}/${QUESTIONS.length} ms=${entry.ms}\n`,
  );
}
process.stdout.write(
  `\n${failures.length ? `failed: ${failures.join("; ")}` : "passed"}\nReport: ${join(OUT, "report.json")}\n`,
);
process.exit(failures.length ? 1 : 0);
