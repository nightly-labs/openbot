// Smoke test of a real OpenBot Claude agent session with the prompt settings that
// `claude-client.ts` sends. Runs the real Claude CLI with the user's Claude login, on Claude Haiku,
// through `ClaudeAgentClient`, in a temporary git workspace. One thread runs these turns:
//   1. the core tools: TaskCreate, Bash, Write, Edit and Read,
//   2. an `Explore` subagent,
//   3. a skill that the agent sees by name only (`dataviz`),
//   4. a deferred tool: ToolSearch loads WebSearch, which searches once,
//   5. a git commit, which must have no Claude co-author line.
// The checks also confirm that the init message has none of the Claude Code host tools or unfit skills.
// Costs a few Haiku turns and one web search. `bun run smoke:claude-agent`; `--setup=on` turns the
// user's Claude Code setup on; `--model=<id>` replaces Claude Haiku.
// Writes .openbot-build/claude-agent-smoke/report-setup-<on|off>.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_HOST_TOOLS, CLAUDE_UNFIT_SKILLS, ClaudeAgentClient } from "../src/backend/claude-client";
import { resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const userSetup = argument("setup") === "on";
const MODEL = argument("model") ?? "claude-haiku-5-5";
const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-agent-smoke");

const TURNS: Array<{ step: string; prompt: string; expect: string[] }> = [
  {
    step: "core tools",
    prompt:
      "Do these steps in order, with these exact tools. 1) TaskCreate: one task named `Smoke steps`. " +
      "2) Bash: run `git status --short`. 3) Write: create hello.txt with the text `hello`. " +
      "4) Edit: change `hello` to `hello world` in hello.txt. 5) Read: read hello.txt. Then reply with its text.",
    expect: ["TaskCreate", "Bash", "Write", "Edit", "Read"],
  },
  {
    step: "subagent",
    prompt:
      "Use the Agent tool with subagent_type `Explore` to find which file in this folder holds the number 42. " +
      "Reply with the file name only.",
    expect: ["Agent"],
  },
  {
    step: "name-only skill",
    prompt:
      "Call the Skill tool once with skill `dataviz`. Do not make a chart and do not change files. " +
      "Reply with the first heading of the skill text you got.",
    expect: ["Skill"],
  },
  {
    step: "deferred tool",
    prompt:
      "Use ToolSearch to load the WebSearch tool, then call WebSearch once for `Claude Code attribution setting`. " +
      "Reply with the title of the first result.",
    expect: ["ToolSearch", "WebSearch"],
  },
  {
    step: "commit",
    prompt:
      "Commit hello.txt with git through Bash, with the message `Add hello`. Follow your usual commit rules. " +
      "Then reply with the output of `git log -1 --format=%B`.",
    expect: ["Bash"],
  },
];

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-claude-smoke-")));
const workspace = join(root, "ws");
mkdirSync(workspace);
await writeFile(join(workspace, "notes.md"), "# Garden plan\n\nTomatoes by the wall.\n");
await writeFile(join(workspace, "count.txt"), "42\n");
const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
git("init", "-q");
git("remote", "add", "origin", workspace);
git("config", "user.name", "OpenBot Smoke");
git("config", "user.email", "smoke@openbot.invalid");
git("add", ".");
git("commit", "-q", "-m", "Start");
git("fetch", "-q", "origin");
git("remote", "set-head", "origin", "-a");

interface TurnLog {
  step: string;
  tools: string[];
  subagentTools: string[];
  toolErrors: string[];
  reply: string;
  expectMissing: string[];
  requests: number;
  prompt: number;
}
let current: TurnLog | null = null;
let init: { tools: string[]; skills: string[]; agents: string[] } | null = null;
const requestIds = new Map<string, number>();

const createQuery = (params: Parameters<typeof query>[0]) => {
  const real = query(params);
  const iterate = real[Symbol.asyncIterator].bind(real);
  return Object.assign(real, {
    async *[Symbol.asyncIterator]() {
      const iterator = iterate();
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        const message = next.value;
        if (message.type === "system" && message.subtype === "init" && !init) {
          const n = (v: unknown) =>
            Array.isArray(v) ? v.map((e) => (typeof e === "string" ? e : (getString(e, "name") ?? ""))).sort() : [];
          init = { tools: [...message.tools].sort(), skills: n(message.skills), agents: n(message.agents) };
        }
        if (message.type === "assistant" && current) {
          for (const block of message.message.content) {
            if (block.type === "tool_use")
              (message.parent_tool_use_id ? current.subagentTools : current.tools).push(block.name);
            if (block.type === "text" && !message.parent_tool_use_id) current.reply = block.text;
          }
          if (!message.parent_tool_use_id) {
            const u = message.message.usage;
            requestIds.set(
              message.message.id,
              u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            );
          }
        }
        if (message.type === "user" && current && Array.isArray(message.message.content)) {
          for (const block of message.message.content)
            if (typeof block === "object" && block.type === "tool_result" && block.is_error)
              current.toolErrors.push(JSON.stringify(block.content).slice(0, 300));
        }
        yield message;
      }
    },
  });
};

