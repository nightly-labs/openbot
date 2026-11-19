// Measures the finish check (`src/backend/agent/finish-check.ts`) on labeled turn ends. Each case is
// the end of one agent turn: the user's request, the tool steps, the plan and the last answer. Its
// label says what a person would want next: "continue" (work that the agent can do now is missing)
// or "stop" (done, a question that only the user can answer, or blocked). Each case goes through
// the real `finishCheckPrompt` and `generateTextWithoutTools` path, on the model that the app uses for
// the check: the provider's default model at `withBackgroundEffort`, with the user's own Claude and
// Codex sign-ins.
// A false continue costs one extra turn that the user did not want; a missed continue leaves the
// user to write "continue", as before the check.
// `bun scripts/finish-check-bench.ts`; `--provider=claude|codex` runs one provider; `--runs=<n>`
// repeats each case (default 1). Writes .openbot-build/finish-check-bench/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentModelOption,
  agentProviderDescriptor,
  type ConversationPlan,
  type ConversationPlanStepStatus,
  type ConversationTraceStep,
  isReasoningEffort,
} from "@openbot/contracts/ipc";
import { Schema } from "effect";
import { withBackgroundEffort } from "../src/backend/agent/background-model";
import {
  type FinishCheckInput,
  FinishCheckResult,
  finishCheckGap,
  finishCheckPrompt,
} from "../src/backend/agent/finish-check";
import { generateTextWithoutTools, startToolless, stopToolless } from "../src/backend/agent/profile-generation";
import type { AgentClient } from "../src/backend/agent-client";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { cliPathEnvironment, resolveClaudeCli, resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import { extractJsonObject } from "../src/backend/structured-output";
import { observedQuery } from "./claude-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/finish-check-bench");
const TIMEOUT_MS = 120_000;

type Label = "continue" | "stop";
interface Case {
  name: string;
  label: Label;
  /** The verdict that fits best. A "stop" case is right with any verdict but "continue". */
  verdict: FinishCheckResult["verdict"];
  input: FinishCheckInput;
}

let stepCount = 0;
function tool(command: string, failed?: string): ConversationTraceStep {
  stepCount += 1;
  return {
    id: `step-${stepCount}`,
    kind: "tool",
    command,
    startedAt: "2026-11-18T10:00:00.000Z",
    endedAt: "2026-11-18T10:00:01.000Z",
    ...(failed ? { failed: true as const, error: failed } : {}),
  };
}
function plan(...steps: [string, ConversationPlanStepStatus][]): ConversationPlan {
  return { explanation: null, steps: steps.map(([text, status], index) => ({ id: `plan-${index}`, text, status })) };
}
function input(
  request: string,
  steps: ConversationTraceStep[],
  answer: string,
  extra: Partial<FinishCheckInput> = {},
): FinishCheckInput {
  return { request: [request], context: [], steps, plan: null, answer, continuations: 0, ...extra };
}

