// Runs the real `opencode` provider driver and the real OpenCode binary against a fake
// OpenAI-compatible server (`opencode-agent-harness.ts`), to check the Code Mode catalog that each
// request carries. OpenBot denies OpenCode's `session_*` and `worktree_*` tools: OpenBot names its own
// chats, and `session_move` would move the session out of the agent's workspace. `worktree_remove`
// stays, because OpenCode checks it with the `edit` permission. OpenBot's MCP servers serve no
// resources, so `opencode-agent-defaults.ts` also denies the two MCP resource tools. The user's own
// config denies `opencode_models`, so the catalog also shows that OpenCode keeps the user's rules
// beside OpenBot's.
// `OPENCODE_CLI=<opencode> bun scripts/opencode-tool-trim-e2e.ts`.
// Writes .openbot-build/opencode-tool-trim-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codeModeCatalog, OPENCODE_MODEL, startOpenCodeHarness } from "./opencode-agent-harness";
import { runTurn, startThread } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-tool-trim-e2e");
const NL = "\n";
const DENIED = [
  "session_move",
  "session_rename",
  "worktree_create",
  "worktree_list",
  "list_mcp_resources",
  "read_mcp_resource",
];
const KEPT = ["worktree_remove"];
/** Denied by the user's own config. */
const USER_DENIED = "models";

interface Request {
  bytes: number;
  /** The names after `tools.opencode.` in the system prompt. */
  catalog: string[];
}

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  requests: Request[];
  turn?: { error: string | null; status: string | null };
  error?: string;
}

const report: Report = { passed: false, requests: [] };
const harness = await startOpenCodeHarness("opencode-trim-e2e");

try {
  report.openCodeVersion = harness.cli.version ?? "unknown";
  await harness.writeGlobalConfig({ permission: { [`opencode_${USER_DENIED}`]: "deny" } });
  harness.script = () => ({ text: "done" });

  const client = harness.createClient();
  client.start();
  const thread = await startThread(client, { cwd: harness.workspace, model: OPENCODE_MODEL });
  const turn = await runTurn(client, thread, { text: "Say one word.", timeoutMs: 120_000 });
  report.turn = { error: turn.error, status: turn.status };
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);

  report.requests = harness.requests
    .filter((request) => request.tools.length > 0)
    .map((request) => ({
      bytes: JSON.stringify(request.body).length,
      catalog: codeModeCatalog(request.system).opencode,
    }));
  assert.ok(report.requests.length > 0, "OpenCode sent no request with tools.");
  for (const { catalog } of report.requests) {
    for (const name of DENIED) assert.ok(!catalog.includes(name), `The catalog lists ${name}: ${catalog.join(", ")}`);
    for (const name of KEPT)
      assert.ok(catalog.includes(name), `The catalog does not list ${name}: ${catalog.join(", ")}`);
    assert.ok(!catalog.includes(USER_DENIED), `OpenCode dropped the user's rule: ${catalog.join(", ")}`);
  }
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
