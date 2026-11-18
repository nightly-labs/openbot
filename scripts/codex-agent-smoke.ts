// Smoke test of a real OpenBot Codex agent thread with the prompt settings that `thread-lifecycle.ts`
// sends. Runs the real `codex app-server` with a copy of the user's Codex login (see
// `codex-agent-harness.ts`), on GPT-6 Luna, in a temporary git workspace. One thread runs these turns:
//   1. the core tools: update_plan, a shell command and apply_patch,
//   2. a subagent: Codex reports the spawn as `subAgentActivity` items,
//   3. a skill that Codex lists (`skill-creator`),
//   4. a deferred OpenBot tool: tool_search finds it and tool_call runs it. The smoke answers both,
//      as the OpenBot tool router does,
//   5. a direct browser tool: `openbot_browser.list_tabs` with no tool_search or tool_call. The smoke
//      answers it with a fixed tab,
//   6. a web search with Codex's own inline search (a `webSearch` item),
//   7. a git commit.
// The checks also confirm, from the thread's rollout file, that the first request declares `web__run`,
// the direct browser tools `open`, `list_tabs` and `run_script`, and no `request_plugin_install`, that the OpenBot catalog does not name `openbot.web_search`, and
// that the prompt lists none of the unfit skills.
// Costs a few GPT-6 Luna turns. `bun run smoke:codex-agent`; `--model=<id>`
// replaces GPT-6 Luna. Writes .openbot-build/codex-agent-smoke/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { CODEX_UNFIT_SKILLS } from "../src/backend/agent/codex-prompt-settings";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getRecord, getString, isRecord } from "../src/backend/protocol";
import {
  answerCatalogTool,
  listsSkill,
  makeCodexHome,
  makeGitWorkspace,
  openbotConfig,
  promptContents,
  removeRun,
  startCodexAgent,
  toolCallParams,
} from "./codex-agent-harness";

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const MODEL = argument("model") ?? "gpt-6-luna";
const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-agent-smoke");
const ECHO_TOOL = "smoke_echo";
const ECHO_TEXT = "smoke-echo-7341";
const BROWSER_NAMESPACE = "openbot_browser";
const TAB_TITLE = "Smoke tab 5512";
const DIRECT_BROWSER_TOOLS = ["open", "list_tabs", "run_script"];

const TURNS: Array<{ step: string; prompt: string; expect: string[] }> = [
  {
    step: "core tools",
    prompt:
      "Do these steps in order. 1) update_plan: a plan with the single step `Smoke steps`. " +
      "2) Run `git status --short` in the shell. 3) apply_patch: create hello.txt with the text `hello`. " +
      "4) apply_patch: change `hello` to `hello world` in hello.txt. 5) Read hello.txt in the shell. Then reply with its text.",
    expect: ["update_plan", "commandExecution", "fileChange"],
  },
  {
    step: "subagent",
    prompt:
      "Spawn one subagent with spawn_agent. Tell it to find which file in this folder holds the number 42. " +
      "Wait for its answer, then reply with the file name only.",
    expect: ["subAgentActivity", "collabAgentToolCall:wait"],
  },
  {
    step: "skill",
    prompt:
      "Open the `skill-creator` skill: read its SKILL.md in the shell. Do not make a skill and do not change files. " +
      "Reply with the first heading of the skill text.",
    expect: ["commandExecution:skill-creator"],
  },
  {
    step: "deferred tool",
    prompt:
      `Use the OpenBot tool_search tool to find the \`${ECHO_TOOL}\` tool, then run it once with tool_call. ` +
      "Reply with the text it returns.",
    expect: ["dynamicToolCall:tool_search", "dynamicToolCall:tool_call"],
  },
  {
    step: "browser tool",
    prompt:
      "List the tabs of the OpenBot browser with its list_tabs tool. Do not open a page. " +
      "Reply with the title of the first tab.",
    expect: ["dynamicToolCall:list_tabs"],
  },
  {
    step: "web search",
    prompt:
      "Search the web: what is the latest release of the OpenAI Codex CLI? Reply with its version and a source URL.",
    expect: ["webSearch"],
  },
  {
    step: "commit",
    prompt:
      "Commit hello.txt with git in the shell, with the message `Add hello`. " +
      "Then reply with the output of `git log -1 --format=%B`.",
    expect: ["commandExecution:git commit"],
  },
];

