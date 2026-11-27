import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  agentWriteAreas,
  checkAgentFolders,
  codexSandboxConfig,
  workspaceWritableRoots,
} from "../src/backend/agent/workspace-sandbox";
import type { AgentClient } from "../src/backend/agent-client";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { claudeWorkspaceSandbox } from "../src/backend/claude-workspace-sandbox";
import { resolveClaudeCli, resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeRecordResponse, decodeThreadResponse, decodeTurnResponse, isRecord } from "../src/backend/protocol";

type WriteResult = { tool: string; target: Target; path: string; written: boolean; output: string };
type Expectation = { name: string; expected: boolean; actual: boolean };
type Target = "workspace" | "shared" | "outside" | "own link" | "planted link" | "excluded" | "late link";
type ToolInput = { command: string; description: string } | { file_path: string; content: string };
type ToolStep = { path: string; name: string; input: (path: string) => ToolInput };
type ReplyBlock = { type: "tool_use"; id: string; name: string; input: ToolInput } | { type: "text"; text: string };
type RunResult =
  | { ok: boolean; codex: Awaited<ReturnType<typeof runCodex>>; claude: Awaited<ReturnType<typeof runClaude>> }
  | { ok: false; error: string };

const outputIndex = process.argv.indexOf("--output");
const outputRoot = resolve(
  (outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined) ?? ".openbot-build/workspace-symlink-roots",
);
await mkdir(outputRoot, { recursive: true });
const runRoot = await mkdtemp(join(outputRoot, "run-"));
const realRoot = join(runRoot, "real");
const viaLink = !process.argv.includes("--no-link");
const linkRoot = viaLink ? join(runRoot, "link") : realRoot;
const workspace = join(linkRoot, "workspace");
const shared = join(linkRoot, "Shared");
const outside = join(realRoot, "outside");
const ownLink = join(realRoot, "project-link");
const plantedLink = join(shared, "planted");
const excludedFolder = join(shared, "private");
const lateArea = join(linkRoot, "late");
const lateLink = join(lateArea, "app");
for (const folder of ["workspace", "Shared/private", "outside", "project", "secret", "late-secret", "late"]) {
  await mkdir(join(realRoot, folder), { recursive: true });
}
if (viaLink) await symlink("real", linkRoot);
await symlink("project", ownLink);
await symlink("../secret", join(realRoot, "Shared", "planted"));
await symlink("../late-secret", join(realRoot, "late", "app"));

const agent: Pick<AgentSummary, "id" | "access" | "provider" | "workspacePath" | "additionalFolders"> = {
  id: "workspace-symlink-roots-e2e",
  access: "workspace",
  provider: "claude",
  workspacePath: workspace,
  additionalFolders: [ownLink, plantedLink, lateLink],
};
const fullAccessAgent: Pick<AgentSummary, "id" | "access" | "workspacePath" | "additionalFolders"> = {
  id: "workspace-symlink-roots-e2e-full-access",
  access: "full",
  workspacePath: join(runRoot, "full-access-workspace"),
  additionalFolders: [runRoot],
};
await runCauseEffect(checkAgentFolders(agent));
const roots = workspaceWritableRoots(agent, shared);
const writeAreas = agentWriteAreas([agent, fullAccessAgent], shared);
const lateWriteAreas = [...writeAreas, lateArea];
const targets: Record<Target, string> = {
  workspace,
  shared,
  outside,
  "own link": ownLink,
  "planted link": plantedLink,
  excluded: excludedFolder,
  "late link": lateLink,
};
const blocked: readonly Target[] = ["outside", "planted link", "excluded", "late link"];
const expectations: Expectation[] = [];
const observations: WriteResult[] = [];

