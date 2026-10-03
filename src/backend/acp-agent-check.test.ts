import { runTestEffect } from "./effect-test-runtime";
// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAcpAgent } from "./acp-agent-check";

// A fake ACP agent. `MODE` picks what it does with `initialize`; it writes its pid so the test can
// prove that the check stopped it.
const FAKE_AGENT = `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.PID_FILE, String(process.pid));
const mode = process.env.MODE;
if (mode === "crash") {
  process.stderr.write("boom " + process.env.SECRET_VALUE + "\\n");
  process.exit(3);
}
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (message.method !== "initialize" || mode === "hang") continue;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: mode === "protocol2" ? 2 : 1,
        agentInfo: { name: "fake", title: "Fake Agent", version: "0.1.0" },
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: false } },
      },
    }) + "\\n");
  }
});
setInterval(() => {}, 1000);
`;

let root = "";
let executable = "";
let pidFile = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-acp-check-"));
  executable = join(root, "fake-agent");
  pidFile = join(root, "pid");
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function check(mode: string, timeoutMs = 5_000) {
  return runTestEffect(
    checkAcpAgent({
      executable,
      args: [],
      env: { MODE: mode, PID_FILE: pidFile, SECRET_VALUE: "sk-check-secret-value" },
      timeoutMs,
    }),
  );
}

/** The agent process is gone: a signal 0 to its pid fails. */
async function expectStopped(): Promise<void> {
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}

describe.sequential("checkAcpAgent", () => {
  it("reports what the agent says about itself, and stops it", async () => {
    await expect(check("ok")).resolves.toEqual({
      agentName: "Fake Agent",
      version: "0.1.0",
      protocolVersion: 1,
      capabilities: ["loadSession", "image"],
    });
    await expectStopped();
  });

  it("stops an agent that does not answer in time", async () => {
    await expect(check("hang", 500)).rejects.toThrow("20 seconds");
    await expectStopped();
  });

  it("refuses another protocol version", async () => {
    await expect(check("protocol2")).rejects.toThrow("ACP version 2");
    await expectStopped();
  });

  it("masks the agent's own environment value in the stderr line it adds", async () => {
    const error = await check("crash").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("boom");
    expect(String(error)).not.toContain("sk-check-secret-value");
  });
});