interface TurnLog {
  step: string;
  items: string[];
  reply: string;
  expectMissing: string[];
  requests: number;
  input: number;
  error?: string;
}

/** True when `label` has the type of `expected` and holds the text after its first colon. */
function matches(label: string, expected: string): boolean {
  const [type = "", ...rest] = expected.split(":");
  return label.split(":")[0] === type && label.includes(rest.join(":"));
}

/** A short label of an item: its type, and the tool or the command. A `tool_call` adds the tool that it calls. */
function itemLabel(item: DynamicRecord): string {
  const type = getString(item, "type") ?? "?";
  if (type === "commandExecution") return `${type}:${(getString(item, "command") ?? "").slice(0, 200)}`;
  const tool = getString(item, "tool");
  const called = tool === "tool_call" ? getString(getRecord(item, "arguments"), "name") : undefined;
  return tool ? `${type}:${tool}${called ? `:${called}` : ""}` : type;
}

/** The tools of the browser namespace that the model called directly. */
const browserCalls: string[] = [];

/**
 * Answers `tool_search` and `tool_call` as the OpenBot tool router does, with the fixed echo tool added,
 * and a direct `openbot_browser.list_tabs` with one fixed tab.
 */
async function answerTool(params: DynamicRecord): Promise<{ text: string; success: boolean }> {
  if (getString(params, "namespace") === BROWSER_NAMESPACE) {
    const tool = getString(params, "tool") ?? "";
    browserCalls.push(tool);
    return tool === "list_tabs"
      ? { text: JSON.stringify([{ tabId: "tab-1", title: TAB_TITLE, url: "https://example.com/" }]), success: true }
      : { text: "Not available here.", success: false };
  }
  const call = toolCallParams(params);
  const named = JSON.stringify(call.arguments).includes(ECHO_TOOL);
  if (call.tool === "tool_search" && named)
    return {
      text: `${ECHO_TOOL}: Returns a fixed text. Run it with tool_call {name: "${ECHO_TOOL}", arguments: {}}.`,
      success: true,
    };
  if (call.tool === "tool_call" && named) return { text: ECHO_TEXT, success: true };
  // The catalog of a Codex agent has no `openbot.web_search`, so no call reaches the search.
  return answerCatalogTool(call, () => Promise.reject(new Error("A Codex agent has no openbot.web_search.")));
}

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-codex-smoke-")));
const workspace = join(root, "ws");
const git = await makeGitWorkspace(workspace);
const home = await makeCodexHome(join(root, "home"));
const cli = await runCauseEffect(resolveCodexCli());

const agent = await startCodexAgent(cli, home, workspace, async (request) => {
  if (request.method !== "item/tool/call" || !isRecord(request.params)) return undefined;
  const { text, success } = await answerTool(request.params);
  return { contentItems: [{ type: "inputText", text }], success };
});

let current: TurnLog | null = null;
agent.client.on("notification", (notification) => {
  if (!current || !isRecord(notification.params)) return;
  if (notification.method === "turn/plan/updated") current.items.push("update_plan");
  if (notification.method === "item/completed") {
    const item = getRecord(notification.params, "item");
    if (!item) return;
    current.items.push(itemLabel(item));
    if (getString(item, "type") === "agentMessage") current.reply = getString(item, "text") ?? "";
  }
});