try {
  const codex = await runCodex();
  const claude = await runClaude();
  for (const result of [...codex.results, ...claude.results]) {
    expectations.push({
      name: `${result.tool} writes in ${result.target}`,
      expected: !blocked.includes(result.target),
      actual: result.written,
    });
  }
  const ok = expectations.every((expectation) => expectation.expected === expectation.actual);
  await writeReport({ ok, codex, claude });
  if (!ok) process.exitCode = 1;
} catch (error) {
  await writeReport({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  await rm(runRoot, { recursive: true, force: true });
}

async function writeReport(result: RunResult): Promise<void> {
  const report = {
    ...result,
    platform: process.platform,
    homeIsSymlink: await lstat("/home").then(
      (info) => info.isSymbolicLink(),
      () => null,
    ),
    viaLink,
    givenRoots: roots,
    writeAreas,
    lateWriteAreas,
    expectations,
    observations,
  };
  const path = join(outputRoot, "report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nReport: ${path}\n`);
}

async function runCodex() {
  const cli = await runCauseEffect(resolveCodexCli());
  const codexHome = join(runRoot, "codex-home");
  await mkdir(codexHome, { recursive: true });
  const write = async (tool: string, writableRoots: readonly string[], target: Target): Promise<WriteResult> => {
    const path = join(targets[target], `${tool.replaceAll(" ", "-")}.txt`);
    const run = await runProcess(
      cli.executable,
      [
        "sandbox",
        "-c",
        'sandbox_mode="workspace-write"',
        "-c",
        `sandbox_workspace_write.writable_roots=${JSON.stringify(writableRoots)}`,
        "--",
        "sh",
        "-c",
        'printf ok > "$1"',
        "sh",
        path,
      ],
      { cwd: workspace, env: { ...process.env, CODEX_HOME: codexHome } },
    );
    return { tool, target, path, written: await holdsOk(path), output: run.trim() };
  };
  const ownFolderAgent = { ...agent, additionalFolders: [ownLink] };
  const config = await runCauseEffect(codexSandboxConfig(ownFolderAgent, shared, writeAreas));
  const writableRoots = config.sandbox_workspace_write?.writable_roots ?? [];
  const results: WriteResult[] = [];
  for (const [target] of targetEntries().filter(([target]) =>
    ["workspace", "shared", "outside", "own link"].includes(target),
  )) {
    results.push(await write("codex shell", writableRoots, target));
  }
  const planted = await runCauseEffect(codexSandboxConfig(agent, shared, writeAreas));
  observations.push(
    await write("codex shell with planted folder", planted.sandbox_workspace_write?.writable_roots ?? [], "workspace"),
    await write("codex shell with planted folder, given paths only", roots, "workspace"),
  );
  return { cliVersion: cli.version, writableRoots, results };
}

async function runClaude() {
  const cli = await runCauseEffect(resolveClaudeCli());
  const sandbox = await runCauseEffect(claudeWorkspaceSandbox(roots, [excludedFolder], writeAreas));
  const steps = [
    ...targetEntries()
      .filter(([target]) => target !== "late link")
      .map(([target, folder]) => ({
        tool: "claude shell",
        target,
        path: join(folder, "claude-shell.txt"),
        name: "Bash",
        input: (path: string) => ({ command: `printf ok > '${path}'`, description: "Write a test file" }),
      })),
    ...targetEntries()
      .filter(([target]) => target !== "outside")
      .map(([target]) => ({
        tool: "claude edit tool",
        target,
        path: join(targets[target], "claude-edit.txt"),
        name: "Write",
        input: (path: string) => ({ file_path: path, content: "ok" }),
      })),
  ];
  const lateShell = {
    tool: "claude shell, link changed after start",
    target: "late link" as const,
    path: join(lateLink, "claude-shell.txt"),
    name: "Bash",
    input: (path: string) => ({ command: `printf ok > '${path}'`, description: "Write a test file" }),
  };
  steps.push(lateShell);
  const outputs = new Map<string, string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => fakeAnthropic(request, steps, outputs),
  });
  const configDirectory = join(runRoot, "claude-config");
  await mkdir(configDirectory, { recursive: true });
  Object.assign(process.env, {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
    ANTHROPIC_API_KEY: "sk-ant-e2e-fake",
    CLAUDE_CONFIG_DIR: configDirectory,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  const client = new ClaudeAgentClient(
    cli,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    join(runRoot, "claude-state"),
  );
  const approvals: string[] = [];
  client.on("request", (request) => {
    approvals.push(request.method);
    client.respond(request.id, { decision: "decline" });
  });
  client.start();
  try {
    await runCauseEffect(
      client.request(
        "initialize",
        { clientInfo: { name: "openbot_symlink_e2e", title: "OpenBot Symlink E2E", version: "0.1.0" } },
        decodeRecordResponse,
      ),
    );
    const threadParams = {
      model: "claude-sonnet-5",
      cwd: workspace,
      runtimeWorkspaceRoots: roots,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      workspaceOnly: true,
      excludedFolders: [excludedFolder],
      writeAreas,
      persistSession: false,
    };
    const started = await runCauseEffect(client.request("thread/start", threadParams, decodeThreadResponse));
    const completion = waitForTurn(client);
    await runCauseEffect(
      client.request(
        "turn/start",
        {
          ...threadParams,
          writeAreas: lateWriteAreas,
          threadId: started.thread.id,
          input: [{ type: "text", text: "Write the test files." }],
        },
        decodeTurnResponse,
      ),
    );
    await completion;
  } finally {
    await runCauseEffect(client.stop());
    await server.stop(true);
  }
  const results: WriteResult[] = [];
  for (const step of steps) {
    const result = {
      tool: step.tool,
      target: step.target,
      path: step.path,
      written: await holdsOk(step.path),
      output: outputs.get(step.path) ?? "",
    };
    if (step === lateShell) observations.push(result);
    else results.push(result);
  }
  return {
    cliVersion: cli.version,
    allowWrite: sandbox.filesystem?.allowWrite ?? [],
    denyWrite: sandbox.filesystem?.denyWrite ?? [],
    approvals,
    results,
  };
}

async function fakeAnthropic(
  request: Request,
  steps: readonly ToolStep[],
  outputs: Map<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 1 });
  if (!url.pathname.endsWith("/v1/messages")) return Response.json({}, { status: 404 });
  const body = await request.json();
  const messages = isDynamicRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  const tools = isDynamicRecord(body) && Array.isArray(body.tools) ? body.tools : [];
  const results = messages.flatMap((message) =>
    isDynamicRecord(message) && Array.isArray(message.content)
      ? message.content.filter((block) => isDynamicRecord(block) && block.type === "tool_result")
      : [],
  );
  for (const result of results) {
    if (!isDynamicRecord(result) || !isString(result.tool_use_id)) continue;
    const step = steps[Number(result.tool_use_id.replace("toolu_e2e_", ""))];
    if (step) outputs.set(step.path, JSON.stringify(result.content ?? ""));
  }
  const usesTools = tools.some((tool) => isDynamicRecord(tool) && tool.name === "Bash");
  const step = usesTools ? steps[results.length] : undefined;
  const block: ReplyBlock = step
    ? { type: "tool_use", id: `toolu_e2e_${results.length}`, name: step.name, input: step.input(step.path) }
    : { type: "text", text: "done" };
  return streamMessage(block, step ? "tool_use" : "end_turn");
}

function streamMessage(block: ReplyBlock, stopReason: string): Response {
  const start =
    block.type === "tool_use"
      ? { ...block, input: {} }
      : {
          type: "text",
          text: "",
        };
  const delta =
    block.type === "tool_use"
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text };
  const events = [
    {
      type: "message_start",
      message: {
        id: `msg_e2e_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: start },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const text = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

function waitForTurn(client: AgentClient): Promise<void> {
  return new Promise((done, fail) => {
    const timeout = setTimeout(() => fail(new Error("The Claude turn did not finish in 120 seconds.")), 120_000);
    client.on("notification", (notification) => {
      if (notification.method !== "turn/completed" || !isRecord(notification.params)) return;
      clearTimeout(timeout);
      done();
    });
  });
}

function targetEntries(): [Target, string][] {
  return [
    ["workspace", targets.workspace],
    ["shared", targets.shared],
    ["outside", targets.outside],
    ["own link", targets["own link"]],
    ["planted link", targets["planted link"]],
    ["excluded", targets.excluded],
    ["late link", targets["late link"]],
  ];
}

async function holdsOk(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    (text) => text === "ok",
    () => false,
  );
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", fail);
    child.on("close", () => done(output));
  });
}
