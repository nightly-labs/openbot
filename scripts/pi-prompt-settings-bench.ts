import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-prompt-settings-bench");
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT =
  "Read notes.md and count.txt. Then reply with one line: the title of notes.md and the number in count.txt. " +
  "Use the read tool, not bash.";

interface PiSettings {
  extensions?: string[];
}

interface BridgeChange {
  exposure?: "direct" | "deferred";
  description?: string;
  toolExposure?: Record<string, "deferred" | "hidden"> | null;
}

interface Variant {
  name: string;
  settings?: PiSettings;
  flags?: string[];
  extension?: string;
  bridge?: BridgeChange;
}

const DOCS_EXTENSION = String.raw`export default function (pi) {
  let docs;
  pi.on("before_agent_start", (event) => {
    docs = event.systemPrompt.match(/<docs>\n[\s\S]*?\n<\/docs>/)?.[0];
  });
  pi.on("context_with_system", (event) => {
    const [first, ...rest] = event.messages;
    if (!docs || first?.role !== "system" || !first.sections || first.sections.docs) return undefined;
    const sections = {};
    for (const [name, text] of Object.entries(first.sections)) {
      sections[name] = text;
      if (name === "rules") sections.docs = docs;
    }
    return { messages: [{ ...first, sections }, ...rest] };
  });
}
`;

const DEFERRED = (...tools: string[]): BridgeChange => ({
  toolExposure: Object.fromEntries(tools.map((tool) => [tool, "deferred" as const])),
  description: "OpenBot",
});

const VARIANTS: Variant[] = [
  { name: "current" },
  { name: "with-pi-docs-section", extension: DOCS_EXTENSION },
  { name: "with-all-openbot-tools", bridge: { toolExposure: null } },
  { name: "before", extension: DOCS_EXTENSION, bridge: { toolExposure: null } },
  { name: "no-llama-cpp", settings: { extensions: ["-builtin:llama.cpp"] } },
  { name: "no-codemode", settings: { extensions: ["-builtin:codemode"] } },
  { name: "no-tool-search", settings: { extensions: ["-builtin:tool-search"] } },
  { name: "no-prompt-templates", flags: ["--no-prompt-templates"] },
  { name: "no-skills", flags: ["--no-skills"] },
  { name: "two-openbot-tools-deferred", bridge: DEFERRED("request_api_key", "suggest_marketplace_app") },
  { name: "ask-ui-deferred-too", bridge: DEFERRED("ask_ui", "request_api_key", "suggest_marketplace_app") },
  { name: "all-openbot-tools-deferred", bridge: { exposure: "deferred", toolExposure: null, description: "OpenBot" } },
];

const MEASURE_EXTENSION = `import { appendFileSync } from "node:fs";
export default function (pi) {
  const file = process.env.OPENBOT_BENCH_MEASURE_FILE;
  if (!file) return;
  const write = (record) => appendFileSync(file, JSON.stringify(record) + "\\n");
  pi.on("before_provider_request", (event) => {
    const payload = event.payload ?? {};
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const text = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "";
    const system = messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => text(message.content)).join("\\n");
    const sections = {};
    for (const match of system.matchAll(/<([a-z][a-z0-9_-]*)>[\\s\\S]*?<\\/\\1>/g)) sections[match[1]] = match[0].length;
    const tools = (Array.isArray(payload.tools) ? payload.tools : []).map((tool) => ({
      name: tool.function?.name ?? tool.name,
      chars: JSON.stringify(tool).length,
    }));
    write({ kind: "request", systemChars: system.length, sections, tools, messages: messages.length });
  });
  pi.on("message_end", (event) => {
    if (event.message?.role === "assistant") write({ kind: "usage", usage: event.message.usage ?? null });
  });
}
`;