const turns: TurnLog[] = [];
let thread: { id: string; path: string } | null = null;
let commitMessage = "";
const prompt: {
  requestPluginInstall: boolean;
  webRun: boolean;
  catalogWebSearch: boolean;
  browserTools: string[];
  toolNames: string[];
  unfitSkills: string[];
  skillCreatorListed: boolean;
} = {
  requestPluginInstall: false,
  webRun: false,
  catalogWebSearch: false,
  browserTools: [],
  toolNames: [],
  unfitSkills: [],
  skillCreatorListed: false,
};
try {
  thread = await agent.startThread(workspace, MODEL, openbotConfig(agent.read));
  for (const turn of TURNS) {
    current = { step: turn.step, items: [], reply: "", expectMissing: [], requests: 0, input: 0 };
    try {
      const requests = await agent.runTurn(thread.id, turn.prompt, 300_000);
      current.requests = requests.length;
      current.input = requests.reduce((total, usage) => total + usage.input, 0);
    } catch (error) {
      current.error = error instanceof Error ? error.message : String(error);
    }
    const labels = current.items;
    current.expectMissing = turn.expect.filter((expected) => !labels.some((label) => matches(label, expected)));
    turns.push(current);
    process.stdout.write(
      `${turn.step.padEnd(14)} requests=${current.requests} input=${current.input} ` +
        `missing=${current.expectMissing.join(",") || "-"} reply=${JSON.stringify(current.reply.slice(0, 80))}` +
        `${current.error ? ` (failed: ${current.error})` : ""}\n`,
    );
  }
  const contents = await promptContents(thread.path);
  prompt.requestPluginInstall = contents.tools.includes("request_plugin_install");
  prompt.webRun = contents.tools.includes("web__run");
  prompt.catalogWebSearch = contents.tools.includes("openbot.web_search");
  prompt.toolNames = [...new Set(Array.from(contents.tools.matchAll(/"name":"([^"]+)"/g), (match) => match[1] ?? ""))];
  const declared: Array<{ name?: string; tools?: Array<{ name?: string }> }> = JSON.parse(contents.tools);
  const browserNamespace = declared.find((tool) => tool.name === BROWSER_NAMESPACE);
  prompt.browserTools = (browserNamespace?.tools ?? []).map((tool) => tool.name ?? "");
  prompt.unfitSkills = CODEX_UNFIT_SKILLS.filter((skill) => listsSkill(contents.context, skill));
  prompt.skillCreatorListed = listsSkill(contents.context, "skill-creator");
  commitMessage = git("log", "-1", "--format=%B").trim();
} finally {
  await agent.stop();
  await removeRun(root);
}

const failures = [
  ...turns.filter((turn) => turn.error).map((turn) => `${turn.step}: ${turn.error}`),
  ...turns
    .filter((turn) => turn.expectMissing.length > 0)
    .map((turn) => `${turn.step}: no ${turn.expectMissing.join(", ")}`),
  ...(turns.find((turn) => turn.step === "deferred tool")?.reply.includes(ECHO_TEXT)
    ? []
    : ["deferred tool: wrong reply"]),
  ...(turns.find((turn) => turn.step === "browser tool")?.reply.includes(TAB_TITLE)
    ? []
    : ["browser tool: wrong reply"]),
  ...(browserCalls.includes("list_tabs") ? [] : [`browser tool: no direct ${BROWSER_NAMESPACE}.list_tabs call`]),
  ...(DIRECT_BROWSER_TOOLS.every((tool) => prompt.browserTools.includes(tool))
    ? []
    : [`the prompt declares ${BROWSER_NAMESPACE} tools ${JSON.stringify(prompt.browserTools)}`]),
  ...(commitMessage === "Add hello" ? [] : [`commit: last message is ${JSON.stringify(commitMessage)}`]),
  ...(prompt.requestPluginInstall ? ["the prompt declares request_plugin_install"] : []),
  ...(prompt.webRun ? [] : ["the prompt declares no web__run"]),
  ...(prompt.catalogWebSearch ? ["the OpenBot catalog names openbot.web_search"] : []),
  ...prompt.unfitSkills.map((skill) => `the prompt lists ${skill}`),
  ...(prompt.skillCreatorListed ? [] : ["the prompt does not list skill-creator"]),
];
const report = {
  codexVersion: cli.version,
  model: MODEL,
  passed: failures.length === 0,
  failures,
  prompt,
  browserCalls,
  commitMessage,
  turns,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `\n${report.passed ? "passed" : `failed: ${failures.join("; ")}`}\nReport: ${join(OUT, "report.json")}\n`,
);
process.exit(report.passed ? 0 : 1);