const cli = await runCauseEffect(resolveClaudeCli());
const client = new ClaudeAgentClient(
  cli,
  createQuery,
  undefined,
  300_000,
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
  // A turn can end as failed or interrupted with no error notification.
  const status = getString(getRecord(notification.params, "turn"), "status");
  if (status !== "completed") failures.push(`turn ended as ${status ?? "unknown"}`);
  const threadId = getString(notification.params, "threadId");
  if (threadId) completions.get(threadId)?.();
});
client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
client.start();

const turns: TurnLog[] = [];
let error: string | undefined;
try {
  const threadId = await runCauseEffect(
    client.request(
      "thread/start",
      { cwd: workspace, model: MODEL, developerInstructions: "You are Ada, a careful assistant in a smoke test." },
      (value) => {
        const id = getString(getRecord(value, "thread"), "id");
        if (!id) throw new Error("no thread id");
        return id;
      },
    ),
  );
  for (const turn of TURNS) {
    current = {
      step: turn.step,
      tools: [],
      subagentTools: [],
      toolErrors: [],
      reply: "",
      expectMissing: [],
      requests: 0,
      prompt: 0,
    };
    requestIds.clear();
    const done = new Promise<void>((resolve) => completions.set(threadId, resolve));
    await runCauseEffect(
      client.request("turn/start", { threadId, model: MODEL, input: [{ type: "text", text: turn.prompt }] }, (v) => v),
    );
    await done;
    current.expectMissing = turn.expect.filter((tool) => !current?.tools.includes(tool));
    current.requests = requestIds.size;
    current.prompt = [...requestIds.values()].reduce((a, b) => a + b, 0);
    turns.push(current);
    process.stdout.write(
      `${turn.step.padEnd(16)} tools=${current.tools.join(",")} sub=${current.subagentTools.length} ` +
        `errors=${current.toolErrors.length} missing=${current.expectMissing.join(",") || "-"} ` +
        `requests=${current.requests} prompt=${current.prompt}\n  reply: ${current.reply.replace(/\s+/g, " ").slice(0, 160)}\n`,
    );
    if (failures.length > 0) throw new Error(failures.join("; "));
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  await runCauseEffect(client.stop()).catch(() => undefined);
}

const commitMessage = git("log", "-1", "--format=%B");
const hello = await Bun.file(join(workspace, "hello.txt"))
  .text()
  .catch(() => "");
// The init message lists agent types without the `Agent(...)` denies, so only the tools are checked.
const hostTools = [
  ...CLAUDE_HOST_TOOLS.filter((tool) => !tool.startsWith("Agent(")),
  "RemoteTrigger",
  "CronCreate",
  "Workflow",
  "Artifact",
];
const checks = {
  initSeen: init !== null,
  helloFile: hello.trim() === "hello world",
  committed: commitMessage.startsWith("Add hello"),
  noCoAuthor: !/co-authored-by|generated with/i.test(commitMessage),
  hostToolsPresent: hostTools.filter((tool) => init?.tools.includes(tool)),
  unfitSkillsPresent: CLAUDE_UNFIT_SKILLS.filter((skill) => init?.skills.includes(skill)),
  everyExpectedToolUsed: turns.every((turn) => turn.expectMissing.length === 0),
  noToolErrors: turns.every((turn) => turn.toolErrors.length === 0),
};
const report = { cli: cli.version, model: MODEL, userSetup, init, turns, commitMessage, checks, error };

const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
for (const entry of await readdir(projects).catch(() => []))
  if (entry.includes(basename(root))) await rm(join(projects, entry), { recursive: true, force: true });
await rm(root, { recursive: true, force: true });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `report-setup-${userSetup ? "on" : "off"}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `\ncommit message:\n${commitMessage}\nchecks: ${JSON.stringify(checks)}\n${error ? `error: ${error}\n` : ""}`,
);
const passed =
  checks.initSeen &&
  checks.helloFile &&
  checks.committed &&
  checks.noCoAuthor &&
  checks.hostToolsPresent.length === 0 &&
  checks.unfitSkillsPresent.length === 0 &&
  checks.everyExpectedToolUsed &&
  checks.noToolErrors;
process.exit(error || !passed ? 1 : 0);