const CASES: Case[] = [
  // Work that the agent can do now is missing.
  {
    name: "partial-items",
    label: "continue",
    verdict: "continue",
    input: input(
      "Add a docstring to every public function in src/billing/ (there are 9 files).",
      [
        tool("ls src/billing"),
        tool("apply_patch src/billing/invoice.py"),
        tool("apply_patch src/billing/tax.py"),
        tool("apply_patch src/billing/refund.py"),
      ],
      "I added docstrings to invoice.py, tax.py and refund.py. The other 6 files follow the same pattern.",
    ),
  },
  {
    name: "says-next-step-and-stops",
    label: "continue",
    verdict: "continue",
    input: input(
      "Fix the failing login test and make sure the whole test suite passes.",
      [tool("npm test -- login", "1 failed: expected 200, got 401"), tool("apply_patch src/auth/session.ts")],
      "I found the cause: the session cookie used the wrong name. I changed it in session.ts. Next, I will run the test suite to confirm the fix.",
    ),
  },
  {
    name: "offers-requested-work",
    label: "continue",
    verdict: "continue",
    input: input(
      "Translate README.md into German, Spanish and Polish. Save each as README.<code>.md.",
      [tool("cat README.md"), tool("write README.de.md")],
      "Done with the German translation in README.de.md. Do you want me to also do the Spanish and Polish versions?",
    ),
  },
  {
    name: "unverified-build",
    label: "continue",
    verdict: "continue",
    input: input(
      "Upgrade the project to React 19 and make sure it still builds.",
      [tool("npm install react@19 react-dom@19"), tool("apply_patch src/index.tsx")],
      "I upgraded react and react-dom to 19 and moved index.tsx to createRoot. Everything should work now.",
    ),
  },
  {
    name: "failed-step-no-retry",
    label: "continue",
    verdict: "continue",
    input: input(
      "Download the CSV at data/source-url.txt, and give me the total of the amount column.",
      [
        tool("cat data/source-url.txt"),
        tool(
          "curl -sSf https://example.org/exports/sales.csv -o /tmp/sales.csv",
          "curl: (22) The requested URL returned error: 404",
        ),
      ],
      "The download failed with a 404 error.",
    ),
  },
  {
    name: "open-plan-steps",
    label: "continue",
    verdict: "continue",
    input: input(
      "Set up linting for this repository: add ESLint, a config, a lint script and fix all lint errors.",
      [tool("npm install -D eslint"), tool("write eslint.config.js"), tool("apply_patch package.json")],
      "ESLint is installed with a config and an npm run lint script.",
      {
        plan: plan(
          ["Install ESLint", "completed"],
          ["Add a config and a lint script", "completed"],
          ["Fix all lint errors", "pending"],
        ),
      },
    ),
  },
  {
    name: "status-of-running-work",
    label: "continue",
    verdict: "continue",
    input: input(
      "Run the database migration on the staging copy in ./staging.db and tell me how many rows moved.",
      [tool("bun scripts/migrate.ts --db ./staging.db &")],
      "The migration is running in the background now. It usually takes about a minute.",
    ),
  },
  {
    name: "half-of-a-list",
    label: "continue",
    verdict: "continue",
    input: input(
      "For each of these 5 URLs, check if it returns 200 and list the broken ones: /a /b /c /d /e on localhost:3000.",
      [
        tool("curl -s -o /dev/null -w '%{http_code}' localhost:3000/a"),
        tool("curl -s -o /dev/null -w '%{http_code}' localhost:3000/b"),
      ],
      "/a returns 200. /b returns 404, so it is broken. I'll check the rest next.",
    ),
  },
  // The request is done, or only the user can go on.
  {
    name: "complete-and-verified",
    label: "stop",
    verdict: "done",
    input: input(
      "Rename the function calc_total to compute_total everywhere and make sure the tests pass.",
      [
        tool("grep -rn calc_total src tests"),
        tool("sed -i '' s/calc_total/compute_total/g src/*.py tests/*.py"),
        tool("python3 -m pytest -q"),
      ],
      "I renamed calc_total to compute_total in 6 files. pytest: 48 passed.",
    ),
  },
  {
    name: "question-answered",
    label: "stop",
    verdict: "done",
    input: input(
      "Which Node version does this project need?",
      [tool("cat package.json"), tool("cat .nvmrc")],
      "It needs Node 24: .nvmrc says 24.10.0 and package.json has engines.node >=24.",
    ),
  },
  {
    name: "truthful-cannot",
    label: "stop",
    verdict: "done",
    input: input(
      "Make the export page load in under 1 second and tell me what you changed.",
      [tool("bun run bench:export"), tool("apply_patch src/export/query.ts"), tool("bun run bench:export")],
      "I added an index on exports.created_at and removed one extra query. The page now loads in 1.4 s, down from 3.2 s. The rest of the time is the PDF renderer, which is a closed library that I cannot change.",
    ),
  },
  {
    name: "needs-credentials",
    label: "stop",
    verdict: "user",
    input: input(
      "Deploy the site to production.",
      [tool("bunx wrangler deploy", "You are not logged in. Run `wrangler login`.")],
      "The deploy needs a Cloudflare sign-in. Please run `wrangler login` in a terminal, or give me an API token, and I will deploy.",
    ),
  },
  {
    name: "approval-to-send",
    label: "stop",
    verdict: "user",
    input: input(
      "Write a reply to the customer email in inbox/latest.eml about the late refund.",
      [tool("cat inbox/latest.eml")],
      "Here is the draft:\n\nHi Maria, I am sorry about the delay. Your refund of 49 EUR was sent today and arrives in 3-5 days.\n\nDo you want me to send it?",
    ),
  },
  {
    name: "real-choice",
    label: "stop",
    verdict: "user",
    input: input(
      "Add a database to the app.",
      [tool("cat package.json"), tool("ls src")],
      "The app has no data layer yet. SQLite keeps it simple and local; Postgres fits if you plan to host it for many users. Which one do you want?",
    ),
  },
  {
    name: "destructive-confirmation",
    label: "stop",
    verdict: "user",
    input: input(
      "Free some disk space on this machine.",
      [tool("du -sh ~/Library/Caches/* | sort -h | tail"), tool("du -sh ~/Downloads")],
      "The biggest items: ~/Library/Caches/Homebrew (12 GB) and ~/Downloads (31 GB, mostly old .dmg files). The caches are safe to delete. Shall I delete the Homebrew cache and the .dmg files in Downloads?",
    ),
  },
  {
    name: "blocked-by-service",
    label: "stop",
    verdict: "blocked",
    input: input(
      "Pull the latest orders from the Shopify API into orders.json.",
      [
        tool("curl -sS https://shop.example/admin/api/orders.json", "HTTP 403: app access revoked by the store owner"),
        tool("cat .env | grep SHOPIFY", "SHOPIFY_TOKEN=[redacted]"),
      ],
      "The Shopify API refuses the token: the store owner revoked the app's access (HTTP 403). The store owner must grant access again before I can pull the orders.",
    ),
  },
  {
    name: "chat-only",
    label: "stop",
    verdict: "done",
    input: input(
      "Thanks, that looks good!",
      [tool("git status --short")],
      "Glad it helped. The working tree is clean, so nothing is left to commit.",
    ),
  },
  {
    name: "done-with-offer-of-extra",
    label: "stop",
    verdict: "done",
    input: input(
      "Add a dark mode toggle to the settings page.",
      [tool("apply_patch src/settings/Settings.tsx"), tool("apply_patch src/theme.css"), tool("bun run build")],
      "I added a dark mode toggle to Settings. It saves the choice and the build passes. If you want, I can also follow the system theme by default.",
    ),
  },
  {
    name: "limit-reached-mostly-done",
    label: "stop",
    verdict: "done",
    input: input(
      "Convert all 12 CSV files in data/ to JSON in out/.",
      [tool("ls data"), tool("python3 scripts/csv2json.py data out"), tool("ls out | wc -l")],
      "All 12 files are converted. out/ has 12 JSON files with the same names.",
      { continuations: 2 },
    ),
  },
  {
    name: "research-summary",
    label: "stop",
    verdict: "done",
    input: input(
      "Find out why the app starts slowly and tell me the top causes. Do not change code.",
      [
        tool("bun run profile:start"),
        tool("cat .openbot-build/profile/start.json | head -100"),
        tool("rg -n 'await import' src/main"),
      ],
      "Top causes from the start profile: 1) the plugin scan reads 400 manifests before the window shows (1.1 s); 2) the database migration check runs twice (0.4 s); 3) the font cache is rebuilt each start (0.3 s). I did not change code, as you asked.",
    ),
  },
];

