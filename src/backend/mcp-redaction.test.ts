import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpSecretValues, redactMcpRecord } from "./mcp-redaction";
import { piCustomEndpointSecrets } from "./pi-custom-endpoints";
import { createPiMcpExtension } from "./pi-mcp";

describe("redactMcpRecord", () => {
  it("keeps JSON literals and setting words when a known value is `true` or `null`", () => {
    const record = { path: "README.md", enabled: true, note: null, label: "true story", flag: "QA_READY=TRUE" };
    expect(redactMcpRecord(record, ["true", "null", "TRUE", "false"])).toEqual({
      path: "README.md",
      enabled: true,
      note: null,
      label: "true story",
      flag: "QA_READY=TRUE",
    });
  });

  it("still masks a known value next to a setting word", () => {
    expect(redactMcpRecord({ line: "PIN=hunter22 DEBUG=true" }, ["true", "hunter22"])).toEqual({
      line: "PIN=••• DEBUG=true",
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

  it("keeps an email address and still redacts secrets", () => {
    const record = { item: { type: "agentMessage", text: "Sign in as admin@example.com. password=hunter2" } };
    expect(redactMcpRecord(record, [])).toEqual({
      item: { type: "agentMessage", text: "Sign in as admin@example.com. password=[redacted]" },
    });
  });

  it("keeps the custom provider's name and still masks its other values", () => {
    const values = piCustomEndpointSecrets([
      {
        id: "magpie",
        name: "Magpie",
        baseUrl: "http://127.0.0.1:8080/v1",
        apiKey: "magpie",
        headers: [
          { name: "X-Provider", value: "MAGPIE" },
          { name: "X-Gateway-Token", value: "mg-7Kq2x" },
        ],
        models: [{ id: "auto", name: "auto" }],
      },
    ]);
    const record = { item: { type: "agentMessage", text: "Provider `magpie` (Magpie), token mg-7Kq2x" } };
    expect(redactMcpRecord(record, values)).toEqual({
      item: { type: "agentMessage", text: "Provider `magpie` (Magpie), token •••" },
    });
  });
});

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
      const local = {
        servers: [],
        setThreadId: () => {},
        reached: () => false,
        dropped: () => false,
        listedWithin: () => false,
        renew: () => [],
        close: () => {},
      };
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
