// Cross-server agent relay state for one host (`agent-relay-v1`).
//
// A host never talks to another host. A signed-in client pushes a peer directory (kept in memory
// only, bound to the pushing member, short TTL), claims outbox envelopes that this host's agents
// wrote for peers in that member's directory, delivers them to the other host, and acks. Replies
// travel the same way in reverse. The outbox and the delivered-envelope registry persist beside
// the mailbox so a closed app or an offline destination only delays a message; nothing here is a
// delivery guarantee until the destination host accepts the envelope.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RelayPeer {
  peerId: string;
  agentName: string;
  serverName: string;
}

export interface RelayEnvelope {
  envelopeId: string;
  kind: "request" | "reply";
  recipientAgentId: string;
  originAgentId: string;
  originAgentName: string;
  originServerName: string;
  text: string;
  expectsReply: boolean;
  replyToEnvelopeId?: string | null;
  createdAt: string;
  expiresAt: string;
}

interface StoredEnvelope extends RelayEnvelope {
  memberId: string;
  /** The id the sending agent was given for its local receipt; replies reference it. */
  localMessageId: string;
  leaseUntil: number;
}

interface RelayState {
  version: 1;
  outbox: StoredEnvelope[];
  delivered: Array<{ envelopeId: string; messageId: string; memberId: string; at: number }>;
  /** Acked outbound envelopes, kept so a later reply can reference the sender's local message. */
  sent: Array<{ envelopeId: string; localMessageId: string; at: number }>;
}

const DIRECTORY_TTL_MS = 5 * 60_000;
const LEASE_MS = 60_000;
export const RELAY_ENVELOPE_TTL_MS = 24 * 60 * 60_000;
const DELIVERED_KEEP = 2_000;

function isRelayState(value: unknown): value is RelayState {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "outbox" in value &&
    Array.isArray(value.outbox) &&
    "delivered" in value &&
    Array.isArray(value.delivered)
  );
}

export class AgentRelayStore {
  readonly #path: string;
  #state: RelayState = { version: 1, outbox: [], delivered: [], sent: [] };
  readonly #directory = new Map<string, Map<string, RelayPeer & { expiresAt: number }>>();
  /** Set by the agent service; called for each envelope that expires unsent. */
  onExpired: ((envelope: RelayEnvelope & { localMessageId: string }) => void) | null = null;

  constructor(userDataPath: string) {
    this.#path = join(userDataPath, "agent-relay.json");
    try {
      const parsed = JSON.parse(readFileSync(this.#path, "utf8"));
      if (isRelayState(parsed)) {
        this.#state = { ...parsed, sent: Array.isArray(parsed.sent) ? parsed.sent : [] };
      }
    } catch {
      // First run, or an unreadable file: start empty. Unsent envelopes are lost, never invented.
    }
  }

  #persist(): void {
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#state), { mode: 0o600 });
    renameSync(tmp, this.#path);
  }

  #sweepExpired(now = Date.now()): void {
    const expired = this.#state.outbox.filter((e) => Date.parse(e.expiresAt) <= now);
    if (expired.length === 0) return;
    this.#state.outbox = this.#state.outbox.filter((e) => Date.parse(e.expiresAt) > now);
    this.#persist();
    for (const envelope of expired) this.onExpired?.(envelope);
  }

  replaceDirectory(memberId: string, peers: RelayPeer[]): void {
    const expiresAt = Date.now() + DIRECTORY_TTL_MS;
    this.#directory.set(memberId, new Map(peers.map((peer) => [peer.peerId, { ...peer, expiresAt }])));
  }

  /** Every fresh peer, across members. An agent sees names and server labels only. */
  peers(): Array<RelayPeer & { memberId: string }> {
    const now = Date.now();
    const result: Array<RelayPeer & { memberId: string }> = [];
    for (const [memberId, entries] of this.#directory) {
      for (const peer of entries.values()) {
        if (peer.expiresAt > now)
          result.push({ peerId: peer.peerId, agentName: peer.agentName, serverName: peer.serverName, memberId });
      }
    }
    return result;
  }

  peer(peerId: string): (RelayPeer & { memberId: string }) | null {
    return this.peers().find((candidate) => candidate.peerId === peerId) ?? null;
  }

  /** Write one outbound envelope. Returns the local receipt id the sender keeps. */
  enqueueOutbound(input: {
    memberId: string;
    kind: "request" | "reply";
    recipientAgentId: string;
    originAgentId: string;
    originAgentName: string;
    originServerName: string;
    text: string;
    expectsReply: boolean;
    replyToEnvelopeId?: string | null;
  }): { envelopeId: string; localMessageId: string } {
    this.#sweepExpired();
    const now = Date.now();
    const envelope: StoredEnvelope = {
      ...input,
      envelopeId: randomUUID(),
      localMessageId: randomUUID(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RELAY_ENVELOPE_TTL_MS).toISOString(),
      leaseUntil: 0,
    };
    this.#state.outbox.push(envelope);
    this.#persist();
    return { envelopeId: envelope.envelopeId, localMessageId: envelope.localMessageId };
  }

  /** Lease this member's pending envelopes, oldest first. A lease expiry makes them claimable again. */
  claim(memberId: string): RelayEnvelope[] {
    this.#sweepExpired();
    const now = Date.now();
    const claimed = this.#state.outbox.filter((e) => e.memberId === memberId && e.leaseUntil <= now);
    for (const envelope of claimed) envelope.leaseUntil = now + LEASE_MS;
    if (claimed.length > 0) this.#persist();
    return claimed.map(({ memberId: _m, localMessageId: _l, leaseUntil: _lease, ...wire }) => wire);
  }

  ack(memberId: string, envelopeId: string): boolean {
    const index = this.#state.outbox.findIndex((e) => e.envelopeId === envelopeId && e.memberId === memberId);
    if (index < 0) return false;
    const [envelope] = this.#state.outbox.splice(index, 1);
    if (envelope) {
      this.#state.sent.push({ envelopeId, localMessageId: envelope.localMessageId, at: Date.now() });
      if (this.#state.sent.length > DELIVERED_KEEP) this.#state.sent = this.#state.sent.slice(-DELIVERED_KEEP);
    }
    this.#persist();
    return true;
  }

  /** The local message id an outbound envelope was given, so a reply can reference it. */
  localMessageIdFor(envelopeId: string): string | null {
    return (
      this.#state.outbox.find((e) => e.envelopeId === envelopeId)?.localMessageId ??
      this.#state.sent.find((e) => e.envelopeId === envelopeId)?.localMessageId ??
      null
    );
  }

  deliveredMessageId(envelopeId: string): string | null {
    return this.#state.delivered.find((d) => d.envelopeId === envelopeId)?.messageId ?? null;
  }

  /** The member whose client delivered an envelope; only that member's client carries the reply. */
  deliveredMemberId(envelopeId: string): string | null {
    return this.#state.delivered.find((d) => d.envelopeId === envelopeId)?.memberId ?? null;
  }

  /** Whether a reply to this delivered envelope is already waiting or sent. */
  hasReplyFor(envelopeId: string): boolean {
    return this.#state.outbox.some((e) => e.replyToEnvelopeId === envelopeId);
  }

  recordDelivered(envelopeId: string, messageId: string, memberId: string): void {
    this.#state.delivered.push({ envelopeId, messageId, memberId, at: Date.now() });
    if (this.#state.delivered.length > DELIVERED_KEEP) {
      this.#state.delivered = this.#state.delivered.slice(-DELIVERED_KEEP);
    }
    this.#persist();
  }
}
