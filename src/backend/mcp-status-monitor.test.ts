import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig, McpServerStatus } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { describeMcpError, probeMcpServer } from "./mcp-probe";
import { usableMcpServers } from "./mcp-provider-shapes";
import { McpStatusMonitor } from "./mcp-status-monitor";

// A newline-delimited JSON-RPC server, written here rather than built on the SDK so the child is
// exactly what a real stdio server looks like on the wire and nothing else.
const FAKE_SERVER = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let line = buffer.indexOf("\\n"); line !== -1; line = buffer.indexOf("\\n")) {
    const text = buffer.slice(0, line).trim();
    buffer = buffer.slice(line + 1);
    if (!text) continue;
    const message = JSON.parse(text);
    if (message.id === undefined) continue;
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake", version: "1" },
          }
        : { tools: [{ name: "one", inputSchema: { type: "object" } }, { name: "two", inputSchema: { type: "object" } }] };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function config(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "mcp-1",
    name: "Fake",
    transport: "stdio",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

async function fakeServerConfig(overrides: Partial<McpServerConfig> = {}): Promise<McpServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "openbot-mcp-"));
  roots.push(root);
  const script = join(root, "server.mjs");
  await writeFile(script, FAKE_SERVER, "utf8");
  return config({ command: process.execPath, args: [script], ...overrides });
}

function monitorFor(configs: McpServerConfig[]): { monitor: McpStatusMonitor; latest: () => McpServerStatus[] } {
  let latest: McpServerStatus[] = [];
  const monitor = new McpStatusMonitor({ configs: () => configs, emit: (statuses) => (latest = statuses) });
  return { monitor, latest: () => latest };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!predicate()) throw new Error("The monitor did not reach the expected state.");
}

describe("McpStatusMonitor", () => {
  it("reports a real tool count for a server that answers", async () => {
    const { monitor, latest } = monitorFor([await fakeServerConfig()]);
    monitor.open();
    await waitFor(() => latest()[0]?.state === "connected");
    expect(latest()[0]).toEqual({ id: "mcp-1", state: "connected", toolCount: 2, error: null });
    await monitor.stop();
  });

  it("reports a disabled server without connecting to it", async () => {
    const { monitor, latest } = monitorFor([await fakeServerConfig({ enabled: false })]);
    monitor.open();
    await waitFor(() => latest().length > 0);
    expect(latest()[0]).toEqual({ id: "mcp-1", state: "disabled", toolCount: 0, error: null });
    await monitor.stop();
  });

  it("names the command that this machine does not have", async () => {
    const { monitor, latest } = monitorFor([config({ command: "openbot-no-such-command" })]);
    monitor.open();
    await waitFor(() => latest()[0]?.state === "failed");
    expect(latest()[0]?.error).toBe("Command not found: openbot-no-such-command");
    await monitor.stop();
  });

  // A closed panel holds no connection, so it reports no state either.
  it("drops every status when the last watcher closes", async () => {
    const { monitor, latest } = monitorFor([await fakeServerConfig()]);
    monitor.open();
    monitor.open();
    await waitFor(() => latest()[0]?.state === "connected");
    await monitor.close();
    expect(monitor.statuses().size).toBe(1);
    await monitor.close();
    expect(monitor.statuses().size).toBe(0);
  });
});

describe("probeMcpServer", () => {
  it("gives up on a server that never answers", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-mcp-"));
    roots.push(root);
    const script = join(root, "silent.mjs");
    await writeFile(script, "process.stdin.resume();\n", "utf8");
    const [server] = await usableMcpServers([config({ command: process.execPath, args: [script] })]);
    if (!server) throw new Error("The command did not resolve.");
    const result = await probeMcpServer(server, new AbortController().signal, 200);
    expect(result.toolCount).toBe(0);
    expect(result.error).toContain("The server did not answer in");
  });

  // Storing the values was a decision; quoting them back in an error message was not.
  it("removes a header value a transport quoted back", () => {
    const withHeader = config({
      transport: "http",
      url: "https://example.invalid/mcp",
      headers: [{ key: "Authorization", value: "Bearer super-secret-token" }],
    });
    const message = describeMcpError(new Error("Rejected: Bearer super-secret-token"), withHeader, 10_000);
    expect(message).not.toContain("super-secret-token");
    expect(message).toContain("•••");
  });

  it("reports an http status rather than the transport's own words", () => {
    expect(describeMcpError(new Error("Error POSTing to endpoint (HTTP 401)"), config({}), 10_000)).toBe(
      "The server answered 401.",
    );
  });
});
