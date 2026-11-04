// A provider record goes to the renderer and to history after this redaction. It must stay a valid
// record, and a value that the MCP configuration knows must not reach either place.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { mcpSecretValues, redactMcpRecord } from "./mcp-redaction";
import { createPiMcpExtension } from "./pi-mcp";

describe("redactMcpRecord", () => {
  it("keeps JSON literals when a known value is `true` or `null`", () => {
    const record = { path: "README.md", enabled: true, note: null, label: "true story" };
    expect(redactMcpRecord(record, ["true", "null"])).toEqual({
      path: "README.md",
      enabled: true,
      note: null,
      label: "••• story",
    });
  });

  it("masks a number that holds a known value", () => {
    expect(redactMcpRecord({ pin: 48291375, count: 3 }, ["48291375"])).toEqual({ pin: "•••", count: 3 });
  });

  it("redacts a secret key before a known value changes its name", () => {
    const record = { refresh_token: "abc123def456", mode: "token auth" };
    expect(redactMcpRecord(record, ["token"])).toEqual({ "refresh_•••": "[redacted]", mode: "••• auth" });
  });

  it("redacts the whole token around a registered secret", () => {
    registerSecretValue("abcd1234efgh");
    const redacted = JSON.stringify(redactMcpRecord({ output: "abcd1234efgh.sig_part-xyz" }, ["abcd1234efgh"]));
    expect(redacted).not.toContain("abcd1234efgh");
    expect(redacted).not.toContain("sig_part");
  });
});

// The Computer Use server inherits HOME, USER and TMPDIR. Masking HOME broke each Shared file link
// in a Pi or Muse transcript (#4863). A credential beside them must stay masked.
describe("mcpSecretValues", () => {
  const home = process.env.HOME ?? "/Users/someone";
  const server: McpServerConfig = {
    id: "computer-use",
    name: "computer-use",
    transport: "stdio",
    enabled: true,
    command: "cua-driver",
    args: [],
    env: [
      { key: "API_TOKEN", value: "tok_9f8e7d6c5b4a" },
      { key: "Path", value: "/opt/tools/bin" },
    ],
    envPassthrough: ["HOME"],
    workingDirectory: "",
    url: "",
    headers: [{ key: "User", value: "header-value" }],
  };

  it("leaves the user's folders and search path unmasked", () => {
    const values = mcpSecretValues([server]);
    expect(values).toEqual(["tok_9f8e7d6c5b4a", "header-value"]);
    const text = `Wrote ${home}/OpenBot/Shared/demo/report.md with tok_9f8e7d6c5b4a`;
    expect(redactMcpRecord({ text }, values)).toEqual({
      text: `Wrote ${home}/OpenBot/Shared/demo/report.md with •••`,
    });
  });

  it("gives Pi each value but only the credentials as secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-pi-mcp-test-"));
    try {
      const local = { servers: [], setThreadId: () => {}, reached: () => false, close: () => {} };
      const extension = await Effect.runPromise(
        createPiMcpExtension(
          {
            computer: {
              type: "stdio",
              command: "cua-driver",
              args: [],
              env: { HOME: home, API_TOKEN: "tok_9f8e7d6c5b4a" },
            },
            remote: { type: "http", url: "https://mcp.example.test", headers: { User: "header-value" } },
          },
          local,
          directory,
        ),
      );
      expect(extension.secrets).toEqual(["tok_9f8e7d6c5b4a", "header-value"]);
      expect(extension.environment).toMatchObject({
        OPENBOT_PI_MCP_VALUE_0: home,
        OPENBOT_PI_MCP_VALUE_1: "tok_9f8e7d6c5b4a",
        OPENBOT_PI_MCP_VALUE_2: "header-value",
      });
      await Effect.runPromise(extension.close());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
