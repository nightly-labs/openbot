import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { describeMcpError, testMcpServer } from "./mcp-probe";

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

async function scriptConfig(source: string, overrides: Partial<McpServerConfig> = {}): Promise<McpServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "openbot-mcp-"));
  roots.push(root);
  const script = join(root, "server.mjs");
  await writeFile(script, source, "utf8");
  return config({ command: process.execPath, args: [script], ...overrides });
}

describe("testMcpServer", () => {
  it("reports a real tool count for a server that answers", async () => {
    expect(await testMcpServer(await scriptConfig(FAKE_SERVER))).toEqual({ toolCount: 2, error: null });
  });

  // A test answers for the configuration in front of the user, which they may not have enabled yet.
  it("tests a server that is turned off", async () => {
    expect(await testMcpServer(await scriptConfig(FAKE_SERVER, { enabled: false }))).toEqual({
      toolCount: 2,
      error: null,
    });
  });

  it("names the command that this machine does not have", async () => {
    expect(await testMcpServer(config({ command: "openbot-no-such-command" }))).toEqual({
      toolCount: 0,
      error: "Command not found: openbot-no-such-command",
    });
  });

  it("gives up on a server that never answers", async () => {
    const result = await testMcpServer(await scriptConfig("process.stdin.resume();\n"), 200);
    expect(result.toolCount).toBe(0);
    expect(result.error).toContain("The server did not answer in");
  });
});

describe("describeMcpError", () => {
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
