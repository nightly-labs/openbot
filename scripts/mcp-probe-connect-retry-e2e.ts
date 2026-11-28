import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { inspectMcpServer } from "../src/backend/mcp-probe";

const REPORT_DIR = resolve(import.meta.dirname, "..", ".openbot-build", "mcp-probe-connect-retry");

type Injected = "connect" | "reset";

function undiciFailure(kind: Injected): TypeError {
  const cause =
    kind === "connect"
      ? Object.assign(new Error("connect ETIMEDOUT 203.0.113.9:443"), { code: "ETIMEDOUT", syscall: "connect" })
      : Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" });
  return new TypeError("fetch failed", { cause });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function answer(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

const received: string[] = [];
const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== "POST") return answer(response, 405);
    const message = JSON.parse(await readBody(request));
    received.push(message.method);
    if (!("id" in message)) return answer(response, 202);
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake-mcp", version: "1" },
          }
        : { tools: [{ name: "fetch", inputSchema: { type: "object" } }] };
    answer(response, 200, { jsonrpc: "2.0", id: message.id, result });
  })();
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("The fake MCP server has no port.");
const { port } = address;

const realFetch = globalThis.fetch;
const planned: Injected[] = [];
let fetchCalls = 0;
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls += 1;
    const failure = planned.shift();
    if (failure) throw undiciFailure(failure);
    return realFetch(input, init);
  },
  { preconnect: realFetch.preconnect },
);

const config: McpServerConfig = {
  id: "probe-connect-retry",
  name: "probe-connect-retry",
  enabled: true,
  transport: "http",
  url: `http://127.0.0.1:${port}/mcp`,
  headers: [],
  command: "",
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
};

const unreachable = sourceText("error.backend.mcpServerUnreachable");
const cases: Array<{ name: string; inject: Injected[]; error: string | null; toolCount: number }> = [
  { name: "no failure", inject: [], error: null, toolCount: 1 },
  { name: "one connection that did not open", inject: ["connect"], error: null, toolCount: 1 },
  {
    name: "two connections in a row that did not open",
    inject: ["connect", "connect"],
    error: unreachable,
    toolCount: 0,
  },
  { name: "reset after the request was sent", inject: ["reset"], error: unreachable, toolCount: 0 },
];

const results = [];
try {
  for (const testCase of cases) {
    planned.splice(0, planned.length, ...testCase.inject);
    fetchCalls = 0;
    received.length = 0;
    const outcome = await Effect.runPromise(inspectMcpServer(config, 10_000));
    results.push({
      name: testCase.name,
      error: outcome.error,
      toolCount: outcome.toolCount,
      fetchCalls,
      serverReceived: [...received],
    });
    assert.equal(outcome.error, testCase.error, testCase.name);
    assert.equal(outcome.toolCount, testCase.toolCount, testCase.name);
  }
  const reset = results.find((result) => result.name === "reset after the request was sent");
  assert.equal(reset?.fetchCalls, 1, "a reset is not sent again");
} finally {
  globalThis.fetch = realFetch;
  server.close();
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(join(REPORT_DIR, "report.json"), `${JSON.stringify({ results }, null, 2)}\n`);
}
process.stdout.write(
  `mcp-probe-connect-retry-e2e: ${results.length} cases passed. Report: ${join(REPORT_DIR, "report.json")}\n`,
);
