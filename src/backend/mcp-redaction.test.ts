// A provider record goes to the renderer and to history after this redaction. It must stay a valid
// record, and a value that the MCP configuration knows must not reach either place.
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { mcpSecretValues, redactMcpRecord, redactMcpSecrets, redactMcpValues } from "./mcp-redaction";

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

function server(env: McpServerConfig["env"], extra: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "test",
    name: "test",
    transport: "stdio",
    enabled: true,
    command: "node",
    args: [],
    env,
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...extra,
  };
}

describe("mcpSecretValues", () => {
  // The computer-use driver's server is configured with `USER=openbot`, and every value used to be
  // masked, so that account name vanished from paths and prose in the transcript.
  it("leaves a standard process variable alone", () => {
    const config = server([
      { key: "USER", value: "openbot" },
      { key: "HOME", value: "/var/lib/openbot" },
      { key: "GITHUB_TOKEN", value: "ghp_abcdef123456" },
    ]);
    expect(mcpSecretValues([config])).toEqual(["ghp_abcdef123456"]);
    expect(redactMcpValues("the user openbot ran it", mcpSecretValues([config]))).toBe("the user openbot ran it");
  });

  it("matches a standard process variable whatever its case", () => {
    expect(mcpSecretValues([server([{ key: "Path", value: "/usr/local/bin:/usr/bin" }])])).toEqual([]);
  });

  it("keeps an unlabelled credential masked on the error path", () => {
    const config = server([{ key: "DATABASE_URL", value: "postgres://app:Zq7x9f2k@db/app" }]);
    expect(redactMcpSecrets("connect postgres://app:Zq7x9f2k@db/app failed", config)).toBe("connect ••• failed");
  });

  it("keeps a value inherited through envPassthrough masked", () => {
    process.env.MCP_TEST_PASSTHROUGH_TOKEN = "tok_9f8e7d6c5b4a";
    try {
      const config = server([], { envPassthrough: ["MCP_TEST_PASSTHROUGH_TOKEN"] });
      expect(mcpSecretValues([config])).toEqual(["tok_9f8e7d6c5b4a"]);
    } finally {
      delete process.env.MCP_TEST_PASSTHROUGH_TOKEN;
    }
  });
});
