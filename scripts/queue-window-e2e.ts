// Checks that a remote client can read the queue of an agent with a long history (#2368). Runs the
// real mailbox store and SQLite on a temporary profile, and the real Team API queue route behind a
// local HTTP server. The client sends the capabilities and the protocol header that a current phone,
// web client or desktop sends, then the response goes through the V7 WebRTC encoder and the RPC
// frame encoder that the host peer uses. A frame larger than the WebRTC JSON limit throws there, as
// it does on a real host. No app, provider, account or network is started.
//
// Run: bun scripts/queue-window-e2e.ts
// Writes .openbot-build/queue-window-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isQueueSnapshot, type QueueSnapshot } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import {
  supportsTeamSemanticTags,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  TEAM_QUEUE_WINDOW_CAPABILITY,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES,
} from "@openbot/contracts/team-protocol/v2";
import {
  decodeTeamProtocolV6WebRtcHttpResponse,
  encodeTeamProtocolV6WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v6-webrtc-adapter";
import {
  decodeTeamProtocolV7WebRtcHttpResponse,
  encodeTeamProtocolV7WebRtcHttpResponse,
} from "@openbot/contracts/team-protocol/v7-webrtc-adapter";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { HttpError } from "../src/main/team-api/http-error";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { requestCapabilities, requestProtocol } from "../src/main/team-api/request-helpers";
import { type AgentQueueRouteDependencies, routeAgentQueue } from "../src/main/team-api/route-agent-queue";

const OUT = resolve(import.meta.dirname, "../.openbot-build/queue-window-e2e");
const HISTORY_AGENT = "agent-history";
const MIXED_AGENT = "agent-mixed";
/** 700 finished deliveries of about 4 KB: about 2.8 MB, more than one 2 MiB WebRTC frame. */
const HISTORY = 700;
const HISTORY_TEXT_BYTES = 4_000;
const LONG_AGENT = "agent-long";
/** 40 finished deliveries of about 90 KB: fewer than the count limit, but more than one frame. */
const LONG = 40;
const LONG_TEXT_BYTES = 90_000;
const QUEUED = 3;
const FAILED = 2;
const FAILURE_REASON = "The provider stopped the turn.";
const OLD_FAILURE_AGENT = "agent-old-failure";
/** More completed deliveries than the count limit, after one old failed and one old interrupted. */
const LATER_COMPLETED = 150;

interface ReadResult {
  protocol: number;
  queueWindow: boolean;
  status: number;
  httpBodyBytes: number;
  /** The RPC response frame that the host peer sends. */
  frameBytes: number;
  /** Whether the frame is within the WebRTC JSON frame limit. */
  fits: boolean;
  deliveries: number;
}

interface Report {
  frameLimitBytes: number;
  historyDeliveries: number;
  reads: Record<string, ReadResult>;
  checks: string[];
  passed: boolean;
  error?: string;
}

const report: Report = {
  frameLimitBytes: TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES,
  historyDeliveries: HISTORY,
  reads: {},
  checks: [],
  passed: false,
};

const member = {
  id: "member-1",
  username: "member@example.com",
  email: "member@example.com",
  name: "Member",
  role: "member",
  createdAt: new Date(0).toISOString(),
  disabled: false,
} as const;

const V7_WEBRTC = { encode: encodeTeamProtocolV7WebRtcHttpResponse, decode: decodeTeamProtocolV7WebRtcHttpResponse };
const V6_WEBRTC = { encode: encodeTeamProtocolV6WebRtcHttpResponse, decode: decodeTeamProtocolV6WebRtcHttpResponse };

function snapshotDeliveries(value: unknown): number {
  assert.ok(isQueueSnapshot(value), "The host answers a valid queue snapshot.");
  return value.deliveries.length;
}

function unused(name: string): never {
  throw new Error(`${name} is not part of this check.`);
}

/** The agent service methods the queue route calls, on the real mailbox store. */
function queueAgents(mailbox: MailboxStore): AgentQueueRouteDependencies["agents"] {
  return {
    listQueue: (agentId) => mailbox.listQueue(agentId),
    // The `begin` step of `QueueControls.edit`: lock the queued message, then answer the snapshot.
    editQueuedMessage: (agentId, input) =>
      Effect.sync(() => {
        assert.equal(input.action, "begin");
        mailbox.beginQueueEdit(agentId, input.deliveryId, input.editId);
        return mailbox.listQueue(agentId);
      }),
    acknowledgeFailedTurn: () => unused("acknowledgeFailedTurn"),
    cancelQueuedMessage: () => Effect.sync(() => unused("cancelQueuedMessage")),
    steerQueuedMessage: () => Effect.sync(() => unused("steerQueuedMessage")),
    updateQueuedMessage: () => Effect.sync(() => unused("updateQueuedMessage")),
    reorderQueue: () => Effect.sync(() => unused("reorderQueue")),
    interrupt: () => Effect.sync(() => unused("interrupt")),
    listAgents: () => [],
  };
}

/** The request context `TeamApiServer` builds, with the response encoded by the negotiated protocol. */
function requestContext(request: IncomingMessage, response: ServerResponse, url: URL): TeamApiRequestContext {
  const method = request.method ?? "GET";
  const protocol = requestProtocol(request);
  const capabilities = requestCapabilities(request);
  return {
    request,
    response,
    method,
    url,
    protocol,
    capabilities,
    member,
    token: "token",
    agentLevel: () => "manage",
    sessionId: "session",
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    json: (status, value) => {
      const body = teamHttpCodec(protocol).encodeResponse(method, url.pathname, status, value, {
        preserveSemanticTags: supportsTeamSemanticTags(capabilities),
        historyExtent: capabilities.has(TEAM_HISTORY_EXTENT_CAPABILITY),
      });
      response.writeHead(status, { "content-type": "application/json" }).end(body);
      return "handled";
    },
    empty: (status) => {
      response.writeHead(status).end();
      return "handled";
    },
  };
}

async function startHost(agents: AgentQueueRouteDependencies["agents"]): Promise<{ origin: string; close(): void }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const [, , , agentId, ...action] = url.pathname.split("/");
    routeAgentQueue(
      requestContext(request, response, url),
      { agentId: agentId ?? "", action: action.join("/") },
      {
        agents,
      },
    )
      .then((outcome) => {
        if (outcome === "unmatched") response.writeHead(404).end();
      })
      .catch((error: unknown) => {
        const status = error instanceof HttpError ? error.status : 500;
        response
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify({ error: String(error) }));
      });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The server has no TCP address.");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

