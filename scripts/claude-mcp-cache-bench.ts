// Measures the prompt cache cost of a slow MCP server in Claude agents, with and without the two
// changes that keep the request prefix stable:
//   - `ENABLE_TOOL_SEARCH=auto` in the user's Claude settings becomes `true` in the flag settings, so
//     the CLI keeps MCP tools deferred, also when they arrive after the first request;
//   - a resumed query waits for its MCP servers (`MCP_CONNECTION_NONBLOCKING=0`).
// Runs the real Claude CLI with the user's Claude login, on Claude Haiku, through `ClaudeAgentClient`,
// with one extra stdio MCP server that answers 3 s late (`claude-mcp-cache-bench-server.ts`). The
// `before` variant takes the change out of the query options; `after` is the current code.
// Scenarios:
//   tool-search-auto: the workspace sets `auto`; one session, four one-word turns.
//   tool-search-auto-50: the same with `auto:50`, which acts as `auto` on a 1M context.
//   resume-<mode>: the workspace sets <mode>; two turns, the query closes, the thread resumes, two turns.
// Costs about 32 one-word Haiku turns per run. `bun scripts/claude-mcp-cache-bench.ts --runs=2`;
// `--scenario=<name>` runs one scenario, `--delay=<ms>` sets the server delay, `--debug=<folder>` keeps CLI logs.
// Writes .openbot-build/claude-mcp-cache-bench/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getString } from "../src/backend/protocol";
import { makeGitWorkspace, observedQuery, removeRun, startClaudeAgent } from "./claude-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-mcp-cache-bench");
const SERVER = resolve(import.meta.dirname, "claude-mcp-cache-bench-server.ts");
const PROMPT = "Reply with the single word OK. Do not use any tool.";
const MODEL = "claude-haiku-5-5";
const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
/** `--delay=<ms>`: how late the bench MCP server answers `initialize`. */
const SLOW_SERVER_DELAY_MS = Number(argument("delay") ?? "3000");

interface Scenario {
  name: string;
  /** `ENABLE_TOOL_SEARCH` in the workspace's `.claude/settings.local.json`; none when undefined. */
  toolSearch: string | undefined;
  /** The query closes after this many turns and the thread resumes; no resume when undefined. */
  resumeAfter: number | undefined;
  turns: number;
  /** Takes the change out of the query options for the `before` variant. */
  before: (options: Options) => Options;
}

/** The flag settings without the `ENABLE_TOOL_SEARCH=true` that `claude-client.ts` adds. */
function withoutToolSearchOverride(options: Options): Options {
  const settings = options.settings;
  if (typeof settings !== "object" || !settings.env?.ENABLE_TOOL_SEARCH) return options;
  const { ENABLE_TOOL_SEARCH: _removed, ...env } = settings.env;
  const { env: _env, ...rest } = settings;
  return { ...options, settings: Object.keys(env).length > 0 ? { ...rest, env } : rest };
}

/** The query environment without the `MCP_CONNECTION_NONBLOCKING=0` of a resumed query. */
function withoutResumeWait(options: Options): Options {
  if (!options.env?.MCP_CONNECTION_NONBLOCKING) return options;
  const { MCP_CONNECTION_NONBLOCKING: _removed, ...env } = options.env;
  return { ...options, env };
}

const SCENARIOS: Scenario[] = [
  { name: "tool-search-auto", toolSearch: "auto", resumeAfter: undefined, turns: 4, before: withoutToolSearchOverride },
  // `auto:50` on a 200k context has the 100k threshold that `auto` has on a 1M context: the tools stay below it.
  {
    name: "tool-search-auto-50",
    toolSearch: "auto:50",
    resumeAfter: undefined,
    turns: 4,
    before: withoutToolSearchOverride,
  },
  { name: "resume-default", toolSearch: undefined, resumeAfter: 2, turns: 4, before: withoutResumeWait },
  { name: "resume-standard", toolSearch: "false", resumeAfter: 2, turns: 4, before: withoutResumeWait },
];

