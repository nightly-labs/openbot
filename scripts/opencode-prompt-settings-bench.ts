// Measures what the OpenCode features that OpenBot agents do not use cost in each request. Runs the
// real `opencode` provider driver and the real OpenCode binary against a fake model on loopback
// (`opencode-agent-harness.ts`), with the OpenBot tools of a real agent. Each variant runs in a new
// OpenCode process and runs these turns, each in a new session:
//   1. a one-word reply: one request, which is the fixed prefix of every request (system prompt,
//      tools, skills, Code Mode catalog) plus a short message,
//   2. a small task: the model reads a file, then replies, so two requests.
// `current` is what the driver sends. `before` gives OpenCode an empty `OPENCODE_CONFIG` file, so the
// driver adds no rules of `opencode-agent-defaults.ts`, as before they existed. Each other variant puts
// its rules in that file instead. The fake model reports no usage, so the report counts o200k tokens of
// each request body with `uvx --with tiktoken` when `uvx` is there, and else estimates 4 characters a
// token. It also lists the tools, skills and Code Mode catalog of the first request.
// `OPENCODE_CLI=<opencode> bun run bench:opencode-prompt-settings`; `--variant=<name>` runs one variant.
// Writes .openbot-build/opencode-prompt-settings-bench/report.json.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getArray, getRecord, getString } from "../src/backend/protocol";
import {
  codeModeCatalog,
  type Json,
  listedSkills,
  type ModelRequest,
  OPENCODE_MODEL,
  startOpenCodeHarness,
} from "./opencode-agent-harness";
import { runTurn } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-prompt-settings-bench");
const NL = "\n";
const run = promisify(execFile);
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT = "Read notes.md and reply with its title.";

interface Variant {
  name: string;
  /** The `OPENCODE_CONFIG` file. Absent: the driver writes its own. */
  config?: { readonly [key: string]: Json };
  /** The user's global `opencode.json`. */
  global?: { readonly [key: string]: Json };
}

const SKILLS_OFF = { skill: { report: "deny", opencode: "deny" } };

const VARIANTS: Variant[] = [
  { name: "before", config: {} },
  { name: "current" },
  // Each rule of `current` alone.
  { name: "question-deny", config: { permission: { question: "deny" } } },
  { name: "skills-deny", config: { permission: SKILLS_OFF } },
  {
    name: "mcp-resources-deny",
    config: { permission: { opencode_list_mcp_resources: "deny", opencode_read_mcp_resource: "deny" } },
  },
  // The user's own rule wins: `question` comes back, the other rules stay.
  { name: "user-question-allow", global: { permission: { question: "allow" } } },
  // Features that OpenBot agents keep, measured as references on top of `before`.
  { name: "models-deny", config: { permission: { opencode_models: "deny" } } },
  { name: "explore-off", config: { agent: { explore: { disable: true } } } },
  { name: "subagent-deny", config: { permission: { subagent: "deny" } } },
  { name: "glob-grep-deny", config: { permission: { glob: "deny", grep: "deny" } } },
  { name: "webfetch-deny", config: { permission: { webfetch: "deny" } } },
  { name: "websearch-off", config: { websearch: false } },
];

interface RequestReport {
  /** Tokens of the system messages, the tool definitions and the other messages. */
  system: number;
  tools: number;
  messages: number;
  total: number;
}

interface TurnReport {
  step: string;
  requests: RequestReport[];
  total: number;
}

interface RunReport {
  variant: string;
  config: { readonly [key: string]: Json } | null;
  global: { readonly [key: string]: Json };
  /** The rules file that the driver wrote, when it wrote one. */
  driverDefaults: unknown;
  tools: string[];
  skills: string[];
  catalog: ReturnType<typeof codeModeCatalog> | null;
  turns: TurnReport[];
  error?: string;
}

const onlyVariant = process.argv.find((arg) => arg.startsWith("--variant="))?.slice("--variant=".length);
const variants = onlyVariant ? VARIANTS.filter((variant) => variant.name === onlyVariant) : VARIANTS;
if (variants.length === 0) throw new Error(`Unknown variant: ${onlyVariant}`);

/** The three parts of one request, as text. */
function requestParts(request: ModelRequest): [string, string, string] {
  const messages = getArray(request.body, "messages");
  return [
    request.system,
    JSON.stringify(getArray(request.body, "tools")),
    JSON.stringify(messages.filter((message) => getString(message, "role") !== "system")),
  ];
}

const TIKTOKEN = [
  "import json, sys, tiktoken",
  "enc = tiktoken.get_encoding('o200k_base')",
  "print(json.dumps([len(enc.encode(text)) for text in json.load(sys.stdin)]))",
].join(NL);