/**
 * One queue read as a remote client makes it over WebRTC: the host peer forwards it to the local Team
 * API, encodes the answer again for V7 and puts it in one RPC frame. The client decodes the frame.
 */
async function read(
  origin: string,
  name: string,
  input: { method: "GET" | "POST"; path: string; body?: object; protocol: number; queueWindow: boolean },
): Promise<QueueSnapshot | null> {
  const capabilities = teamCapabilitiesForProtocol(input.protocol).filter(
    (capability) => input.queueWindow || capability !== TEAM_QUEUE_WINDOW_CAPABILITY,
  );
  assert.equal(
    capabilities.includes(TEAM_QUEUE_WINDOW_CAPABILITY),
    input.queueWindow,
    "A current client advertises queue-window-v1 only on protocol 7.",
  );
  const response = await fetch(`${origin}${input.path}`, {
    method: input.method,
    headers: {
      "content-type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(input.protocol),
      [TEAM_CAPABILITIES_HEADER]: capabilities.join(","),
    },
    ...(input.body
      ? { body: teamHttpCodec(input.protocol).encodeRequest(input.method, input.path, input.body, {}) }
      : {}),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${name}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  const webRtc = input.protocol >= 7 ? V7_WEBRTC : V6_WEBRTC;
  // What the host peer sends: the local answer encoded again for the peer's protocol, in one RPC frame.
  const frame = {
    version: 2,
    type: "response",
    requestId: "request-1",
    result: {
      status: response.status,
      body: webRtc.encode(input.method, input.path, response.status, body, {
        preserveSemanticTags: true,
        historyExtent: true,
      }),
    },
  } as const;
  const frameBytes = Buffer.byteLength(JSON.stringify(frame));
  const result: ReadResult = {
    protocol: input.protocol,
    queueWindow: input.queueWindow,
    status: response.status,
    httpBodyBytes: Buffer.byteLength(text),
    frameBytes,
    fits: frameBytes <= TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES,
    deliveries: snapshotDeliveries(teamHttpCodec(input.protocol).decodeResponse(input.method, input.path, 200, body)),
  };
  report.reads[name] = result;
  if (!result.fits) {
    assert.throws(() => encodeTeamProtocolV2Frame(frame), /JSON frame size/u, "The host peer refuses the frame.");
    return null;
  }
  const decoded = decodeTeamProtocolV2RpcFrame(encodeTeamProtocolV2Frame(frame));
  assert.ok("result" in decoded && isDynamicRecord(decoded.result) && isNumber(decoded.result.status));
  const snapshot = webRtc.decode(input.method, input.path, decoded.result.status, decoded.result.body);
  assert.ok(isQueueSnapshot(snapshot), `${name}: the client reads a valid queue snapshot.`);
  return snapshot;
}

async function enqueue(mailbox: MailboxStore, agentId: string, text: string): Promise<string> {
  const receipt = await runCauseEffect(
    mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agentId], text }),
  );
  const delivery = receipt.deliveries.find((candidate) => candidate.recipientAgentId === agentId);
  assert.ok(delivery);
  return delivery.id;
}

