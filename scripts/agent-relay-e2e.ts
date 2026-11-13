// Cross-server agent relay (`agent-relay-v1`) end to end, without a network or a real user.
//
// Two real `AgentRelayStore`s on temporary folders stand for two hosts (Rosie and Mack). The real
// `runAgentRelayTick` from the team client is the signed-in client that carries envelopes between
// them; each host's request adapter answers from its store the way the Team API route does, with
// delivery deduplicated by envelope id in the store. The recipient's inbox is a plain list: what
// lands in it, and the report under `.openbot-build/agent-relay-e2e/report.json`, are the evidence.
//
// Covered: directory peers appear, a request reaches the other host's agent, its reply routes back
// to the sender's local message, an offline destination only delays delivery, another member
// cannot claim the outbox, a duplicate delivery lands once, and an expired envelope is reported
// instead of delivered.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type RelayHost, runAgentRelayTick } from "@openbot/team-client/agent-relay";
import { AgentRelayStore, type RelayEnvelope } from "../src/backend/agent/agent-relay-store";

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}
const checks: Check[] = [];
function check(name: string, passed: boolean, detail?: unknown): void {
  checks.push({ name, passed, detail });
}

const MEMBER = "member-user";
const root = mkdtempSync(join(tmpdir(), "openbot-agent-relay-e2e-"));

interface FakeHost {
  store: AgentRelayStore;
  inbox: RelayEnvelope[];
  host: RelayHost;
}

function fakeHost(id: string, name: string, agents: Array<{ id: string; name: string }>, capable: boolean): FakeHost {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const store = new AgentRelayStore(dir);
  const inbox: RelayEnvelope[] = [];
  const fake: FakeHost = {
    store,
    inbox,
    host: {
      id,
      name,
      capable,
      agents,
      request: async <T>(method: string, path: string, decode: (value: unknown) => T, body?: unknown): Promise<T> => {
        assert.equal(method, "POST");
        const record: DynamicRecord = isDynamicRecord(body) ? body : {};
        const text = (field: string): string => {
          const value = record[field];
          if (!isString(value)) throw new Error(`Missing ${field}.`);
          return value;
        };
        if (path.endsWith("/directory")) {
          const peers = Array.isArray(record.peers) ? record.peers : [];
          store.replaceDirectory(
            MEMBER,
            peers.flatMap((peer) =>
              isDynamicRecord(peer) && isString(peer.peerId) && isString(peer.agentName) && isString(peer.serverName)
                ? [{ peerId: peer.peerId, agentName: peer.agentName, serverName: peer.serverName }]
                : [],
            ),
          );
          return decode({});
        }
        if (path.endsWith("/claim")) return decode({ envelopes: store.claim(MEMBER) });
        if (path.endsWith("/ack")) {
          store.ack(MEMBER, text("envelopeId"));
          return decode({});
        }
        if (path.endsWith("/deliver")) {
          const envelope: RelayEnvelope = {
            envelopeId: text("envelopeId"),
            kind: record.kind === "reply" ? "reply" : "request",
            recipientAgentId: text("recipientAgentId"),
            originAgentId: text("originAgentId"),
            originAgentName: text("originAgentName"),
            originServerName: text("originServerName"),
            text: text("text"),
            expectsReply: record.expectsReply !== false,
            ...(isString(record.replyToEnvelopeId) ? { replyToEnvelopeId: record.replyToEnvelopeId } : {}),
            createdAt: text("createdAt"),
            expiresAt: text("expiresAt"),
          };
          const existing = store.deliveredMessageId(envelope.envelopeId);
          if (existing) return decode({ messageId: existing, duplicate: true });
          if (Date.parse(envelope.expiresAt) <= Date.now()) throw new Error("expired");
          inbox.push(envelope);
          const messageId = `msg-${inbox.length}`;
          store.recordDelivered(envelope.envelopeId, messageId, MEMBER);
          return decode({ messageId, duplicate: false });
        }
        throw new Error(`Unexpected path ${path}`);
      },
    },
  };
  return fake;
}