type Provider = "claude" | "codex";
const providerArgument = process.argv.find((argument) => argument.startsWith("--provider="))?.split("=")[1];
const providers: Provider[] =
  providerArgument === "claude" || providerArgument === "codex" ? [providerArgument] : ["claude", "codex"];
const runCount = Math.max(
  1,
  Number(process.argv.find((argument) => argument.startsWith("--runs="))?.split("=")[1] ?? 1) || 1,
);

interface Run {
  provider: Provider;
  case: string;
  label: Label;
  expectedVerdict: FinishCheckResult["verdict"];
  model: string;
  effort: string;
  /** Null when the answer did not decode: the app then does not continue the request. */
  verdict: FinishCheckResult["verdict"] | null;
  /** The note that the agent would get, or null when the request ends. */
  gap: string | null;
  continues: boolean;
  correct: boolean;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  answer: string;
}

async function listedModel(client: AgentClient, provider: Provider): Promise<AgentModelOption> {
  const id = agentProviderDescriptor(provider).defaultModel;
  await runCauseEffect(startToolless(client));
  try {
    const list = await runCauseEffect(
      client.request("model/list", { limit: 100, includeHidden: true }, (value) => value),
    );
    const item = getArray(list, "data").find((entry) => getString(entry, "model") === id);
    if (!item) throw new Error(`${provider} does not list ${id}.`);
    const efforts = getArray(item, "supportedReasoningEfforts")
      .map((entry) => getString(entry, "reasoningEffort"))
      .filter(isReasoningEffort);
    const listedDefault = getString(item, "defaultReasoningEffort");
    return {
      provider,
      id,
      name: id,
      description: "",
      defaultReasoningEffort: isReasoningEffort(listedDefault) ? listedDefault : (efforts[0] ?? "medium"),
      supportedReasoningEfforts: efforts.length ? efforts : ["medium"],
    };
  } finally {
    await runCauseEffect(stopToolless(client)).catch(() => undefined);
  }
}

