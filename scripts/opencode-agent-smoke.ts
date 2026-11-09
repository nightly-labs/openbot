// Checks that an OpenCode agent still does its work with the rules of `opencode-agent-defaults.ts`.
// Runs the real `opencode` provider driver and the real OpenCode binary against a fake model on
// loopback (`opencode-agent-harness.ts`), with the OpenBot tools of a real agent. In one turn the model
// calls `write`, `read`, `edit`, `shell`, `glob`, `grep`, a `general` subagent, and `execute` with the
// OpenBot `ask_user` tool, which the Code Mode catalog does not show. Then a second process starts
// with the user's own rules: a global config with the catch-all `"*": "allow"`, a pattern that allows
// `opencode_read_mcp_resource` and a pattern that allows the `report` skill, and a project rule that
// allows `question`. The user's rules must win, and OpenBot's other rules must stay.
// `OPENCODE_CLI=<opencode> bun run smoke:opencode-agent`. Writes .openbot-build/opencode-agent-smoke/report.json.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import {
  codeModeCatalog,
  type Json,
  listedSkills,
  type ModelAnswer,
  type ModelRequest,
  OPENCODE_MODEL,
  startOpenCodeHarness,
} from "./opencode-agent-harness";
import { runTurn } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-agent-smoke");
const NL = "\n";
const SUBAGENT_MARKER = "SMOKE-SUBAGENT";
const ANSWER = "Blue, please.";

interface StepReport {
  tool: string;
  /** The tool result that OpenCode sent back to the model, shortened. */
  result: string;
}

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  firstRequest?: { tools: string[]; skills: string[]; catalog: ReturnType<typeof codeModeCatalog> };
  steps: StepReport[];
  hostRequests: string[];
  openbotToolCalls: string[];
  subagentRequests: number;
  file?: string;
  userRules?: { tools: string[]; skills: string[]; catalog: ReturnType<typeof codeModeCatalog>; defaults: Json };
  error?: string;
}

const report: Report = { passed: false, steps: [], hostRequests: [], openbotToolCalls: [], subagentRequests: 0 };
const harness = await startOpenCodeHarness("opencode-agent-smoke");
const { workspace } = harness;
const file = join(workspace, "a.txt");

const steps: ModelAnswer[] = [
  { tool: "write", arguments: { path: file, content: `alpha${NL}` } },
  { tool: "read", arguments: { path: file } },
  { tool: "edit", arguments: { path: file, oldString: "alpha", newString: "beta" } },
  { tool: "shell", arguments: { command: "cat a.txt", workdir: workspace } },
  { tool: "glob", arguments: { pattern: "*.txt", path: workspace } },
  { tool: "grep", arguments: { pattern: "beta", path: workspace } },
  {
    tool: "subagent",
    arguments: { agent: "general", description: "Check the file", prompt: `${SUBAGENT_MARKER}: reply with done.` },
  },
  {
    tool: "execute",
    arguments: {
      code: 'return await tools.openbot.ask_user({ questions: [{ id: "color", question: "Which color?" }] });',
    },
  },
];

