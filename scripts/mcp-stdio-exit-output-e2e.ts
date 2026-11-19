/**
 * The connection test of a stdio MCP server says why the server stopped (#10137).
 *
 * Starts real stdio servers through `testMcpServer` and checks these cases:
 * - a server that writes its reason to stderr and stops shows that reason, and a configured
 *   secret value that it writes is masked;
 * - a server that stops without output keeps the old message;
 * - a server that writes 200 KB to stderr and answers each request after 1 second still passes,
 *   because the pipe is read all the time;
 * - a long stderr keeps only its end, within the error limit;
 * - a secret value that crosses the point where the shown end starts is masked, not shown in part;
 * - the colour codes of a terminal logger are removed.
 *
 * Writes `.openbot-build/mcp-stdio-exit-output-e2e.json`.
 *
 * Run: `bun scripts/mcp-stdio-exit-output-e2e.ts`
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { testMcpServer } from "../src/backend/mcp-probe";

const SECRET = "wp-secret-7f3a9c1e5b";

/** A stdio MCP server: `MODE` chooses how it fails or answers. */
const SERVER = `
const mode = process.env.MODE;
if (mode === "reason") {
  process.stderr.write("Loading config\\n");
  process.stderr.write("Error: WP_URL is not set (token " + process.env.WP_TOKEN + ")\\n");
  process.exit(1);
}
if (mode === "silent") process.exit(1);
if (mode === "split") {
  // The value starts 1,010 characters before the end, so the last 1,000 hold only its end.
  process.stderr.write("site " + process.env.WP_TOKEN + "\\n" + "y".repeat(990));
  process.exit(1);
}
if (mode === "ansi") {
  process.stderr.write("\\u001b[31mError: colored failure\\u001b[0m\\n");
  process.exit(1);
}
if (mode === "long") {
  process.stderr.write("first line that is cut away\\n" + "x".repeat(5000) + "\\nlast line: missing WP_URL\\n");
  process.exit(1);
}
// "slow": fill far more than a pipe buffer, then answer late.
process.stderr.write("log line\\n".repeat(25000));
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) !== -1) {
    const message = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (message.id === undefined) continue;
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "publish", inputSchema: { type: "object" } }] }
          : {};
    setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n"), 1000);
  }
});
`;

function stdioConfig(path: string, mode: string): McpServerConfig {
  return {
    id: `exit-${mode}`,
    name: `exit_${mode}`,
    transport: "stdio",
    enabled: true,
    command: process.execPath,
    args: [path],
    env: [
      { key: "MODE", value: mode },
      { key: "WP_TOKEN", value: SECRET },
    ],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

const directory = await mkdtemp(join(tmpdir(), "openbot-mcp-exit-"));
try {
  const server = join(directory, "server.mjs");
  await writeFile(server, SERVER);
  const test = (mode: string) => runCauseEffect(testMcpServer(stdioConfig(server, mode), 30_000));

  const reason = await test("reason");
  assert.equal(reason.toolCount, 0);
  assert.ok(reason.error, "a stopped server fails");
  assert.deepEqual(matchingSourceKeys(reason.error), ["error.backend.mcpServerExitedWithOutput"]);
  assert.match(reason.error, /WP_URL is not set/u);
  assert.ok(!reason.error.includes(SECRET), "a configured value is masked");

  const silent = await test("silent");
  assert.equal(silent.error, sourceText("error.backend.mcpServerExited"));

  const long = await test("long");
  assert.ok(long.error);
  assert.match(long.error, /…/u);
  assert.match(long.error, /last line: missing WP_URL/u);
  assert.ok(!long.error.includes("first line that is cut away"));
  assert.ok(long.error.length <= INPUT_LIMITS.mcpErrorText);

  const split = await test("split");
  assert.ok(split.error);
  assert.deepEqual(matchingSourceKeys(split.error), ["error.backend.mcpServerExitedWithOutput"]);
  for (let start = 1; start < SECRET.length - 4; start++)
    assert.ok(!split.error.includes(SECRET.slice(start)), "no end of the secret value is shown");

  const color = await test("ansi");
  assert.ok(color.error);
  assert.match(color.error, /It wrote: Error: colored failure$/u);
  assert.ok(!color.error.includes("\u001b"));

  const startedAt = Date.now();
  const slow = await test("slow");
  const slowMs = Date.now() - startedAt;
  assert.deepEqual(slow, { toolCount: 1, error: null });

  const report = {
    reason: reason.error,
    silent: silent.error,
    long: long.error,
    split: split.error,
    color: color.error,
    slow: { ...slow, ms: slowMs },
  };
  const out = resolve(".openbot-build/mcp-stdio-exit-output-e2e.json");
  await mkdir(resolve(".openbot-build"), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nPASS - ${out}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