async function finish(
  mailbox: MailboxStore,
  deliveryId: string,
  status: "completed" | "failed" | "interrupted",
  error: string | null = null,
): Promise<void> {
  await runCauseEffect(mailbox.markStarting(deliveryId));
  await runCauseEffect(mailbox.markTerminal(deliveryId, status, error));
}

async function seedHistory(
  mailbox: MailboxStore,
  agentId: string,
  count = HISTORY,
  textBytes = HISTORY_TEXT_BYTES,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = await enqueue(mailbox, agentId, `history ${index} ${"x".repeat(textBytes)}`);
    await finish(mailbox, id, "completed");
    ids.push(id);
  }
  return ids;
}

/** An old failure keeps its reason after more completed deliveries than the count limit. */
async function checkOldFailure(origin: string, mailbox: MailboxStore): Promise<void> {
  const failed = await enqueue(mailbox, OLD_FAILURE_AGENT, "old failed");
  await finish(mailbox, failed, "failed", FAILURE_REASON);
  const interrupted = await enqueue(mailbox, OLD_FAILURE_AGENT, "old interrupted");
  await finish(mailbox, interrupted, "interrupted");
  const completed = await seedHistory(mailbox, OLD_FAILURE_AGENT, LATER_COMPLETED);
  const snapshot = await read(origin, "old-failure-with-window", {
    method: "GET",
    path: `/v1/agents/${OLD_FAILURE_AGENT}/queue`,
    protocol: 7,
    queueWindow: true,
  });
  assert.ok(snapshot, "The snapshot with an old failure fits in one frame.");
  const byId = new Map(snapshot.deliveries.map((delivery) => [delivery.id, delivery]));
  assert.equal(byId.get(failed)?.status, "failed", "The old failed delivery stays.");
  assert.equal(byId.get(failed)?.error, FAILURE_REASON, "The old failure reason stays.");
  assert.equal(byId.get(interrupted)?.status, "interrupted", "The old interrupted delivery stays.");
  assert.deepEqual(
    snapshot.deliveries.map((delivery) => delivery.id),
    [failed, interrupted, ...completed.slice(-100)],
    "Only the oldest completed deliveries leave, and queue order stays.",
  );
  report.checks.push(
    `old failure: 1 failed and 1 interrupted delivery before ${LATER_COMPLETED} completed stay; ` +
      `${snapshot.deliveries.length} deliveries in a ${report.reads["old-failure-with-window"]?.frameBytes}-byte frame`,
  );
}