/** The text of the last tool result in a request. */
function lastToolResult(request: ModelRequest): string {
  const tool = getArray(request.body, "messages")
    .filter((message) => getString(message, "role") === "tool")
    .at(-1);
  const content = isRecord(tool) ? tool.content : "";
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function answerHost(client: AgentClient): void {
  client.on("request", (request) => {
    report.hostRequests.push(request.method);
    if (request.method === "item/tool/call") {
      const tool = getString(request.params, "tool") ?? "";
      report.openbotToolCalls.push(`${getString(request.params, "namespace") ?? ""}.${tool}`);
      client.respond(request.id, { success: true, contentItems: [{ type: "inputText", text: ANSWER }] });
      return;
    }
    // A permission request: OpenBot's own approval flow is not under test here.
    client.respond(request.id, { decision: "accept" });
  });
}

async function startAgentThread(client: AgentClient): Promise<string> {
  const response = await runCauseEffect(
    client.request(
      "thread/start",
      {
        cwd: workspace,
        model: OPENCODE_MODEL,
        developerInstructions: "You are Ada, a careful assistant in an end-to-end smoke test.",
        dynamicTools: visibleDynamicTools("opencode"),
      },
      (value) => value,
    ),
  );
  const id = getString(getRecord(response, "thread"), "id");
  if (!id) throw new Error("thread/start answers no thread id.");
  return id;
}

try {
  report.openCodeVersion = harness.cli.version ?? "unknown";
  delete process.env.OPENCODE_CONFIG;
  await harness.writeGlobalConfig({});

  // Part 1: OpenBot's rules, and every core tool in one turn.
  harness.script = (request) => {
    if (request.lastUser.includes(SUBAGENT_MARKER)) {
      report.subagentRequests += 1;
      return { text: "done" };
    }
    if (request.toolResults > 0) {
      const previous = steps[request.toolResults - 1];
      if (previous && "tool" in previous)
        report.steps.push({ tool: previous.tool, result: lastToolResult(request).slice(0, 400) });
    }
    return steps[request.toolResults] ?? { text: "All steps done." };
  };
  const client = harness.createClient();
  answerHost(client);
  client.start();
  const thread = await startAgentThread(client);
  const turn = await runTurn(client, thread, { text: "Run the smoke steps.", timeoutMs: 240_000 });
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  assert.match(turn.reply, /All steps done/u);

  const first = harness.requests.find((request) => request.tools.length > 0);
  assert.ok(first, "OpenCode sent no request with tools.");
  const catalog = codeModeCatalog(first.system);
  report.firstRequest = { tools: [...first.tools].sort(), skills: listedSkills(first.system), catalog };
  assert.ok(!first.tools.includes("question"), "The request still offers the question tool.");
  for (const skill of ["report", "opencode"])
    assert.ok(!report.firstRequest.skills.includes(skill), `The request still lists the ${skill} skill.`);
  for (const tool of ["list_mcp_resources", "read_mcp_resource"])
    assert.ok(!catalog.opencode.includes(tool), `The catalog still lists ${tool}.`);
  for (const tool of ["write", "read", "edit", "shell", "glob", "grep", "subagent", "skill", "webfetch", "execute"])
    assert.ok(first.tools.includes(tool), `The request does not offer ${tool}.`);
  assert.ok(catalog.opencode.includes("models"), "The catalog lost opencode.models.");

  assert.deepEqual(
    report.steps.map((step) => step.tool),
    steps.flatMap((step) => ("tool" in step ? [step.tool] : [])),
  );
  for (const step of report.steps)
    assert.ok(!/"error"|Invalid arguments/u.test(step.result), `${step.tool} failed: ${step.result}`);
  report.file = await readFile(file, "utf8");
  assert.equal(report.file, `beta${NL}`);
  const result = (tool: string) => report.steps.find((step) => step.tool === tool)?.result ?? "";
  assert.match(result("read"), /alpha/u);
  assert.match(result("shell"), /beta/u);
  assert.match(result("glob"), /a\.txt/u);
  assert.match(result("grep"), /a\.txt/u);
  assert.ok(report.subagentRequests > 0, "The subagent sent no request.");
  assert.match(result("subagent"), /done/u);
  assert.deepEqual(report.openbotToolCalls, ["openbot.ask_user"]);
  assert.ok(result("execute").includes(ANSWER), `execute did not return the answer: ${result("execute")}`);
  await runCauseEffect(client.stop());

  // Part 2: the user's own rules win.
  await harness.writeGlobalConfig({
    permission: { "*": "allow", "opencode_read_mcp_*": "allow", skill: { "rep*": "allow" } },
  });
  await writeFile(join(workspace, "opencode.json"), `${JSON.stringify({ permission: { question: "allow" } })}${NL}`);
  harness.script = () => ({ text: "OK" });
  const userClient = harness.createClient();
  answerHost(userClient);
  userClient.start();
  const userThread = await startAgentThread(userClient);
  const userTurn = await runTurn(userClient, userThread, { text: "Reply with OK.", timeoutMs: 120_000 });
  assert.equal(userTurn.error, null, `The turn failed: ${userTurn.error}`);
  const userRequest = harness.requests.filter((request) => request.tools.length > 0).at(-1);
  assert.ok(userRequest, "OpenCode sent no request with tools.");
  const defaults = JSON.parse(
    await readFile(join(harness.root, "provider-state", "opencode", "openbot-agent-defaults.json"), "utf8"),
  );
  report.userRules = {
    tools: [...userRequest.tools].sort(),
    skills: listedSkills(userRequest.system),
    catalog: codeModeCatalog(userRequest.system),
    defaults,
  };
  assert.ok(userRequest.tools.includes("question"), "The project rule did not bring back the question tool.");
  assert.ok(report.userRules.skills.includes("report"), "The global pattern did not keep the report skill.");
  assert.ok(
    report.userRules.catalog.opencode.includes("read_mcp_resource"),
    "The global pattern did not keep opencode.read_mcp_resource.",
  );
  // The catch-all `"*"` does not count as a choice about these rules.
  assert.ok(!report.userRules.skills.includes("opencode"), "OpenBot's rule for the opencode skill is gone.");
  assert.ok(
    !report.userRules.catalog.opencode.includes("list_mcp_resources"),
    "The catalog lists list_mcp_resources again.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await harness.stop();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
