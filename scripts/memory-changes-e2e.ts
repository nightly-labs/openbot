// Runs the `memory-changes-v1` wire on the real Team API codecs: a stored conversation with a
// `memory-changes` message goes out as a host sends it over HTTP and WebRTC, with and without the
// capability, and comes back as each client reads it. No provider, account or network is used.
// `bun scripts/memory-changes-e2e.ts`. Writes .openbot-build/memory-changes-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  type ConversationMemoryChange,
  type ConversationMessage,
  type ConversationPage,
  isConversationMessage,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  legacyTeamCapabilities,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_MEMORY_CHANGES_CAPABILITY,
  TEAM_PROTOCOL_V9_ONLY_CAPABILITIES,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { encodeTeamProtocolV8BaseCurrentEvent } from "@openbot/contracts/team-protocol/v8-base-adapter";
import {
  createTeamProtocolV8Event,
  decodeTeamProtocolV8CurrentEvent,
  encodeTeamProtocolV8WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v8-webrtc-adapter";
import { decodeTeamProtocolV9WebRtcHttpResponse } from "@openbot/contracts/team-protocol/v9-webrtc-adapter";

const OUT = resolve(import.meta.dirname, "../.openbot-build/memory-changes-e2e");
const PAGE_PATH = "/v1/agents/agent-1/conversation-page";

const steps: Array<{ step: string; result: unknown }> = [];
async function step(name: string, run: () => unknown): Promise<void> {
  try {
    steps.push({ step: name, result: (await run()) ?? "ok" });
  } catch (error) {
    steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const memoryChanges: ConversationMemoryChange[] = [
  { memoryId: "memory-1", action: "saved", text: "The user pulls Android crash reports from Play Vitals." },
  {
    memoryId: "memory-2",
    action: "updated",
    text: "App version 1.4.10 maps to version code 26.",
    previousText: "App version 1.4.10 maps to version code 25.",
  },
  { memoryId: "memory-3", action: "forgotten", text: "The user works from Lisbon." },
];

function memoryMessage(id: string, changes: unknown = memoryChanges): ConversationMessage {
  const message: ConversationMessage = {
    id,
    turnId: "turn-1",
    author: "system",
    source: "system",
    text: "Memory: 1 saved, 1 updated and 1 forgotten",
    createdAt: "2026-11-16T10:00:00.000Z",
    status: "completed",
    itemType: CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  };
  // A cast-free way to put a value that the type refuses on the message: the malformed case needs it.
  return Object.assign(message, { memoryChanges: changes });
}

const userMessage: ConversationMessage = {
  id: "user-1",
  turnId: "turn-1",
  author: "user",
  text: "Remember how I read Android crashes.",
  createdAt: "2026-11-16T09:59:00.000Z",
  status: "completed",
};

function page(messages: ConversationMessage[], references: Record<string, ConversationMessage> = {}): ConversationPage {
  return {
    agentId: "agent-1",
    threadId: "thread-1",
    activeTurnId: null,
    revision: 1,
    messages,
    references,
    pageInfo: { hasOlder: false, olderCursor: null },
  };
}

function withoutMemoryChanges(value: ConversationPage): ConversationPage {
  const strip = (message: ConversationMessage): ConversationMessage => {
    const { memoryChanges: _memoryChanges, ...rest } = message;
    return rest;
  };
  return {
    ...value,
    messages: value.messages.map(strip),
    references: Object.fromEntries(Object.entries(value.references).map(([id, message]) => [id, strip(message)])),
  };
}

const hasMemoryChanges = (json: string) => json.includes('"memoryChanges"');

/** The event as the host event stream sends it to the WebRTC host peer for a client with the capability. */
function hostWireEvent(event: Parameters<typeof encodeTeamProtocolV8BaseCurrentEvent>[0]): string {
  const encoded = encodeTeamProtocolV8BaseCurrentEvent(event, { memoryChanges: true });
  assert.ok(encoded);
  assert.ok(hasMemoryChanges(encoded));
  assert.ok(!hasMemoryChanges(encodeTeamProtocolV8BaseCurrentEvent(event) ?? ""));
  return encoded;
}

/** The messages of a decoded page, each checked against the IPC contract. */
function decodedMessages(value: unknown): ConversationMessage[] {
  assert.ok(isDynamicRecord(value));
  const { messages } = value;
  assert.ok(Array.isArray(messages));
  return messages.map((message, index) => {
    assert.ok(isConversationMessage(message), `message ${index} does not decode`);
    return message;
  });
}

const current = page([userMessage, memoryMessage("turn-1:memory-changes")], {
  "quoted-1": memoryMessage("quoted-1"),
});
const released = withoutMemoryChanges(current);
const httpV9 = teamHttpCodec(9);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  await step("capability: protocol 9 clients advertise it, protocols 7 and 8 and bootstrap do not", () => {
    assert.ok(TEAM_CURRENT_CAPABILITIES.includes(TEAM_MEMORY_CHANGES_CAPABILITY));
    assert.ok(TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(TEAM_MEMORY_CHANGES_CAPABILITY));
    assert.ok(teamCapabilitiesForProtocol(9).includes(TEAM_MEMORY_CHANGES_CAPABILITY));
    assert.ok(!teamCapabilitiesForProtocol(8).includes(TEAM_MEMORY_CHANGES_CAPABILITY));
    assert.ok(!teamCapabilitiesForProtocol(7).includes(TEAM_MEMORY_CHANGES_CAPABILITY));
    assert.ok(!new Set<string>(TEAM_BOOTSTRAP_CAPABILITIES).has(TEAM_MEMORY_CHANGES_CAPABILITY));
    assert.ok(!legacyTeamCapabilities([...TEAM_CURRENT_CAPABILITIES]).includes(TEAM_MEMORY_CHANGES_CAPABILITY));
    const sizes = {
      current: TEAM_CURRENT_CAPABILITIES.length,
      protocol9: teamCapabilitiesForProtocol(9).length,
      protocol8: teamCapabilitiesForProtocol(8).length,
      protocol7: teamCapabilitiesForProtocol(7).length,
      bootstrap: TEAM_BOOTSTRAP_CAPABILITIES.length,
    };
    assert.ok(sizes.protocol9 <= 256 && sizes.protocol8 <= 128 && sizes.protocol7 <= 128);
    return sizes;
  });

  await step("HTTP without the capability: the bytes of the released projection", () => {
    const encoded = httpV9.encodeResponse("GET", PAGE_PATH, 200, current, {});
    assert.equal(encoded, httpV9.encodeResponse("GET", PAGE_PATH, 200, released, {}));
    assert.ok(!hasMemoryChanges(encoded));
    // The released fallback: the system message keeps its item type and its count text.
    const [, memory] = decodedMessages(httpV9.decodeResponse("GET", PAGE_PATH, 200, JSON.parse(encoded)));
    assert.equal(memory?.itemType, CONVERSATION_MEMORY_CHANGES_ITEM_TYPE);
    assert.equal(memory?.text, current.messages[1]?.text);
    assert.equal(memory?.memoryChanges, undefined);
    return { bytes: encoded.length };
  });

  await step("HTTP with the capability: page messages and references carry the changes", () => {
    const encoded = httpV9.encodeResponse("GET", PAGE_PATH, 200, current, { memoryChanges: true });
    const decoded = httpV9.decodeResponse("GET", PAGE_PATH, 200, JSON.parse(encoded));
    assert.deepEqual(decodedMessages(decoded)[1]?.memoryChanges, memoryChanges);
    assert.ok(isDynamicRecord(decoded) && isDynamicRecord(decoded.references));
    const quoted = decoded.references["quoted-1"];
    assert.ok(isConversationMessage(quoted));
    assert.deepEqual(quoted.memoryChanges, memoryChanges);
    return { bytes: encoded.length };
  });

  await step("HTTP with the capability: only known keys go out", () => {
    const extra = page([memoryMessage("turn-2:memory-changes", [{ ...memoryChanges[0], hostPath: "/Users/host" }])]);
    const encoded = httpV9.encodeResponse("GET", PAGE_PATH, 200, extra, { memoryChanges: true });
    assert.ok(hasMemoryChanges(encoded) && !encoded.includes("hostPath"));
  });

  await step("WebRTC response: the host peer encodes it only under the capability", () => {
    const without = encodeTeamProtocolV8WebRtcHttpResponse("GET", PAGE_PATH, 200, current, {});
    assert.ok(!hasMemoryChanges(JSON.stringify(without)));
    const withValue = encodeTeamProtocolV8WebRtcHttpResponse("GET", PAGE_PATH, 200, current, { memoryChanges: true });
    const decoded = decodeTeamProtocolV9WebRtcHttpResponse("GET", PAGE_PATH, 200, withValue);
    assert.deepEqual(decodedMessages(decoded)[1]?.memoryChanges, memoryChanges);
  });

  await step("events: the conversation-page event carries it only under the capability", () => {
    const event = JSON.parse(hostWireEvent({ type: "conversation-page", page: current }));
    assert.ok(!hasMemoryChanges(JSON.stringify(createTeamProtocolV8Event(1, event))));
    const read = decodeTeamProtocolV8CurrentEvent(createTeamProtocolV8Event(2, event, { memoryChanges: true }));
    assert(read.status === "known" && read.event.type === "conversation-page");
    assert.deepEqual(read.event.page.messages[1]?.memoryChanges, memoryChanges);
    assert.deepEqual(read.event.page.references["quoted-1"]?.memoryChanges, memoryChanges);
  });

  await step("events: the conversation snapshot event carries it only under the capability", () => {
    const snapshot = {
      agentId: "agent-1",
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages: current.messages,
    };
    const event = JSON.parse(hostWireEvent({ type: "conversation", snapshot }));
    assert.ok(!hasMemoryChanges(JSON.stringify(createTeamProtocolV8Event(1, event))));
    const read = decodeTeamProtocolV8CurrentEvent(createTeamProtocolV8Event(2, event, { memoryChanges: true }));
    assert(read.status === "known" && read.event.type === "conversation");
    assert.deepEqual(read.event.snapshot.messages[1]?.memoryChanges, memoryChanges);
  });

  await step("a malformed value fails closed in both directions", () => {
    const broken = page([
      memoryMessage("turn-3:memory-changes", [{ memoryId: "memory-4", action: "kept", text: "x" }]),
    ]);
    assert.throws(() => httpV9.encodeResponse("GET", PAGE_PATH, 200, broken, { memoryChanges: true }));
    const wire = JSON.parse(httpV9.encodeResponse("GET", PAGE_PATH, 200, current, { memoryChanges: true }));
    wire.messages[1].memoryChanges = [{ memoryId: "memory-1", action: "saved", text: 7 }];
    assert.throws(() => httpV9.decodeResponse("GET", PAGE_PATH, 200, wire));
    const wireEvent = JSON.parse(hostWireEvent({ type: "conversation-page", page: current }));
    wireEvent.page.messages[1].memoryChanges = [{ memoryId: "memory-1", action: "saved" }];
    assert.throws(() => createTeamProtocolV8Event(1, wireEvent, { memoryChanges: true }));
    const read = decodeTeamProtocolV8CurrentEvent({ version: 2, type: "event", sequence: 1, payload: wireEvent });
    assert.notEqual(read.status, "known");
  });

  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify({ ok: true, steps }, null, 2)}\n`);
  process.stdout.write(`memory-changes-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}\n`,
  );
  process.stderr.write(`memory-changes-e2e failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
