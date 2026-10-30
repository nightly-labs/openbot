// Runs the real LocalMcpBridge with the MCP SDK client that OpenCode uses. OpenCode 2.1.4 keeps one
// `openbot` server for a directory, so a second chat of an agent replaced the first chat's token,
// and closing the second chat left every OpenBot tool call of the first refused with 401. Sessions in
// one directory must get one token that lasts until the last of them closes, and a call must reach
// the session in a turn. A session with no directory keeps a token of its own.
// `bun run test:acp-mcp-shared-token`. Writes .openbot-build/acp-mcp-shared-token-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "../src/backend/local-mcp-bridge";
import { isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-mcp-shared-token-e2e");

interface Report {
  passed: boolean;
  calls?: string[];
  refusals?: string[];
}

const namespace: DynamicToolNamespace = {
  type: "namespace",
  name: "openbot",
  tools: [{ type: "function", name: "whoami", inputSchema: { type: "object", properties: {} } }],
};

const report: Report = { passed: false, calls: [], refusals: [] };
const bridge = new LocalMcpBridge();
const turns = new Map<string, string | null>();

async function open(threadId: string, directory?: string): Promise<LocalMcpSession> {
  turns.set(threadId, null);
  return runCauseEffect(
    bridge.createSession(
      threadId,
      [namespace],
      () => turns.get(threadId) ?? null,
      (call) => Effect.succeed({ success: true, contentItems: [{ type: "inputText" as const, text: call.threadId }] }),
      directory,
    ),
  );
}

function authorization(session: LocalMcpSession): string {
  const header = session.servers[0]?.headers.find((candidate) => candidate.name === "Authorization");
  assert.ok(header, "The session's server carries a token.");
  return header.value;
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class.
 */
function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

/**
 * One tool call over a new connection, as OpenCode makes after it adds the server again. OpenCode
 * 2.1.4 names the calling session in `_meta`.
 */
async function whoami(session: LocalMcpSession, caller?: string): Promise<string> {
  const server = session.servers[0];
  assert.ok(server);
  const client = new Client({ name: "e2e-opencode", version: "1.0.0" });
  try {
    await client.connect(
      asTransport(
        new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: { Authorization: authorization(session) } },
        }),
      ),
    );
    const result = await client.callTool({
      name: "whoami",
      arguments: {},
      ...(caller === undefined ? {} : { _meta: { "ai.opencode/sessionID": caller } }),
    });
    const content = Array.isArray(result.content) ? result.content[0] : undefined;
    const text = isRecord(content) && typeof content.text === "string" ? content.text : "";
    report.calls?.push(text);
    return text;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function refused(session: LocalMcpSession): Promise<boolean> {
  try {
    await whoami(session);
    return false;
  } catch (error) {
    report.refusals?.push(String(error));
    return /unauthorized/.test(String(error));
  }
}

try {
  // OpenCode's directory: the agent's first chat, then a second chat in the same folder.
  const first = await open("thread-first", "/agents/borae");
  const second = await open("thread-second", "/agents/borae");
  assert.equal(authorization(second), authorization(first), "Sessions in one directory share the token.");

  turns.set("thread-first", "turn-1");
  assert.equal(await whoami(second), "thread-first", "A call reaches the session in a turn.");
  turns.set("thread-first", null);
  turns.set("thread-second", "turn-2");
  assert.equal(await whoami(first), "thread-second", "A call follows the turn, not the token's first session.");

  // Both chats in a turn at once: the session that OpenCode names gets the call.
  turns.set("thread-first", "turn-1b");
  assert.equal(await whoami(first, "thread-second"), "thread-second", "The named session gets the call.");
  assert.equal(await whoami(second, "thread-first"), "thread-first", "The named session gets the call.");
  turns.set("thread-first", null);
  turns.set("thread-second", null);

  // The second chat goes idle and OpenBot releases it. OpenCode still holds the shared token.
  second.close();
  turns.set("thread-first", "turn-3");
  assert.equal(await whoami(first), "thread-first", "The first chat's tools still work after the second closes.");

  // A thread id that changes after the session opens moves its calls with it.
  first.setThreadId("thread-first-renamed");
  turns.set("thread-first-renamed", "turn-4");
  assert.equal(await whoami(first), "thread-first-renamed", "A renamed thread gets its calls.");

  first.close();
  assert.ok(await refused(first), "The token ends with the last session in the directory.");

  // The next session in the directory gets a new token.
  const third = await open("thread-third", "/agents/borae");
  assert.notEqual(authorization(third), authorization(first), "A new session after the last close gets a new token.");
  third.close();

  // An agent without the per-directory rule keeps one token for each session.
  const own = await open("thread-own");
  const other = await open("thread-other");
  assert.notEqual(authorization(own), authorization(other), "Sessions without a directory get their own tokens.");
  other.close();
  assert.equal(await whoami(own), "thread-own", "Closing one session leaves the other's token.");
  own.close();

  // Other directories do not share.
  const left = await open("thread-left", "/agents/left");
  const right = await open("thread-right", "/agents/right");
  assert.notEqual(authorization(left), authorization(right), "Each directory has its own token.");
  left.close();
  right.close();

  report.passed = true;
} finally {
  await runCauseEffect(bridge.close());
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
