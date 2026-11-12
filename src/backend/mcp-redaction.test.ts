// A provider record goes to the renderer and to history after this redaction. It must stay a valid
// record, and a value that the MCP configuration knows must not reach either place.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
// in a Pi or Muse transcript (#4863). A credential beside them, or a value typed under a profile
// name, must stay masked.
describe("mcpSecretValues", () => {
  const home = "/Users/smoke-home";
  const originalHome = process.env.HOME;
  beforeEach(() => {
    process.env.HOME = home;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  const server: McpServerConfig = {
    id: "computer-use",
    name: "computer-use",
    transport: "stdio",
    enabled: true,
    command: "cua-driver",
    args: [],
    env: [
      { key: "API_TOKEN", value: "tok_9f8e7d6c5b4a" },
      { key: "USERNAME", value: "svc-login-7f3k" },
      { key: "home", value: home },
    ],
    envPassthrough: ["HOME"],
    workingDirectory: "",
    url: "",
    headers: [{ key: "X-Api-Key", value: "header-value" }],
  };

  it("leaves this computer's home folder unmasked", () => {
    const values = mcpSecretValues([server]);
    expect(values).toEqual([
      "tok_9f8e7d6c5b4a",
      "svc-login-7f3k",
      ...(process.platform === "win32" ? [] : [home]),
      "header-value",
    ]);
    const text = `Wrote ${home}/OpenBot/Shared/demo/report.md with tok_9f8e7d6c5b4a`;
    expect(redactMcpRecord({ text }, mcpSecretValues([{ ...server, env: server.env.slice(0, 1) }]))).toEqual({
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
              env: { HOME: home, USERNAME: "svc-login-7f3k" },
            },
          },
          local,
          directory,
        ),
      );
      expect(extension.secrets).toEqual(["svc-login-7f3k"]);
      expect(extension.environment).toMatchObject({
        OPENBOT_PI_MCP_VALUE_0: home,
        OPENBOT_PI_MCP_VALUE_1: "svc-login-7f3k",
      });
      await Effect.runPromise(extension.close());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
