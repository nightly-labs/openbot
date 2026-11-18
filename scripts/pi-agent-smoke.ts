// Runs one real Pi agent session through the real `inception` driver (`PiAgentClient`) on Mercury 3,
// with the prompt settings of `src/backend/pi-mcp.ts`. It uses a temporary git workspace and an
// isolated Pi agent folder (`PI_CODING_AGENT_DIR`), so the user's `~/.pi/agent` is not read or changed.
// The session must use Pi's core tools (read, write, edit, bash), make a commit, and reach a tool that
// Pi does not declare (`suggest_marketplace_app`) through OpenBot's `tool_search` and `tool_call`.
// The script answers the OpenBot tool calls as the host does: `tool_search` with the real catalog,
// `tool_call` with the real resolver, and a fixed result for the resolved tool.
// A measuring extension checks each request: no Pi `<docs>` section, an `<mcp_servers>` section that
// names the user's MCP server (a stdio server that never answers, so its tools stay deferred), `ask_ui`
// declared, and `request_api_key` and `suggest_marketplace_app` not declared.
// `INCEPTION_API_KEY=… bun run smoke:pi-agent`; `--model=<id>` replaces Mercury 3; `--budget=<tokens>`
// stops before a turn when the tokens used so far reach it (default 120,000). One run used about
// 69,000 Mercury tokens. Writes .openbot-build/pi-agent-smoke/report.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openBotToolFailure, openBotToolResult } from "../src/backend/agent/routine-tools";
import { discoverTools, resolveDeferredTool, visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type AppServerNotification,
  type DynamicToolCallParams,
  getRecord,
  getString,
  isRecord,
} from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-agent-smoke");
const SEARCH_ONLY = ["request_api_key", "suggest_marketplace_app"];
// A guard for a turn that never ends, such as a stalled stream. Each turn of a run took under 2 minutes.
const TURN_DEADLINE_MS = 10 * 60_000;

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const MODEL = argument("model") ?? "mercury-3";
const BUDGET = Number(argument("budget") ?? 120_000);
const KEY = process.env.INCEPTION_API_KEY?.trim();
if (!KEY) throw new Error("Set INCEPTION_API_KEY to an Inception key.");
delete process.env.INCEPTION_API_KEY;

interface Turn {
  step: string;
  prompt: string;
  /** Pi tools that must complete in this turn. */
  tools: string[];
  /** OpenBot tools that the host must answer in this turn; `tool_call` is named by its resolved tool. */
  hostTools: string[];
}

const TURNS: Turn[] = [
  {
    step: "core-tools-and-commit",
    prompt:
      "Do these steps in order with your tools: 1. Use the read tool to read count.txt. 2. Use the write tool to " +
      "create hello.txt with the text `hi`. 3. Use the edit tool to change `hi` to the number from count.txt. " +
      '4. Use bash to run `git add hello.txt && git commit -q -m "Add hello"`. Then reply with one line: done.',
    tools: ["read", "write", "edit", "bash"],
    hostTools: [],
  },
  {
    step: "search-only-tool",
    prompt:
      "Use your OpenBot tool_search tool to find the OpenBot tool that suggests a marketplace app. Then run that " +
      "tool through the OpenBot tool_call tool, for the app `github`, with a short reason. Reply with one line: done.",
    tools: [],
    hostTools: ["tool_search", "suggest_marketplace_app"],
  },
];

