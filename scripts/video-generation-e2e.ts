// Runs the `video-generation-v1` wire on the real Team API codecs: a stored conversation with a
// `video_generation` message goes out as a host sends it over HTTP and WebRTC, with and without the
// capability, and comes back as each client reads it. No provider, account or network is used.
// `bun scripts/video-generation-e2e.ts`. Writes .openbot-build/video-generation-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ConversationMessage,
  type ConversationPage,
  isConversationMessage,
  type VideoGenerationInfo,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  legacyTeamCapabilities,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V9_ONLY_CAPABILITIES,
  TEAM_VIDEO_GENERATION_CAPABILITY,
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/video-generation-e2e");
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

const videoGeneration: VideoGenerationInfo = {
  prompt: "A paper boat on a rainy street",
  aspectRatio: "landscape",
  durationSeconds: 6,
  resolution: "720p",
};

function videoMessage(id: string, info: unknown = videoGeneration): ConversationMessage {
  const message: ConversationMessage = {
    id,
    turnId: "turn-1",
    author: "agent",
    text: "",
    createdAt: "2026-11-12T10:00:00.000Z",
    status: "completed",
    itemType: "video_generation",
    attachments: [
      {
        id: `${id}-video`,
        name: "boat.mp4",
        size: 1024,
        kind: "file",
        mimeType: "video/mp4",
        previewKind: "none",
        previewUrl: null,
      },
    ],
  };
  // A cast-free way to put a value that the type refuses on the message: the malformed case needs it.
  return Object.assign(message, { videoGeneration: info });
}

