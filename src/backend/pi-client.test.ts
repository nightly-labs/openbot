// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { PiAgentClient } from "./pi-client";
import { createPiMcpExtension } from "./pi-mcp";
import { type AppServerNotification, decodeThreadResponse, decodeTurnResponse, getRecord, getString } from "./protocol";
import type { ProviderHistoryFragment } from "./provider-history";

// Failure modes: agent_end can precede retries (settled test); cancellation can run queued work
// (interrupt test); a restarted process can use a different session (resume test); credentials
// can enter a generated file or become a shell command (MCP test).
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
let session = path.join(process.cwd(), "pi-session.jsonl");
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
let buffer = "";
process.stdin.on("data", chunk => {
  buffer += chunk;
  let line;
  while ((line = buffer.indexOf("\\n")) >= 0) {
    const command = JSON.parse(buffer.slice(0, line)); buffer = buffer.slice(line + 1);
    fs.appendFileSync(path.join(process.cwd(), "commands.jsonl"), JSON.stringify(command) + "\\n");
    let data = {};
    if (command.type === "get_state") { fs.writeFileSync(session, "{}"); data = { sessionFile: session }; }
    if (command.type === "switch_session") session = command.sessionPath;
    if (command.type === "get_messages") data = { messages: [{ role: "assistant", content: [{ type: "text", text: "Active branch" }], timestamp: 1000 }] };
    if (command.type === "get_available_models") data = { models: [{ id: "model", provider: "test", name: "Test", reasoning: false }] };
    if (command.type === "prompt") {
      data = { disposition: command.message === "/handled" ? "handled" : "started" };
      if (command.message !== "/handled") {
        send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Partial" } });
        send({ type: "agent_end" });
      }
    }
    send({ type: "response", id: command.id, command: command.type, success: true, data });
    if (command.type === "compact") {
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Final" }], stopReason: "stop" } });
      send({ type: "agent_settled" });
    }
    if (command.type === "abort") send({ type: "agent_settled" });
  }
});
`;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-pi-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, "pi.cjs");
  await writeFile(script, FAKE, { mode: 0o755 });
  const executable = process.platform === "win32" ? join(directory, "pi.cmd") : script;
  if (process.platform === "win32")
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  const persisted: ProviderHistoryFragment[] = [];
  const client = new PiAgentClient(
    { executable, version: "1.1.0", source: "system" },
    {
      providerStateDirectory: directory,
      history: {
        append: (_thread, fragment) =>
          Effect.sync(() => {
            persisted.push(fragment);
          }),
      },
    },
  );
  client.start();
  cleanup.push(() => Effect.runPromise(client.stop()));
  const events: AppServerNotification[] = [];
  client.on("notification", (event) => events.push(event));
  const started = await Effect.runPromise(client.request("thread/start", { cwd: directory }, decodeThreadResponse));
  return { client, directory, persisted, events, id: started.thread.id };
}

function completed(client: PiAgentClient) {
  return new Promise<AppServerNotification>((resolve) => {
    const listener = (event: AppServerNotification) => {
      if (event.method === "turn/completed") {
        client.off("notification", listener);
        resolve(event);
      }
    };
    client.on("notification", listener);
  });
}

describe("Pi native sessions", () => {
  it("keeps a turn open after agent_end and persists the authoritative reply before completion", async () => {
    const test = await fixture();
    await Effect.runPromise(
      test.client.request(
        "turn/start",
        { threadId: test.id, input: [{ type: "text", text: "Run" }] },
        decodeTurnResponse,
      ),
    );
    // A correlated read is a protocol barrier after the fixture's agent_end record.
    await Effect.runPromise(
      test.client.readHistory({ threadId: test.id, items: "none", providerOnly: true }, () => Effect.succeed(false)),
    );
    expect(test.events.filter((event) => event.method === "turn/completed")).toHaveLength(0);
    const finished = completed(test.client);
    await Effect.runPromise(test.client.request("thread/compact/start", { threadId: test.id }, () => ({})));
    await finished;
    expect(
      test.persisted
        .flatMap((turn) => turn.items)
        .filter((item) => item.type === "agentMessage")
        .map((item) => item.text),
    ).toEqual(["Final"]);
    expect(test.persisted[0]?.status).toBe("completed");
  });

  it("clears queued work before interruption and resumes the same native session", async () => {
    const test = await fixture();
    await Effect.runPromise(
      test.client.request(
        "turn/start",
        { threadId: test.id, input: [{ type: "text", text: "Run" }] },
        decodeTurnResponse,
      ),
    );
    const finished = completed(test.client);
    await Effect.runPromise(test.client.request("turn/interrupt", { threadId: test.id }, () => ({})));
    expect(getString(getRecord((await finished).params, "turn"), "status")).toBe("interrupted");
    await Effect.runPromise(test.client.releaseIdleThreads());
    const resumed = await Effect.runPromise(
      test.client.request("thread/resume", { threadId: test.id, cwd: test.directory }, decodeThreadResponse),
    );
    expect(resumed.thread.id).toBe(test.id);
    const commands = (await readFile(join(test.directory, "commands.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const types = commands.map((command) => command.type);
    expect(types.indexOf("clear_queue")).toBeLessThan(types.indexOf("abort"));
    expect(commands.find((command) => command.type === "switch_session")?.sessionPath).toBe(test.id);
    const fragments: ProviderHistoryFragment[] = [];
    await Effect.runPromise(
      test.client.readHistory({ threadId: test.id, items: "full", providerOnly: true }, (fragment) =>
        Effect.sync(() => {
          fragments.push(fragment);
          return true;
        }),
      ),
    );
    expect(fragments.flatMap((fragment) => fragment.items).map((item) => item.text)).toEqual(["Active branch"]);
    expect(fragments[0]?.recordsOnly).toBe(true);
  });

  it("does not write MCP credentials to the extension and passes literal values through environment references", async () => {
    const extension = await Effect.runPromise(
      createPiMcpExtension(
        {
          server: {
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: "!credential-command", Literal: "${DO_NOT_EXPAND}" },
          },
        },
        { servers: [], close() {}, setThreadId() {} },
      ),
    );
    cleanup.push(() => Effect.runPromise(extension.close()));
    const source = await readFile(extension.path, "utf8");
    expect(source).not.toContain("!credential-command");
    expect(source).not.toContain("${DO_NOT_EXPAND}");
    const entries = JSON.parse(extension.environment.OPENBOT_PI_MCP_SERVERS ?? "[]");
    expect(entries[0].config.headers.Authorization).toBe("${OPENBOT_PI_MCP_VALUE_0}");
    expect(extension.environment.OPENBOT_PI_MCP_VALUE_0).toBe("!credential-command");
  });
});