const count = (record: unknown, key: string) => {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === "number" ? value : 0;
};

function decide(answer: string): FinishCheckResult | null {
  try {
    return Schema.decodeUnknownSync(FinishCheckResult)(extractJsonObject(answer));
  } catch {
    return null;
  }
}

async function measure(
  provider: Provider,
  model: AgentModelOption,
  testCase: Case,
  call: (prompt: string) => Promise<{ answer: string; inputTokens: number; outputTokens: number }>,
): Promise<Run> {
  const started = performance.now();
  const { answer, inputTokens, outputTokens } = await call(finishCheckPrompt(testCase.input));
  const ms = Math.round(performance.now() - started);
  const result = decide(answer);
  const gap = result ? finishCheckGap(result) : null;
  const continues = gap !== null;
  return {
    provider,
    case: testCase.name,
    label: testCase.label,
    expectedVerdict: testCase.verdict,
    model: model.id,
    effort: model.defaultReasoningEffort,
    verdict: result?.verdict ?? null,
    gap,
    continues,
    correct: continues === (testCase.label === "continue"),
    ms,
    inputTokens,
    outputTokens,
    answer,
  };
}

function claudeCall(cli: Awaited<ReturnType<typeof resolveClaudeCliInfo>>, model: AgentModelOption) {
  return async (prompt: string) => {
    const seen = { input: 0, output: 0 };
    const createQuery = observedQuery(
      (message) => {
        if (message.type === "result") {
          seen.input =
            message.usage.input_tokens +
            message.usage.cache_read_input_tokens +
            message.usage.cache_creation_input_tokens;
          seen.output = message.usage.output_tokens;
        }
      },
      (options) => options,
    );
    const client = new ClaudeAgentClient(cli, createQuery, undefined, TIMEOUT_MS);
    const answer = await runCauseEffect(generateTextWithoutTools(client, model, prompt));
    return { answer, inputTokens: seen.input, outputTokens: seen.output };
  };
}