interface RequestReport {
  systemChars: number;
  sections: Record<string, number>;
  tools: { name: string; chars: number }[];
  messages: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface TurnReport {
  step: string;
  reply: string;
  requests: RequestReport[];
  firstRequestPrompt: number;
  totalPrompt: number;
  output: number;
}

interface RunReport {
  variant: string;
  settings: PiSettings;
  flags: string[];
  extension: boolean;
  bridge: BridgeChange | null;
  turns: TurnReport[];
  error?: string;
}

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const onlyVariant = argument("variant");
const MODEL = argument("model") ?? "mercury-3";
const BUDGET = Number(argument("budget") ?? 500_000);
const variants = onlyVariant ? VARIANTS.filter((variant) => onlyVariant.split(",").includes(variant.name)) : VARIANTS;
if (variants.length === 0) throw new Error(`Unknown variant: ${onlyVariant}`);
const KEY = process.env.INCEPTION_API_KEY?.trim();
if (!KEY) throw new Error("Set INCEPTION_API_KEY to an Inception key.");
delete process.env.INCEPTION_API_KEY;

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-pi-prompt-bench-")));
const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
const report: { cli: { executable: string; version: string }; model: string; tokensUsed: number; runs: RunReport[] } = {
  cli: { executable: cli.executable, version: cli.version },
  model: MODEL,
  tokensUsed: 0,
  runs: [],
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=OpenBot", "-c", "user.email=e2e@openbot.invalid", ...args], { cwd });
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const BRIDGE_SCRIPT = `const changes = JSON.parse(process.argv[2]);
const servers = JSON.parse(process.env.OPENBOT_PI_MCP_SERVERS || "[]").map((server) => {
  if (server.config.exposure !== "direct") return server;
  const config = { ...server.config, ...changes };
  for (const key of Object.keys(config)) if (config[key] === null) delete config[key];
  return { ...server, config };
});
process.stdout.write(JSON.stringify(servers));
`;

async function wrapper(folder: string, extra: string[], bridge?: BridgeChange): Promise<string> {
  const path = join(folder, "pi");
  const added = extra.map(quote).join(" ");
  let change = "";
  if (bridge) {
    const script = join(folder, "bridge.mjs");
    await writeFile(script, BRIDGE_SCRIPT);
    change = `OPENBOT_PI_MCP_SERVERS=$(${quote(process.execPath)} ${quote(script)} ${quote(JSON.stringify(bridge))})\nexport OPENBOT_PI_MCP_SERVERS\n`;
  }
  await writeFile(
    path,
    `#!/bin/sh\ncase "$1" in --mode) ${change}exec ${quote(cli.executable)} "$@" ${added} ;; *) exec ${quote(cli.executable)} "$@" ;; esac\n`,
  );
  await chmod(path, 0o755);
  return path;
}

async function readMeasures(file: string): Promise<RequestReport[]> {
  const lines = (await readFile(file, "utf8").catch(() => "")).split("\n").filter(Boolean);
  const requests: RequestReport[] = [];
  for (const line of lines) {
    const record = JSON.parse(line);
    if (record.kind === "request")
      requests.push({ ...record, kind: undefined, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
    const last = requests.at(-1);
    if (record.kind === "usage" && last) {
      last.input = record.usage?.input ?? 0;
      last.cacheRead = record.usage?.cacheRead ?? 0;
      last.cacheWrite = record.usage?.cacheWrite ?? 0;
      last.output = record.usage?.output ?? 0;
    }
  }
  return requests.map(({ kind: _kind, ...request }: RequestReport & { kind?: unknown }) => request);
}

for (const variant of variants) {
  if (report.tokensUsed >= BUDGET) {
    process.stdout.write(`Budget of ${BUDGET} tokens reached; ${variant.name} and later variants did not run.\n`);
    break;
  }
  const folder = join(root, variant.name);
  const agent = join(folder, "agent");
  const workspace = join(folder, "workspace");
  await mkdir(agent, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify(variant.settings ?? {}));
  await writeFile(join(agent, "auth.json"), "{}");
  await writeFile(join(workspace, "notes.md"), "# Garden plan\n\nTomatoes by the wall.\n");
  await writeFile(join(workspace, "count.txt"), "42\n");
  git(workspace, "init", "-q");
  git(workspace, "add", ".");
  git(workspace, "commit", "-q", "-m", "Start");
  const measure = join(folder, "measure.mjs");
  await writeFile(measure, MEASURE_EXTENSION);
  const extra = ["--extension", measure, ...(variant.flags ?? [])];
  if (variant.extension) {
    const path = join(folder, "variant.mjs");
    await writeFile(path, variant.extension);
    extra.push("--extension", path);
  }
  const variantCli = await runCauseEffect(
    resolvePiCli({ bundledExecutable: await wrapper(folder, extra, variant.bridge) }),
  );
  process.env.PI_CODING_AGENT_DIR = agent;

  const client = requireProviderDriver("inception").createClient(variantCli, 120_000, {
    apiKey: (provider) => (provider === "inception" ? KEY : null),
    customProviders: () => [],
    mcpServers: () => [],
    providerStateDirectory: join(folder, "state"),
  });
  const completions = new Map<string, () => void>();
  const replies = new Map<string, string>();
  const failures: string[] = [];
  client.on("notification", (notification: AppServerNotification) => {
    const threadId = getString(notification.params, "threadId");
    if (notification.method === "error") failures.push(JSON.stringify(notification.params));
    if (notification.method === "item/completed" && threadId)
      replies.set(
        threadId,
        (replies.get(threadId) ?? "") + (getString(getRecord(notification.params, "item"), "text") ?? ""),
      );
    if (notification.method !== "turn/completed") return;
    const status = getString(getRecord(notification.params, "turn"), "status");
    if (status !== "completed") failures.push(`turn ended as ${status ?? "unknown"}`);
    if (threadId) completions.get(threadId)?.();
  });
  client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
  client.start();

  const run: RunReport = {
    variant: variant.name,
    settings: variant.settings ?? {},
    flags: variant.flags ?? [],
    extension: Boolean(variant.extension),
    bridge: variant.bridge ?? null,
    turns: [],
  };
  const runTurn = async (step: string, prompt: string) => {
    const file = join(folder, `${step}.jsonl`);
    process.env.OPENBOT_BENCH_MEASURE_FILE = file;
    const threadId = await runCauseEffect(
      client.request(
        "thread/start",
        {
          cwd: workspace,
          model: MODEL,
          developerInstructions: "You are Ada, a careful assistant in an end-to-end benchmark.",
          dynamicTools: visibleDynamicTools("pi"),
        },
        (value) => getString(getRecord(value, "thread"), "id"),
      ),
    );
    if (!threadId) throw new Error("thread/start returned no thread id.");
    const done = new Promise<void>((finish) => completions.set(threadId, finish));
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, model: MODEL, input: [{ type: "text", text: prompt, text_elements: [] }] },
        (value) => value,
      ),
    );
    await done;
    completions.delete(threadId);
    const requests = await readMeasures(file);
    const prompted = (request: RequestReport) => request.input + request.cacheRead + request.cacheWrite;
    const turn: TurnReport = {
      step,
      reply: replies.get(threadId) ?? "",
      requests,
      firstRequestPrompt: requests[0] ? prompted(requests[0]) : 0,
      totalPrompt: requests.reduce((total, request) => total + prompted(request), 0),
      output: requests.reduce((total, request) => total + request.output, 0),
    };
    report.tokensUsed += turn.totalPrompt + turn.output;
    run.turns.push(turn);
    if (failures.length > 0) throw new Error(`Turn ${step} failed: ${failures.join("; ")}`);
  };

  try {
    await runTurn("reply", REPLY_PROMPT);
    await runTurn("task", TASK_PROMPT);
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
  } finally {
    await stopClients([client]);
  }
  report.runs.push(run);
  const [reply, task] = run.turns;
  const first = reply?.requests[0];
  process.stdout.write(
    `${variant.name.padEnd(22)} reply.prompt=${reply?.firstRequestPrompt ?? "-"} ` +
      `system=${first?.systemChars ?? "-"} tools=${first?.tools.length ?? "-"} ` +
      `task.requests=${task?.requests.length ?? "-"} task.prompt=${task?.totalPrompt ?? "-"} ` +
      `used=${report.tokensUsed}${run.error ? ` (failed: ${run.error})` : ""}\n`,
  );
}

await rm(root, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nReport: ${join(OUT, "report.json")}\n`);
process.exit(report.runs.some((run) => run.error) ? 1 : 0);