/** Long messages: the frame budget, not the count limit, ends the window. */
async function checkLongMessages(origin: string, mailbox: MailboxStore): Promise<void> {
  const history = await seedHistory(mailbox, LONG_AGENT, LONG, LONG_TEXT_BYTES);
  const path = `/v1/agents/${LONG_AGENT}/queue`;
  assert.equal(
    await read(origin, "long-without-window", { method: "GET", path, protocol: 7, queueWindow: false }),
    null,
  );
  const windowed = await read(origin, "long-with-window", { method: "GET", path, protocol: 7, queueWindow: true });
  assert.ok(windowed, "With the capability the snapshot of long messages fits in one frame.");
  assert.ok(windowed.deliveries.length > 0 && windowed.deliveries.length < LONG);
  assert.deepEqual(
    windowed.deliveries.map((delivery) => delivery.id),
    history.slice(-windowed.deliveries.length),
  );
  report.checks.push(
    `long messages with queue-window-v1: the newest ${windowed.deliveries.length} of ${LONG} in a ` +
      `${report.reads["long-with-window"]?.frameBytes}-byte frame`,
  );
}

async function checkHistoryOnly(origin: string, mailbox: MailboxStore, history: string[]): Promise<void> {
  const path = `/v1/agents/${HISTORY_AGENT}/queue`;
  assert.equal(mailbox.listQueue(HISTORY_AGENT).deliveries.length, HISTORY);

  const legacy = await read(origin, "history-without-window", { method: "GET", path, protocol: 7, queueWindow: false });
  assert.equal(report.reads["history-without-window"]?.deliveries, HISTORY);
  assert.equal(legacy, null, "Without the capability the host keeps the full list, which passes one frame.");
  report.checks.push(
    `without queue-window-v1: the full list of ${HISTORY} deliveries, larger than one frame (the reported failure)`,
  );

  const released = await read(origin, "history-protocol-6", { method: "GET", path, protocol: 6, queueWindow: false });
  assert.equal(released, null);
  assert.equal(report.reads["history-protocol-6"]?.deliveries, HISTORY);
  report.checks.push("protocol 6: the full list, as the released contract says");

  const windowed = await read(origin, "history-with-window", { method: "GET", path, protocol: 7, queueWindow: true });
  assert.ok(windowed, "With the capability the snapshot fits in one frame.");
  const frameBytes = report.reads["history-with-window"]?.frameBytes ?? Number.POSITIVE_INFINITY;
  assert.ok(frameBytes <= TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES);
  assert.equal(windowed.agentId, HISTORY_AGENT);
  assert.ok(windowed.deliveries.length > 0 && windowed.deliveries.length <= 100);
  assert.ok(windowed.deliveries.every((delivery) => delivery.status === "completed"));
  assert.deepEqual(
    windowed.deliveries.map((delivery) => delivery.id),
    history.slice(-windowed.deliveries.length),
    "The window keeps the newest finished deliveries, in queue order.",
  );
  report.checks.push(
    `with queue-window-v1: the newest ${windowed.deliveries.length} of ${HISTORY} completed deliveries in a ${frameBytes}-byte frame`,
  );
}