/** Records each request and each assistant message's usage, one JSON line each. */
const MEASURE_EXTENSION = `import { appendFileSync } from "node:fs";
export default function (pi) {
  const file = process.env.OPENBOT_SMOKE_MEASURE_FILE;
  if (!file) return;
  const write = (record) => appendFileSync(file, JSON.stringify(record) + "\\n");
  pi.on("before_provider_request", (event) => {
    const payload = event.payload ?? {};
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const text = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "";
    const system = messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => text(message.content)).join("\\n");
    const tools = (Array.isArray(payload.tools) ? payload.tools : []).map((tool) => tool.function?.name ?? tool.name);
    write({ kind: "request", systemChars: system.length, docs: system.includes("<docs>"), servers: /<mcp_servers>[\\s\\S]*\\(tool_search\\): smoke-files[\\s\\S]*<\\/mcp_servers>/.test(system), tools });
  });
  pi.on("message_end", (event) => {
    if (event.message?.role === "assistant") write({ kind: "usage", usage: event.message.usage ?? null });
  });
}
`;

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=OpenBot", "-c", "user.email=e2e@openbot.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-pi-agent-smoke-")));
const agent = join(root, "agent");
const workspace = join(root, "workspace");
await mkdir(agent, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(join(agent, "settings.json"), "{}");
await writeFile(join(agent, "auth.json"), "{}");
await writeFile(join(workspace, "count.txt"), "42\n");
git(workspace, "init", "-q");
git(workspace, "add", ".");
git(workspace, "commit", "-q", "-m", "Start");
const measure = join(root, "measure.mjs");
await writeFile(measure, MEASURE_EXTENSION);
const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
// The wrapper adds the measuring extension to the driver's RPC run only.
const wrapper = join(root, "pi");
await writeFile(
  wrapper,
  `#!/bin/sh\ncase "$1" in --mode) exec ${quote(cli.executable)} "$@" --extension ${quote(measure)} ;; *) exec ${quote(cli.executable)} "$@" ;; esac\n`,
);
await chmod(wrapper, 0o755);
const smokeCli = await runCauseEffect(resolvePiCli({ bundledExecutable: wrapper }));
process.env.PI_CODING_AGENT_DIR = agent;
// Pi reads the file name once when it starts, so one file holds the session; each turn reads its new lines.
const MEASURE_FILE = join(root, "measure.jsonl");
process.env.OPENBOT_SMOKE_MEASURE_FILE = MEASURE_FILE;

const client = requireProviderDriver("inception").createClient(smokeCli, 120_000, {
  apiKey: (provider) => (provider === "inception" ? KEY : null),
  customProviders: () => [],
  mcpServers: () => [
    {
      id: "smoke-files",
      name: "smoke-files",
      transport: "stdio",
      enabled: true,
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1e6)"],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    },
  ],
  providerStateDirectory: join(root, "state"),
});

let hostTools: string[] = [];
let piTools: { tool: string; status: string }[] = [];
const failures: string[] = [];
let completed: (() => void) | null = null;
client.on("notification", (notification: AppServerNotification) => {
  if (notification.method === "error") failures.push(JSON.stringify(notification.params));
  const item = getRecord(notification.params, "item");
  if (notification.method === "item/completed" && getString(item, "type") === "dynamicToolCall")
    piTools.push({ tool: getString(item, "tool") ?? "", status: getString(item, "status") ?? "" });
  if (notification.method !== "turn/completed") return;
  const status = getString(getRecord(notification.params, "turn"), "status");
  if (status !== "completed") failures.push(`turn ended as ${status ?? "unknown"}`);
  completed?.();
});
client.on("request", (request) => {
  if (request.method !== "item/tool/call") return client.respond(request.id, { decision: "accept" });
  const call = isRecord(request.params) ? request.params : {};
  const params: DynamicToolCallParams = {
    threadId: getString(call, "threadId") ?? "",
    turnId: getString(call, "turnId") ?? "",
    callId: getString(call, "callId") ?? "",
    namespace: getString(call, "namespace"),
    tool: getString(call, "tool") ?? "",
    arguments: call.arguments,
  };
  try {
    if (params.tool === "tool_search") {
      hostTools.push("tool_search");
      return client.respond(request.id, openBotToolResult(discoverTools(params, "pi")));
    }
    if (params.tool === "tool_call") {
      const resolved = resolveDeferredTool(params, "pi");
      hostTools.push(resolved?.tool ?? "tool_call:invalid");
      if (!resolved) return client.respond(request.id, openBotToolFailure("Unknown tool."));
      return client.respond(request.id, openBotToolResult({ shown: true, tool: resolved.tool }));
    }
    hostTools.push(params.tool);
    return client.respond(request.id, openBotToolFailure("This smoke answers only tool_search and tool_call."));
  } catch (error) {
    return client.respond(request.id, openBotToolFailure(error instanceof Error ? error.message : String(error)));
  }
});
client.start();

interface Request {
  systemChars: number;
  docs: boolean;
  servers: boolean;
  tools: string[];
  prompt: number;
  output: number;
}
let measuredLines = 0;
const readRequests = async (): Promise<Request[]> => {
  const requests: Request[] = [];
  const lines = (await readFile(MEASURE_FILE, "utf8").catch(() => "")).split("\n").filter(Boolean);
  for (const line of lines.slice(measuredLines)) {
    const record = JSON.parse(line);
    if (record.kind === "request")
      requests.push({
        systemChars: record.systemChars,
        docs: record.docs,
        servers: record.servers,
        tools: record.tools,
        prompt: 0,
        output: 0,
      });
    const last = requests.at(-1);
    if (record.kind === "usage" && last) {
      const usage = record.usage ?? {};
      last.prompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      last.output = usage.output ?? 0;
    }
  }
  measuredLines = lines.length;
  return requests;
};

const report: {
  cli: { executable: string; version: string };
  model: string;
  tokensUsed: number;
  turns: { step: string; piTools: typeof piTools; hostTools: string[]; requests: Request[]; problems: string[] }[];
  commit: string | null;
  hello: string | null;
  problems: string[];
} = {
  cli: { executable: cli.executable, version: cli.version },
  model: MODEL,
  tokensUsed: 0,
  turns: [],
  commit: null,
  hello: null,
  problems: [],
};

try {
  const threadId = await runCauseEffect(
    client.request(
      "thread/start",
      {
        cwd: workspace,
        model: MODEL,
        developerInstructions: "You are Ada, a careful assistant in an end-to-end smoke test.",
        dynamicTools: visibleDynamicTools("pi"),
      },
      (value) => getString(getRecord(value, "thread"), "id"),
    ),
  );
  if (!threadId) throw new Error("thread/start returned no thread id.");
  for (const turn of TURNS) {
    if (report.tokensUsed >= BUDGET) {
      report.problems.push(`Budget of ${BUDGET} tokens reached before ${turn.step}.`);
      break;
    }
    hostTools = [];
    piTools = [];
    const done = new Promise<void>((finish) => {
      completed = finish;
    });
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, model: MODEL, input: [{ type: "text", text: turn.prompt, text_elements: [] }] },
        (value) => value,
      ),
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      done,
      new Promise<never>((_, fail) => {
        deadline = setTimeout(() => fail(new Error(`${turn.step} did not complete in 10 minutes.`)), TURN_DEADLINE_MS);
      }),
    ]).finally(() => clearTimeout(deadline));
    const requests = await readRequests();
    report.tokensUsed += requests.reduce((total, request) => total + request.prompt + request.output, 0);
    const problems = [...failures.splice(0)];
    for (const tool of turn.tools)
      if (!piTools.some((call) => call.tool === tool && call.status === "completed"))
        problems.push(`Pi tool ${tool} did not complete.`);
    for (const tool of turn.hostTools) if (!hostTools.includes(tool)) problems.push(`The host did not answer ${tool}.`);
    if (requests.length === 0) problems.push("No request was measured.");
    for (const [index, request] of requests.entries()) {
      if (request.docs) problems.push(`Request ${index + 1} has Pi's <docs> section.`);
      if (!request.servers) problems.push(`Request ${index + 1} does not name the user's MCP server.`);
      if (!request.tools.some((name) => name.endsWith("ask_ui"))) problems.push(`Request ${index + 1} has no ask_ui.`);
      for (const hidden of SEARCH_ONLY)
        if (request.tools.some((name) => name.endsWith(hidden)))
          problems.push(`Request ${index + 1} declares ${hidden}.`);
    }
    report.turns.push({ step: turn.step, piTools, hostTools, requests, problems });
    report.problems.push(...problems.map((problem) => `${turn.step}: ${problem}`));
    process.stdout.write(
      `${turn.step.padEnd(22)} requests=${requests.length} pi=${[...new Set(piTools.map((call) => call.tool))].join(",") || "-"} ` +
        `host=${hostTools.join(",") || "-"} used=${report.tokensUsed}${problems.length ? ` problems=${problems.length}` : ""}\n`,
    );
  }
  report.commit = git(workspace, "log", "-1", "--format=%s").trim();
  report.hello = await readFile(join(workspace, "hello.txt"), "utf8").catch(() => null);
  if (report.commit !== "Add hello") report.problems.push(`The last commit is "${report.commit}", not "Add hello".`);
  if (report.hello?.trim() !== "42") report.problems.push("hello.txt does not contain 42.");
  if (git(workspace, "status", "--porcelain").includes("hello.txt"))
    report.problems.push("hello.txt has uncommitted changes.");
} catch (error) {
  report.problems.push(error instanceof Error ? error.message : String(error));
} finally {
  await stopClients([client]);
  await rm(root, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `\n${report.problems.length ? report.problems.join("\n") : "Passed."}\nReport: ${join(OUT, "report.json")}\n`,
);
process.exit(report.problems.length ? 1 : 0);