const userMessage: ConversationMessage = {
  id: "user-1",
  turnId: "turn-1",
  author: "user",
  text: "Make a short video of a paper boat.",
  createdAt: "2026-11-12T09:59:00.000Z",
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

function withoutVideoGeneration(value: ConversationPage): ConversationPage {
  const strip = (message: ConversationMessage): ConversationMessage => {
    const { videoGeneration: _videoGeneration, ...rest } = message;
    return rest;
  };
  return {
    ...value,
    messages: value.messages.map(strip),
    references: Object.fromEntries(Object.entries(value.references).map(([id, message]) => [id, strip(message)])),
  };
}

const hasVideoGeneration = (json: string) => json.includes('"videoGeneration"');

/**
 * The event as the host event stream sends it to the WebRTC host peer for a client with the
 * capability (`#encodeProviderEvent`): the wire shape, with `botId` keys.
 */
function hostWireEvent(event: Parameters<typeof encodeTeamProtocolV8BaseCurrentEvent>[0]): string {
  const encoded = encodeTeamProtocolV8BaseCurrentEvent(event, { videoGeneration: true });
  assert.ok(encoded);
  assert.ok(hasVideoGeneration(encoded));
  assert.ok(!hasVideoGeneration(encodeTeamProtocolV8BaseCurrentEvent(event) ?? ""));
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

const current = page([userMessage, videoMessage("video-1")], { "quoted-1": videoMessage("quoted-1") });
const released = withoutVideoGeneration(current);
const httpV9 = teamHttpCodec(9);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  await step("capability: protocol 9 clients advertise it, protocols 7 and 8 and bootstrap do not", () => {
    assert.ok(TEAM_CURRENT_CAPABILITIES.includes(TEAM_VIDEO_GENERATION_CAPABILITY));
    assert.ok(TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(TEAM_VIDEO_GENERATION_CAPABILITY));
    assert.ok(teamCapabilitiesForProtocol(9).includes(TEAM_VIDEO_GENERATION_CAPABILITY));
    assert.ok(!teamCapabilitiesForProtocol(8).includes(TEAM_VIDEO_GENERATION_CAPABILITY));
    assert.ok(!teamCapabilitiesForProtocol(7).includes(TEAM_VIDEO_GENERATION_CAPABILITY));
    assert.ok(!new Set<string>(TEAM_BOOTSTRAP_CAPABILITIES).has(TEAM_VIDEO_GENERATION_CAPABILITY));
    assert.ok(!legacyTeamCapabilities([...TEAM_CURRENT_CAPABILITIES]).includes(TEAM_VIDEO_GENERATION_CAPABILITY));
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
    assert.ok(!hasVideoGeneration(encoded));
    // The released fallback: the message keeps its item type and its mp4.
    const [, video] = decodedMessages(httpV9.decodeResponse("GET", PAGE_PATH, 200, JSON.parse(encoded)));
    assert.equal(video?.itemType, "video_generation");
    assert.equal(video?.attachments?.[0]?.mimeType, "video/mp4");
    assert.equal(video?.videoGeneration, undefined);
    return { bytes: encoded.length };
  });

  await step("HTTP with the capability: page messages and references carry the value", () => {
    const encoded = httpV9.encodeResponse("GET", PAGE_PATH, 200, current, { videoGeneration: true });
    const decoded = httpV9.decodeResponse("GET", PAGE_PATH, 200, JSON.parse(encoded));
    const messages = decodedMessages(decoded);
    assert.deepEqual(
      messages.map((message) => message.videoGeneration),
      current.messages.map((message) => message.videoGeneration),
    );
    assert.ok(isDynamicRecord(decoded) && isDynamicRecord(decoded.references));
    const quoted = decoded.references["quoted-1"];
    assert.ok(isConversationMessage(quoted));
    assert.deepEqual(quoted.videoGeneration, videoGeneration);
    return { bytes: encoded.length };
  });

  await step("HTTP with the capability: only known keys go out", () => {
    const extra = page([videoMessage("video-2", { ...videoGeneration, hostPath: "/Users/host/boat.mp4" })]);
    const encoded = httpV9.encodeResponse("GET", PAGE_PATH, 200, extra, { videoGeneration: true });
    assert.ok(hasVideoGeneration(encoded) && !encoded.includes("hostPath"));
  });

  await step("WebRTC response: the host peer encodes it only under the capability", () => {
    const without = encodeTeamProtocolV8WebRtcHttpResponse("GET", PAGE_PATH, 200, current, {});
    assert.ok(!hasVideoGeneration(JSON.stringify(without)));
    const withValue = encodeTeamProtocolV8WebRtcHttpResponse("GET", PAGE_PATH, 200, current, {
      videoGeneration: true,
    });
    const decoded = decodeTeamProtocolV9WebRtcHttpResponse("GET", PAGE_PATH, 200, withValue);
    assert.deepEqual(decodedMessages(decoded)[1]?.videoGeneration, videoGeneration);
  });

  await step("events: the conversation-page event carries it only under the capability", () => {
    const event = JSON.parse(hostWireEvent({ type: "conversation-page", page: current }));
    const without = createTeamProtocolV8Event(1, event);
    assert.ok(!hasVideoGeneration(JSON.stringify(without)));
    const frame = createTeamProtocolV8Event(2, event, { videoGeneration: true });
    const read = decodeTeamProtocolV8CurrentEvent(frame);
    assert.equal(read.status, "known");
    assert(read.status === "known" && read.event.type === "conversation-page");
    assert.deepEqual(read.event.page.messages[1]?.videoGeneration, videoGeneration);
    assert.deepEqual(read.event.page.references["quoted-1"]?.videoGeneration, videoGeneration);
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
    assert.ok(!hasVideoGeneration(JSON.stringify(createTeamProtocolV8Event(1, event))));
    const read = decodeTeamProtocolV8CurrentEvent(createTeamProtocolV8Event(2, event, { videoGeneration: true }));
    assert(read.status === "known" && read.event.type === "conversation");
    assert.deepEqual(read.event.snapshot.messages[1]?.videoGeneration, videoGeneration);
  });

  await step("a malformed value fails closed in both directions", () => {
    const broken = page([videoMessage("video-3", { aspectRatio: "wide" })]);
    assert.throws(() => httpV9.encodeResponse("GET", PAGE_PATH, 200, broken, { videoGeneration: true }));
    const wire = JSON.parse(httpV9.encodeResponse("GET", PAGE_PATH, 200, current, { videoGeneration: true }));
    wire.messages[1].videoGeneration = { aspectRatio: "landscape", durationSeconds: -1 };
    assert.throws(() => httpV9.decodeResponse("GET", PAGE_PATH, 200, wire));
    const wireEvent = JSON.parse(hostWireEvent({ type: "conversation-page", page: current }));
    wireEvent.page.messages[1].videoGeneration = { aspectRatio: "landscape", resolution: 720 };
    assert.throws(() => createTeamProtocolV8Event(1, wireEvent, { videoGeneration: true }));
    const read = decodeTeamProtocolV8CurrentEvent({ version: 2, type: "event", sequence: 1, payload: wireEvent });
    assert.notEqual(read.status, "known");
  });

  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify({ ok: true, steps }, null, 2)}\n`);
  process.stdout.write(`video-generation-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}\n`,
  );
  process.stderr.write(`video-generation-e2e failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