async function main(): Promise<void> {
  const rosie = fakeHost("rosie", "Rosie", [{ id: "agent-rosie", name: "Scout" }], true);
  const mack = fakeHost("mack", "Mack", [{ id: "agent-hermes", name: "Hermes" }], false);
  const routes = new Map<string, string>();
  const hosts = () => [rosie.host, mack.host];

  // Offline first: the directory on Rosie has no peer until Mack is capable and a tick runs.
  await runAgentRelayTick(hosts(), routes);
  check("no peer is listed while the other server is offline", rosie.store.peers().length === 0, rosie.store.peers());

  mack.host.capable = true;
  await runAgentRelayTick(hosts(), routes);
  const peers = rosie.store.peers();
  check(
    "the directory tick lists Hermes on Mack as a peer of Rosie's agents",
    peers.length === 1 && peers[0]?.agentName === "Hermes" && peers[0]?.serverName === "Mack",
    peers,
  );

  // Scout on Rosie sends to the peer; the envelope waits in Rosie's outbox until a client tick.
  const peer = peers[0];
  assert.ok(peer);
  const sent = rosie.store.enqueueOutbound({
    memberId: MEMBER,
    kind: "request",
    recipientAgentId: peer.peerId,
    originAgentId: "agent-rosie",
    originAgentName: "Scout",
    originServerName: "Rosie",
    text: "Status check: is the render done?",
    expectsReply: true,
  });
  check("another member cannot claim the envelope", rosie.store.claim("member-other").length === 0);

  await runAgentRelayTick(hosts(), routes);
  check(
    "the request lands in Hermes' inbox with its origin labels",
    mack.inbox.length === 1 &&
      mack.inbox[0]?.text === "Status check: is the render done?" &&
      mack.inbox[0]?.originAgentName === "Scout" &&
      mack.inbox[0]?.recipientAgentId === "agent-hermes",
    mack.inbox,
  );

  // A second delivery of the same envelope (a retried claim) does not land twice.
  const request = mack.inbox[0];
  assert.ok(request);
  await mack.host.request("POST", "/v1/agent-relay/deliver", (value) => value, { ...request });
  check("a duplicate delivery of one envelope lands once", mack.inbox.length === 1, mack.inbox.length);

  // Hermes replies: the reply envelope routes back and references Scout's local message.
  const memberId = mack.store.deliveredMemberId(request.envelopeId);
  assert.equal(memberId, MEMBER);
  mack.store.enqueueOutbound({
    memberId,
    kind: "reply",
    recipientAgentId: request.originAgentId,
    originAgentId: "agent-hermes",
    originAgentName: "Hermes",
    originServerName: "Mack",
    text: "Status: done\nResult: Render finished.\nEvidence: none",
    expectsReply: false,
    replyToEnvelopeId: request.envelopeId,
  });
  await runAgentRelayTick(hosts(), routes);
  check(
    "the reply lands back on Rosie for the agent that asked",
    rosie.inbox.length === 1 && rosie.inbox[0]?.recipientAgentId === "agent-rosie" && rosie.inbox[0]?.kind === "reply",
    rosie.inbox,
  );
  check(
    "the reply references the sender's local message id on its own host",
    rosie.store.localMessageIdFor(request.envelopeId) === sent.localMessageId,
    { local: rosie.store.localMessageIdFor(request.envelopeId), sent: sent.localMessageId },
  );

  // Expiry: an envelope whose time has passed is reported, never delivered.
  const expiredDir = join(root, "expired");
  mkdirSync(expiredDir, { recursive: true });
  writeFileSync(
    join(expiredDir, "agent-relay.json"),
    JSON.stringify({
      version: 1,
      outbox: [
        {
          envelopeId: "env-expired",
          kind: "request",
          recipientAgentId: "peer:x",
          originAgentId: "agent-rosie",
          originAgentName: "Scout",
          originServerName: "Rosie",
          text: "Too late.",
          expectsReply: true,
          createdAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-02T00:00:00.000Z",
          memberId: MEMBER,
          localMessageId: "local-expired",
          leaseUntil: 0,
        },
      ],
      delivered: [],
      sent: [],
    }),
  );
  const expiredStore = new AgentRelayStore(expiredDir);
  const expired: string[] = [];
  expiredStore.onExpired = (envelope) => expired.push(envelope.envelopeId);
  const claimed = expiredStore.claim(MEMBER);
  check(
    "an expired envelope is swept and reported instead of claimed",
    claimed.length === 0 && expired.length === 1 && expired[0] === "env-expired",
    { claimed: claimed.length, expired },
  );
}

try {
  await main();
} finally {
  const outDir = join(process.cwd(), ".openbot-build", "agent-relay-e2e");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify({ checks }, null, 2));
  rmSync(root, { recursive: true, force: true });
}
const failed = checks.filter((entry) => !entry.passed);
for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
assert.equal(failed.length, 0, `${failed.length} agent relay checks failed.`);