/** o200k token counts with `uvx`, or null when `uvx` or the download is not there. */
async function o200k(texts: string[]): Promise<number[] | null> {
  try {
    const child = run("uvx", ["--quiet", "--with", "tiktoken", "python", "-I", "-c", TIKTOKEN], {
      maxBuffer: 1 << 24,
    });
    child.child.stdin?.end(JSON.stringify(texts));
    const { stdout } = await child;
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const harness = await startOpenCodeHarness("opencode-prompt-bench");
const notes = join(harness.workspace, "notes.md");
await writeFile(notes, `# Garden notes${NL}${NL}Water the tomatoes.${NL}`);
const report: { openCodeVersion: string; counter: string; runs: RunReport[] } = {
  openCodeVersion: harness.cli.version ?? "unknown",
  counter: "o200k",
  runs: [],
};
const texts: string[] = [];
/** For each run and turn, the indexes of its request parts in `texts`. */
const parts: number[][][][] = [];

try {
  for (const variant of variants) {
    await harness.writeGlobalConfig(variant.global ?? {});
    const configFile = join(harness.root, `${variant.name}.json`);
    if (variant.config) {
      await writeFile(configFile, `${JSON.stringify(variant.config)}${NL}`);
      process.env.OPENCODE_CONFIG = configFile;
    } else delete process.env.OPENCODE_CONFIG;

    const client = harness.createClient();
    client.on("request", (request) => client.respond(request.id, {}));
    client.start();
    const result: RunReport = {
      variant: variant.name,
      config: variant.config ?? null,
      global: variant.global ?? {},
      driverDefaults: null,
      tools: [],
      skills: [],
      catalog: null,
      turns: [],
    };
    const runParts: number[][][] = [];
    try {
      for (const [step, prompt] of [
        ["reply", REPLY_PROMPT],
        ["task", TASK_PROMPT],
      ] as const) {
        harness.script =
          step === "reply"
            ? () => ({ text: "OK" })
            : (request) =>
                request.toolResults === 0 ? { tool: "read", arguments: { path: notes } } : { text: "Garden notes" };
        const first = harness.requests.length;
        const thread = await runCauseEffect(
          client.request(
            "thread/start",
            {
              cwd: harness.workspace,
              model: OPENCODE_MODEL,
              developerInstructions: "You are Ada, a careful assistant in an end-to-end benchmark.",
              dynamicTools: visibleDynamicTools("opencode"),
            },
            (value) => value,
          ),
        );
        const threadId = getString(getRecord(thread, "thread"), "id");
        if (!threadId) throw new Error("thread/start answers no thread id.");
        const turn = await runTurn(client, threadId, { text: prompt, timeoutMs: 120_000 });
        if (turn.error) throw new Error(`Turn ${step} failed: ${turn.error}`);
        const requests = harness.requests.slice(first).filter((request) => request.tools.length > 0);
        if (requests.length === 0) throw new Error(`Turn ${step} sent no request with tools.`);
        if (step === "reply") {
          const firstRequest = requests[0];
          if (firstRequest) {
            result.tools = [...firstRequest.tools].sort();
            result.skills = listedSkills(firstRequest.system);
            result.catalog = codeModeCatalog(firstRequest.system);
          }
        }
        runParts.push(
          requests.map((request) =>
            requestParts(request).map((text) => {
              texts.push(text);
              return texts.length - 1;
            }),
          ),
        );
        result.turns.push({ step, requests: [], total: 0 });
      }
      if (!variant.config) {
        const written = join(harness.root, "provider-state", "opencode", "openbot-agent-defaults.json");
        result.driverDefaults = await readFile(written, "utf8")
          .then((text) => JSON.parse(text))
          .catch(() => null);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      await runCauseEffect(client.stop()).catch(() => undefined);
    }
    report.runs.push(result);
    parts.push(runParts);
    process.stdout.write(`${variant.name.padEnd(22)} ${result.error ? `failed: ${result.error}` : "done"}${NL}`);
  }
} finally {
  await harness.stop();
}

const counted = await o200k(texts);
const counts = counted ?? texts.map((text) => Math.ceil(text.length / 4));
if (!counted) report.counter = "characters/4";

report.runs.forEach((result, runIndex) => {
  result.turns.forEach((turn, turnIndex) => {
    turn.requests = (parts[runIndex]?.[turnIndex] ?? []).map((indexes) => {
      const [system = 0, tools = 0, messages = 0] = indexes.map((index) => counts[index] ?? 0);
      return { system, tools, messages, total: system + tools + messages };
    });
    turn.total = turn.requests.reduce((sum, request) => sum + request.total, 0);
  });
});

const before = report.runs.find((result) => result.variant === "before");
const total = (result: RunReport | undefined, step: string) =>
  result?.turns.find((turn) => turn.step === step)?.total ?? 0;
process.stdout.write(
  `${NL}variant                 reply   Δreply     task    Δtask  catalog  removed (from before)${NL}`,
);
for (const result of report.runs) {
  const reply = total(result, "reply");
  const task = total(result, "task");
  const removed = before
    ? [
        ...before.tools.filter((tool) => !result.tools.includes(tool)),
        ...(before.catalog?.opencode ?? [])
          .filter((tool) => !result.catalog?.opencode.includes(tool))
          .map((tool) => `opencode.${tool}`),
        ...before.skills.filter((skill) => !result.skills.includes(skill)).map((skill) => `skill:${skill}`),
      ]
    : [];
  process.stdout.write(
    `${result.variant.padEnd(22)} ${String(reply).padStart(6)} ${String(before ? reply - total(before, "reply") : 0).padStart(8)} ` +
      `${String(task).padStart(8)} ${String(before ? task - total(before, "task") : 0).padStart(8)}  ` +
      `${(result.catalog?.header ?? "-").padEnd(18)} ${removed.join(", ")}${result.error ? ` (failed: ${result.error})` : ""}${NL}`,
  );
}

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
process.stdout.write(`${NL}Counted with ${report.counter}. Report: ${join(OUT, "report.json")}${NL}`);
process.exit(report.runs.some((result) => result.error) ? 1 : 0);
