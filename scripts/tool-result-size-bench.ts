// `bun run bench:tool-result-size`: measures what OpenBot's tools give the model, without a provider,
// and writes `.openbot-build/tool-result-size/report.json`.
//
// - Browser: drives `BrowserHost.handleDynamicTool` in an owned hidden Electron process on loopback
//   pages. It measures the screenshot pixel size against the CSS viewport, the image bytes and the
//   estimated image tokens, the text size of large evaluate, run_script and snapshot results, and a
//   click at a point read from the screenshot.
// - GitHub MCP proxy: puts `GitHubMcpProxy` in front of a loopback MCP server whose tool returns a
//   large text, and measures the text that an MCP client gets through the proxy.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";
import { GitHubMcpProxy } from "../src/main/github-mcp-proxy";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = await mkdtemp(join(tmpdir(), "openbot-tool-result-size-"));
const reportPath = join(projectRoot, ".openbot-build/tool-result-size/report.json");
const runId = randomUUID();
const measurementSchema = z.union([z.number(), z.boolean(), z.string()]);
type Measurement = z.infer<typeof measurementSchema>;
/** About 25k tokens of issue-list text: the size of a long GitHub list. */
const UPSTREAM_TEXT = Array.from(
  { length: 1_000 },
  (_, index) => `#${index} Issue title number ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
).join("\n");

try {
  await mkdir(dirname(reportPath), { recursive: true });
  // The QuickJS sandbox loads its WebAssembly file next to its own module, so the entry sits in the project.
  const entry = join(dirname(reportPath), "tool-result-size.mjs");
  await run(process.execPath, [
    "build",
    join(projectRoot, "scripts/tool-result-size-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    "--external=quickjs-emscripten-core",
    "--external=@jitl/quickjs-wasmfile-release-sync",
    `--outfile=${entry}`,
  ]);
  const sourceSha = (await output("git", ["rev-parse", "HEAD"])).trim();
  await run(
    join(projectRoot, "node_modules/.bin/electron"),
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      entry,
      `--fixture-root=${buildRoot}`,
      `--report-path=${reportPath}`,
      `--source-sha=${sourceSha}`,
      `--run-id=${runId}`,
    ],
    true,
  );
  const report = z
    .object({
      status: z.literal("passed"),
      runId: z.literal(runId),
      measurements: z.record(z.string(), measurementSchema),
    })
    .loose()
    .parse(JSON.parse(await readFile(reportPath, "utf8")));
  const mcp = await measureGitHubProxy();
  const measurements = { ...report.measurements, ...mcp };
  const failed = expectations(measurements);
  const full = { ...report, status: failed.length ? "failed" : "passed", failed, measurements };
  await writeFile(reportPath, `${JSON.stringify(full, null, 2)}\n`);
  // Machine-readable summary.
  process.stdout.write(`${JSON.stringify({ status: full.status, report: reportPath, failed, ...measurements })}\n`);
  if (failed.length) process.exitCode = 1;
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

/** The names of the measurements that do not meet the change's promise. */
function expectations(measurements: Record<string, Measurement>): string[] {
  const under = (name: string, limit: number) => typeof measurements[name] === "number" && measurements[name] <= limit;
  const hits = (name: string) => typeof measurements[name] === "string" && measurements[name].endsWith(", hit");
  const checks: Record<string, boolean> = {
    screenshotMatchesCssViewport: measurements.screenshotMatchesCssViewport === true,
    pointFromImageHitsBox: measurements.pointFromImageHitsBox === true,
    emulatedLargerThanView: hits("emulatedLargerThanView"),
    emulatedScale3: hits("emulatedScale3"),
    emulatedMobilePreset: hits("emulatedMobilePreset"),
    // The cap, plus the note.
    evaluateResultChars: under("evaluateResultChars", 16_500),
    evaluateOver64KbSaysHow: measurements.evaluateOver64KbSaysHow === true,
    runScriptResultChars: under("runScriptResultChars", 16_500),
    runScriptQuotedResultChars: under("runScriptQuotedResultChars", 16_500),
    runScriptStringNoteCountsString: measurements.runScriptStringNoteCountsString === true,
    // The notes lead the agent through the whole value, with no part read twice or skipped.
    partCuts: typeof measurements.partCuts === "number" && measurements.partCuts > 0,
    partNotesCountTheSlice: measurements.partNotesCountTheSlice === true,
    partsJoinToValue: measurements.partsJoinToValue === true,
    githubMcpProxiedTextChars: under("githubMcpProxiedTextChars", 40_500),
  };
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
}

async function measureGitHubProxy(): Promise<Record<string, number>> {
  const upstream = createServer((request, response) => {
    const mcp = new Server({ name: "fake-github", version: "1.0.0" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [{ name: "list_issues", description: "Lists issues.", inputSchema: { type: "object" } }],
    }));
    mcp.setRequestHandler(CallToolRequestSchema, () => ({ content: [{ type: "text", text: UPSTREAM_TEXT }] }));
    // No `sessionIdGenerator`: each POST is one stateless request, as in the proxy.
    const transport = new StreamableHTTPServerTransport({});
    response.once("close", () => {
      void transport.close();
      void mcp.close();
    });
    void mcp.connect(asTransport(transport)).then(() => transport.handleRequest(request, response));
  });
  const proxy = new GitHubMcpProxy({
    upstreamUrl: `http://127.0.0.1:${await listen(upstream)}/mcp`,
    secret: () => "bench-secret",
    userToken: () => Effect.succeed("bench-user-token"),
    botToken: () => null,
    canRead: () => Effect.succeed(null),
    refused: () => Effect.void,
  });
  const client = new Client({ name: "tool-result-size-bench", version: "1.0.0" });
  try {
    await Effect.runPromise(proxy.start(null));
    const url = proxy.url();
    if (!url) throw new Error("The GitHub MCP proxy has no URL.");
    await client.connect(
      asTransport(
        new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: "Bearer bench-secret" } },
        }),
      ),
    );
    const result = await client.callTool({ name: "list_issues", arguments: {} });
    const items = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(result.content);
    return {
      githubMcpUpstreamTextChars: UPSTREAM_TEXT.length,
      githubMcpProxiedTextChars: items.reduce((sum, item) => sum + (item.text?.length ?? 0), 0),
    };
  } finally {
    await client.close();
    await Effect.runPromise(proxy.stop());
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}

async function listen(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Loopback server address missing.");
  return address.port;
}

async function run(command: string, args: string[], electron = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: electron ? withoutElectronRuntimeFlags(process.env) : process.env,
    });
    let force: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      force = setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(force);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(force);
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`Tool result size process failed (${code ?? signal}).`));
    });
  });
}

async function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve(text) : reject(new Error("Unable to read the source SHA."))));
  });
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class.
 */
function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}