function codexCall(cli: Awaited<ReturnType<typeof resolveCodexCliInfo>>, model: AgentModelOption) {
  return async (prompt: string) => {
    const seen = { input: 0, output: 0 };
    const observe = (notification: AppServerNotification) => {
      if (notification.method !== "thread/tokenUsage/updated") return;
      const total = getRecord(getRecord(notification.params, "tokenUsage"), "total");
      if (!total) return;
      seen.input = count(total, "inputTokens");
      seen.output = count(total, "outputTokens");
    };
    const client = new CodexAppServerClient(cli.executable, TIMEOUT_MS, cliPathEnvironment(cli));
    const answer = await runCauseEffect(generateTextWithoutTools(client, model, prompt, undefined, observe));
    return { answer, inputTokens: seen.input, outputTokens: seen.output };
  };
}

const resolveClaudeCliInfo = () => runCauseEffect(resolveClaudeCli());
const resolveCodexCliInfo = () => runCauseEffect(resolveCodexCli());

const runs: Run[] = [];
const failures: string[] = [];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

for (const provider of providers) {
  try {
    let model: AgentModelOption;
    let call: (prompt: string) => Promise<{ answer: string; inputTokens: number; outputTokens: number }>;
    if (provider === "claude") {
      const cli = await resolveClaudeCliInfo();
      model = withBackgroundEffort(
        await listedModel(new ClaudeAgentClient(cli, undefined, undefined, TIMEOUT_MS), provider),
      );
      call = claudeCall(cli, model);
    } else {
      const cli = await resolveCodexCliInfo();
      model = withBackgroundEffort(
        await listedModel(new CodexAppServerClient(cli.executable, TIMEOUT_MS, cliPathEnvironment(cli)), provider),
      );
      call = codexCall(cli, model);
    }
    for (let index = 0; index < runCount; index += 1)
      for (const testCase of CASES) {
        try {
          const run = await measure(provider, model, testCase, call);
          runs.push(run);
          process.stderr.write(
            `${run.correct ? "ok  " : "MISS"} ${provider} ${testCase.name}: ${run.verdict ?? "no verdict"} (${run.ms} ms)\n`,
          );
        } catch (error) {
          failures.push(`${provider} ${testCase.name}: ${message(error)}`);
        }
      }
  } catch (error) {
    failures.push(`${provider}: ${message(error)}`);
  }
}

const percentile = (values: number[], fraction: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? null;
};
const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const summary = providers.map((provider) => {
  const of = runs.filter((run) => run.provider === provider);
  const shouldContinue = of.filter((run) => run.label === "continue");
  const shouldStop = of.filter((run) => run.label === "stop");
  return {
    provider,
    model: of[0]?.model ?? null,
    effort: of[0]?.effort ?? null,
    calls: of.length,
    correct: of.filter((run) => run.correct).length,
    /** Of the cases with missing work, the share that the check continued. */
    caught: `${shouldContinue.filter((run) => run.continues).length}/${shouldContinue.length}`,
    /** Of the cases that must stop, the share that the check continued anyway. */
    falseContinues: `${shouldStop.filter((run) => run.continues).length}/${shouldStop.length}`,
    exactVerdicts: `${of.filter((run) => run.verdict === run.expectedVerdict).length}/${of.length}`,
    undecoded: of.filter((run) => run.verdict === null).length,
    msP50: percentile(
      of.map((run) => run.ms),
      0.5,
    ),
    msP95: percentile(
      of.map((run) => run.ms),
      0.95,
    ),
    meanInputTokens: mean(of.map((run) => run.inputTokens)),
    meanOutputTokens: mean(of.map((run) => run.outputTokens)),
    misses: of.filter((run) => !run.correct).map((run) => `${run.case}: ${run.verdict ?? "no verdict"}`),
  };
});
mkdirSync(OUT, { recursive: true });
const report = { date: new Date().toISOString(), runsPerCase: runCount, cases: CASES.length, summary, runs, failures };
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ summary, failures }, null, 2)}\nReport: ${resolve(OUT, "report.json")}\n`);
if (failures.length) process.exit(1);
