// A provider record goes to the renderer and to history after this redaction. It must stay a valid
// record, and a value that the MCP configuration knows must not reach either place.
import { registerSecretValue } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { redactMcpRecord } from "./mcp-redaction";

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
