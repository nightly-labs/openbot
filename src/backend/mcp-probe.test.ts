import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMcpTestResult, type McpServerConfig } from "@openbot/contracts/ipc";
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

// The same wire, answering `tools/list` in two pages, which is what a server with many tools does.
const PAGED_SERVER = FAKE_SERVER.replace(
  ': { tools: [{ name: "one", inputSchema: { type: "object" } }, { name: "two", inputSchema: { type: "object" } }] };',
  `: message.params?.cursor === "page-2"
            ? { tools: [{ name: "three", inputSchema: { type: "object" } }] }
            : { tools: [{ name: "one", inputSchema: { type: "object" } }, { name: "two", inputSchema: { type: "object" } }], nextCursor: "page-2" };`,
);

// The same wire, behind the startup log a server writes before it answers. The write is synchronous,
// as a Rust or Python server's logging is, so an unread pipe stops the process at 64 KB.
const NOISY_SERVER = `import { writeSync } from "node:fs";
for (let block = 0; block < 16; block += 1) writeSync(2, "noise".repeat(13_107) + "\\n");
${FAKE_SERVER}`;

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

  // The count answers "what would an agent get", and an agent is given every tool, not a first page.
  it("counts the tools on every page a server answers with", async () => {
    expect(await testMcpServer(await scriptConfig(PAGED_SERVER))).toEqual({ toolCount: 3, error: null });
  });

  // Nothing reads the child's stderr, so a piped one fills and holds the server before it answers.
  it("answers for a server that writes a long startup log to stderr", async () => {
    expect(await testMcpServer(await scriptConfig(NOISY_SERVER), 2_000)).toEqual({ toolCount: 2, error: null });
  });

  // A `PATH` in the configuration is what the server runs with - a virtual environment, a version
  // manager's shim directory - so the command has to be looked up in that list and not in the login
  // shell's, which holds another build of the same name or none at all.
  it("finds a command on the PATH the configuration carries", async () => {
    const config = await scriptConfig(FAKE_SERVER);
    const [script] = config.args;
    const root = await mkdtemp(join(tmpdir(), "openbot-mcp-bin-"));
    roots.push(root);
    const launcher = join(root, "openbot-fake-mcp");
    await writeFile(
      launcher,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}\n`,
      "utf8",
    );
    await chmod(launcher, 0o755);

    expect(
      await testMcpServer({ ...config, command: "openbot-fake-mcp", args: [], env: [{ key: "PATH", value: root }] }),
    ).toEqual({ toolCount: 2, error: null });
  });

  // A test answers for the configuration in front of the user, which they may not have enabled yet.
  it("tests a server that is turned off", async () => {
    expect(await testMcpServer(await scriptConfig(FAKE_SERVER, { enabled: false }))).toEqual({
      toolCount: 2,
      error: null,
    });
  });

  // The form offers `~/code` as its example. Process creation takes the value as written, so a
  // literal `~` names a directory this machine does not have and the server never starts.
  it("starts a server in a home-relative working directory", async () => {
    expect(await testMcpServer(await scriptConfig(FAKE_SERVER, { workingDirectory: "~" }))).toEqual({
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

  // The IPC decoder and the remote codec both reject a longer text, so an unbounded failure would
  // reach the panel as "Invalid MCP server response." instead of the failure the user asked about.
  it("holds a long failure to the length the panel can be given", async () => {
    const result = await testMcpServer(config({ command: `openbot-${"long".repeat(1_000)}` }));
    expect(result.toolCount).toBe(0);
    expect(result.error).toMatch(/^Command not found: /u);
    expect(decodeMcpTestResult(result)).toBe(result);
  });

  // The lookup of a bare command name needs a login shell, and the name is written by the user -
  // and by a remote administrator of this machine's host.
  it("looks up a command name that holds a shell substitution as a name", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-mcp-"));
    roots.push(root);
    const mark = join(root, "ran");
    expect(await testMcpServer(config({ command: `node$(touch ${mark})` }))).toEqual({
      toolCount: 0,
      error: `Command not found: node$(touch ${mark})`,
    });
    await expect(stat(mark)).rejects.toThrow();
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

  // `envPassthrough` names a variable this machine already holds, so an inherited credential is
  // never in `config.env` and the stored pairs alone would let it out.
  it("removes an inherited credential the configuration never stored", () => {
    process.env.OPENBOT_TEST_MCP_TOKEN = "inherited-secret-value";
    try {
      const withPassthrough = config({ command: "node", envPassthrough: ["OPENBOT_TEST_MCP_TOKEN"] });
      const message = describeMcpError(new Error("Rejected inherited-secret-value"), withPassthrough, 10_000);
      expect(message).not.toContain("inherited-secret-value");
      expect(message).toContain("•••");
    } finally {
      delete process.env.OPENBOT_TEST_MCP_TOKEN;
    }
  });

  it("reports an http status rather than the transport's own words", () => {
    expect(describeMcpError(new Error("Error POSTing to endpoint (HTTP 401)"), config({}), 10_000)).toBe(
      "The server answered 401.",
    );
  });
});