async function checkMixed(origin: string, mailbox: MailboxStore): Promise<void> {
  const path = `/v1/agents/${MIXED_AGENT}/queue`;
  await seedHistory(mailbox, MIXED_AGENT);
  const failed: string[] = [];
  for (let index = 0; index < FAILED; index += 1) {
    const id = await enqueue(mailbox, MIXED_AGENT, `failed ${index}`);
    await finish(mailbox, id, "failed", FAILURE_REASON);
    failed.push(id);
  }
  const running = await enqueue(mailbox, MIXED_AGENT, "running");
  await runCauseEffect(mailbox.markStarting(running));
  await runCauseEffect(mailbox.markRunning(running, "turn-running"));
  const queued: string[] = [];
  for (let index = 0; index < QUEUED; index += 1)
    queued.push(await enqueue(mailbox, MIXED_AGENT, `queued ${index} ${"y".repeat(HISTORY_TEXT_BYTES)}`));
  const edited = queued[1];
  assert.ok(edited);

  const begin = await read(origin, "edit-begin-with-window", {
    method: "POST",
    path: `${path}/edit`,
    body: { action: "begin", deliveryId: edited, editId: "edit-1" },
    protocol: 7,
    queueWindow: true,
  });
  assert.ok(begin, "The queue edit answer fits in one frame.");
  assert.equal(begin.deliveries.find((delivery) => delivery.id === edited)?.editing, true);
  report.checks.push("queue/edit begin with queue-window-v1: fits in one frame and marks the edited message");

  const snapshot = await read(origin, "mixed-with-window", { method: "GET", path, protocol: 7, queueWindow: true });
  assert.ok(snapshot);
  const byId = new Map(snapshot.deliveries.map((delivery) => [delivery.id, delivery]));
  for (const id of queued) assert.equal(byId.get(id)?.status, "queued", "Every queued delivery stays.");
  assert.equal(byId.get(edited)?.editing, true, "The edit lock stays.");
  assert.equal(byId.get(running)?.status, "running", "The running delivery stays.");
  assert.equal(byId.get(running)?.turnId, "turn-running");
  for (const id of failed) {
    assert.equal(byId.get(id)?.status, "failed", "The newest failed deliveries stay.");
    assert.equal(byId.get(id)?.error, FAILURE_REASON, "The failure reason stays.");
  }
  assert.deepEqual(
    snapshot.deliveries.filter((delivery) => delivery.status === "queued").map((delivery) => delivery.position),
    [1, 2, 3],
    "The queued deliveries keep their positions.",
  );
  const full = mailbox.listQueue(MIXED_AGENT).deliveries.map((delivery) => delivery.id);
  const kept = snapshot.deliveries.map((delivery) => delivery.id);
  assert.deepEqual(
    kept,
    full.filter((id) => byId.has(id)),
    "The window keeps queue order.",
  );
  report.checks.push(
    `mixed: ${QUEUED} queued (1 editing), 1 running and ${FAILED} failed with their reason, ` +
      `${snapshot.deliveries.length} of ${full.length} deliveries in a ${report.reads["mixed-with-window"]?.frameBytes}-byte frame`,
  );

  assert.equal(
    await read(origin, "mixed-without-window", { method: "GET", path, protocol: 7, queueWindow: false }),
    null,
  );
  report.checks.push("mixed without queue-window-v1: the full list, larger than one frame");
}

const root = await mkdtemp(join(tmpdir(), "openbot-queue-window-"));
const path = join(root, "profile");
const database = new OpenBotDatabase(path);
let host: { origin: string; close(): void } | null = null;
try {
  const mailbox = new MailboxStore(path, join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  host = await startHost(queueAgents(mailbox));
  const history = await seedHistory(mailbox, HISTORY_AGENT);
  await checkHistoryOnly(host.origin, mailbox, history);
  await checkMixed(host.origin, mailbox);
  await checkOldFailure(host.origin, mailbox);
  await checkLongMessages(host.origin, mailbox);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  host?.close();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.checks.length} checks. Report: ${join(OUT, "report.json")}\n`,
);
if (!report.passed) {
  process.stderr.write(`${report.error ?? ""}\n`);
  process.exitCode = 1;
}
