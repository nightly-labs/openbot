import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendRemoteDiagnosticLog, createRemoteDiagnosticStream } from "./remote-diagnostics";

describe("remote diagnostics", () => {
  it("removes passwords and custom header credentials before writing a log", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-remote-diagnostics-"));
    try {
      await appendRemoteDiagnosticLog(
        directory,
        "moonlight",
        JSON.stringify({ password: "private-password", headers: { "X-Tenant": "private-header" }, state: "ready" }),
      );
      const log = await readFile(join(directory, "moonlight.log"), "utf8");
      expect(log).not.toContain("private-password");
      expect(log).not.toContain("private-header");
      expect(log).toContain("ready");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("redacts complete records before sending split process output to a diagnostic consumer", () => {
    const messages: string[] = [];
    const stream = createRemoteDiagnosticStream((message) => messages.push(message));
    stream.push("Authorization: Bearer ");
    stream.push("private-token-123\n");
    stream.push('{"headers":{\n"X-Tenant":"private-');
    stream.push('header"}}\nRuntime ready');
    stream.flush();
    const output = messages.join("");
    expect(output).not.toContain("private-token-123");
    expect(output).not.toContain("private-header");
    expect(output).toContain("[redacted]");
    expect(output).toContain("Runtime ready");
  });
});