interface RequestUsage {
  turn: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface QueryStart {
  turn: number;
  resume: boolean;
  /** The CLI's MCP server states in its `init` message. */
  mcpServers: string[];
  /** The bench server's tools that the `init` message lists. */
  slowServerTools: number;
}

interface RunReport {
  scenario: string;
  variant: "before" | "after";
  run: number;
  requests: RequestUsage[];
  queries: QueryStart[];
  totals: { prompt: number; cacheWrite: number; cacheRead: number; input: number; output: number };
  /** Cache writes after the first request of the session, and after the resume. */
  laterCacheWrite: number;
  resumeCacheWrite: number | null;
  error?: string;
}

const runs = Number(argument("runs") ?? "1");
const onlyScenario = argument("scenario");
/** `--debug=<folder>` keeps a CLI debug log of each query there. */
const debugDirectory = argument("debug");
if (debugDirectory) mkdirSync(debugDirectory, { recursive: true });
const scenarios = onlyScenario ? SCENARIOS.filter((scenario) => scenario.name === onlyScenario) : SCENARIOS;
if (scenarios.length === 0) throw new Error(`Unknown scenario: ${onlyScenario}`);

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-claude-mcp-cache-bench-")));
const cli = await runCauseEffect(resolveClaudeCli());
const runReports: RunReport[] = [];
const report = {
  cli: { executable: cli.executable, version: cli.version },
  model: MODEL,
  slowServerDelayMs: SLOW_SERVER_DELAY_MS,
  runs: runReports,
};

async function runOnce(scenario: Scenario, variant: "before" | "after", run: number): Promise<RunReport> {
  const workspace = join(root, `${scenario.name}-${variant}-${run}`);
  mkdirSync(join(workspace, ".claude"), { recursive: true });
  if (scenario.toolSearch !== undefined)
    writeFileSync(
      join(workspace, ".claude", "settings.local.json"),
      JSON.stringify({ env: { ENABLE_TOOL_SEARCH: scenario.toolSearch } }),
    );
  await makeGitWorkspace(workspace);

  let turn = 0;
  const requests = new Map<string, RequestUsage>();
  const queries: QueryStart[] = [];
  const createQuery = observedQuery(
    (message) => {
      if (message.type === "system" && message.subtype === "init") {
        const query = queries.at(-1);
        if (query) {
          query.mcpServers = message.mcp_servers.map((server) => `${server.name}:${server.status}`).sort();
          query.slowServerTools = message.tools.filter((tool) => tool.startsWith("mcp__bench-catalog__")).length;
        }
      }
      // A message repeats its request once per content block; the last copy has the final count.
      if (message.type === "assistant" && message.parent_tool_use_id === null) {
        const usage = message.message.usage;
        requests.set(message.message.id, {
          turn,
          input: usage.input_tokens,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
          output: usage.output_tokens,
        });
      }
    },
    (options) => {
      queries.push({ turn: Math.max(turn, 1), resume: Boolean(options.resume), mcpServers: [], slowServerTools: 0 });
      const debugFile =
        debugDirectory && join(debugDirectory, `${scenario.name}-${variant}-${run}-${queries.length}.log`);
      const withServer: Options = {
        ...options,
        ...(debugFile ? { extraArgs: { ...options.extraArgs, "debug-file": debugFile } } : {}),
        mcpServers: {
          ...options.mcpServers,
          "bench-catalog": { type: "stdio", command: process.execPath, args: [SERVER, String(SLOW_SERVER_DELAY_MS)] },
        },
      };
      return variant === "before" ? scenario.before(withServer) : withServer;
    },
  );
  const agent = startClaudeAgent(cli, createQuery, { userSetup: false, requestTimeoutMs: 120_000 });
  const threadParams = {
    cwd: workspace,
    model: MODEL,
    developerInstructions: "You are Ada, a careful assistant in an end-to-end benchmark.",
  };
  const result: RunReport = {
    scenario: scenario.name,
    variant,
    run,
    requests: [],
    queries,
    totals: { prompt: 0, cacheWrite: 0, cacheRead: 0, input: 0, output: 0 },
    laterCacheWrite: 0,
    resumeCacheWrite: null,
  };
  try {
    const threadId = await agent.startThread(threadParams);
    for (turn = 1; turn <= scenario.turns; turn++) {
      if (scenario.resumeAfter !== undefined && turn === scenario.resumeAfter + 1) {
        await runCauseEffect(agent.client.releaseThread(threadId, true));
        await runCauseEffect(
          agent.client.request("thread/resume", { threadId, ...threadParams }, (value) => getString(value, "x")),
        );
      }
      await agent.runTurn(threadId, MODEL, PROMPT);
    }
    await runCauseEffect(agent.client.releaseThread(threadId));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await agent.stop();
  }
  result.requests = [...requests.values()];
  for (const usage of result.requests) {
    result.totals.prompt += usage.input + usage.cacheRead + usage.cacheWrite;
    result.totals.cacheWrite += usage.cacheWrite;
    result.totals.cacheRead += usage.cacheRead;
    result.totals.input += usage.input;
    result.totals.output += usage.output;
  }
  result.laterCacheWrite = result.requests.slice(1).reduce((total, usage) => total + usage.cacheWrite, 0);
  if (scenario.resumeAfter !== undefined)
    result.resumeCacheWrite = result.requests
      .filter((usage) => usage.turn > (scenario.resumeAfter ?? 0))
      .reduce((total, usage) => total + usage.cacheWrite, 0);
  return result;
}

for (let run = 1; run <= runs; run++) {
  for (const scenario of scenarios) {
    // Interleaved, so that a change in the Anthropic cache or the CLI over time hits both variants.
    // The order changes on each run: the first query of a pair can write a prefix that the second reads.
    const order = run % 2 === 1 ? (["before", "after"] as const) : (["after", "before"] as const);
    for (const variant of order) {
      const result = await runOnce(scenario, variant, run);
      report.runs.push(result);
      const writes = result.requests.map((usage) => `${usage.turn}:${usage.cacheWrite}`).join(" ");
      process.stdout.write(
        `${scenario.name.padEnd(18)} ${variant.padEnd(6)} run=${run} prompt=${result.totals.prompt} ` +
          `cacheWrite=${result.totals.cacheWrite} later=${result.laterCacheWrite} ` +
          `resume=${result.resumeCacheWrite ?? "-"} writes=[${writes}] ` +
          `queries=${result.queries.map((query) => `${query.resume ? "R" : "N"}${query.turn}:${query.slowServerTools}`).join(",")}` +
          `${result.error ? ` (failed: ${result.error})` : ""}\n`,
      );
    }
  }
}

await removeRun(root);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.runs.some((run) => run.error) ? 1 : 0);
