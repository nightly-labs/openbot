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

function withToken(session: LocalMcpSession, token: string): LocalMcpSession {
  const server = session.servers[0];
  assert.ok(server);
  return { ...session, servers: [{ ...server, headers: [{ name: "Authorization", value: token }] }] };
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
  const first = await open("thread-first", "/agents/borae");
  const second = await open("thread-second", "/agents/borae");
  assert.equal(authorization(second), authorization(first), "Sessions in one directory share the token.");

  turns.set("thread-first", "turn-1");
  assert.equal(await whoami(second), "thread-first", "A call reaches the session in a turn.");
  turns.set("thread-first", null);
  turns.set("thread-second", "turn-2");
  assert.equal(await whoami(first), "thread-second", "A call follows the turn, not the token's first session.");

  turns.set("thread-first", "turn-1b");
  assert.equal(await whoami(first, "thread-second"), "thread-second", "The named session gets the call.");
  assert.equal(await whoami(second, "thread-first"), "thread-first", "The named session gets the call.");
  turns.set("thread-first", null);
  turns.set("thread-second", null);

  second.close();
  turns.set("thread-first", "turn-3");
  assert.equal(await whoami(first), "thread-first", "The first chat's tools still work after the second closes.");

  first.setThreadId("thread-first-renamed");
  turns.set("thread-first-renamed", "turn-4");
  assert.equal(await whoami(first), "thread-first-renamed", "A renamed thread gets its calls.");

  first.close();
  assert.ok(await refused(first), "The token ends with the last session in the directory.");

  const third = await open("thread-third", "/agents/borae");
  assert.notEqual(authorization(third), authorization(first), "A new session after the last close gets a new token.");
  third.close();

  const own = await open("thread-own");
  const other = await open("thread-other");
  assert.notEqual(authorization(own), authorization(other), "Sessions without a directory get their own tokens.");
  other.close();
  assert.equal(await whoami(own), "thread-own", "Closing one session leaves the other's token.");
  own.close();

  const left = await open("thread-left", "/agents/left");
  const right = await open("thread-right", "/agents/right");
  assert.notEqual(authorization(left), authorization(right), "Each directory has its own token.");
  left.close();
  right.close();

  const slow = await open("thread-slow", "/agents/slow");
  const firstToken = authorization(slow);
  assert.equal(slow.dropped(Date.now(), 30_000), false, "A session request that just left has not given up.");
  assert.equal(slow.dropped(Date.now() - 31_000, 30_000), true, "A server not listed by the limit is given up.");
  const joiner = await open("thread-joiner", "/agents/slow");
  const secondToken = authorization(joiner);
  assert.notEqual(secondToken, firstToken, "A chat that joins a given-up server gets a new token.");
  assert.equal(slow.dropped(Date.now() - 31_000, 30_000), false, "Only the session that sent a token judges it.");
  assert.equal(joiner.dropped(Date.now() - 31_000, 30_000), true, "The joiner judges its own token.");
  const renewed = joiner.renew();
  const thirdToken = authorization(joiner);
  assert.equal(renewed, joiner.servers, "A renew changes the session's servers in place.");
  assert.notEqual(thirdToken, secondToken, "A renew of a given-up server makes a new token.");
  slow.renew();
  assert.equal(authorization(slow), thirdToken, "A renew gives each session of the folder the newest token.");
  turns.set("thread-slow", "turn-slow");
  for (const token of [firstToken, secondToken, thirdToken])
    assert.equal(await whoami(withToken(slow, token)), "thread-slow", "Each token of the folder reaches its sessions.");
  turns.set("thread-slow", null);
  slow.close();
  joiner.close();
  for (const token of [firstToken, secondToken, thirdToken])
    assert.ok(await refused(withToken(slow, token)), "All tokens end with the last session in the directory.");

  report.passed = true;
} finally {
  await runCauseEffect(bridge.close());
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
