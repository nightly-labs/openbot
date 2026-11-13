// Cross-server teammate relay for the web and mobile clients (`agent-relay-v1`).
//
// The desktop app relays from its main process; a phone or browser tab relays while it is in the
// foreground with connections to both hosts. Envelopes wait safely in the source host's outbox
// meanwhile. Peer ids are hashes of (server, agent) minted by the relaying client, so a host never
// learns another host's address or tokens. Replies route by the envelope they answer; the caller
// keeps that map (in memory is enough: a lost route only delays a reply until it expires).
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { AGENT_RELAY_ROUTES } from "@openbot/contracts/team-protocol/agent-relay-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sha256Hex } from "./team-api-requests";

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

export type RelayRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
) => Promise<T>;

export interface RelayHost {
  id: string;
  name: string;
  /** The host advertised `agent-relay-v1` and is connected now. */
  capable: boolean;
  agents: ReadonlyArray<{ id: string; name: string }>;
  request: RelayRequest;
}

export function relayPeerId(serverId: string, agentId: string): string {
  return `peer:${sha256Hex(new TextEncoder().encode(`${serverId}\0${agentId}`)).slice(0, 32)}`;
}

const ignore = (): undefined => undefined;

function decodeClaim(value: unknown): RelayEnvelope[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.envelopes)) throw new Error("Invalid relay claim.");
  return value.envelopes.map((entry) => {
    if (!isDynamicRecord(entry)) throw new Error("Invalid relay envelope.");
    const text = (field: string): string => {
      const item = entry[field];
      if (!isString(item)) throw new Error("Invalid relay envelope.");
      return item;
    };
    return {
      envelopeId: text("envelopeId"),
      kind: entry.kind === "reply" ? ("reply" as const) : ("request" as const),
      recipientAgentId: text("recipientAgentId"),
      originAgentId: text("originAgentId"),
      originAgentName: text("originAgentName"),
      originServerName: text("originServerName"),
      text: text("text"),
      expectsReply: entry.expectsReply !== false,
      ...(isString(entry.replyToEnvelopeId) ? { replyToEnvelopeId: entry.replyToEnvelopeId } : {}),
      createdAt: text("createdAt"),
      expiresAt: text("expiresAt"),
    };
  });
}

function decodeDelivered(value: unknown): { messageId: string; duplicate: boolean } {
  if (!isDynamicRecord(value) || !isString(value.messageId)) throw new Error("Invalid relay delivery.");
  return { messageId: value.messageId, duplicate: value.duplicate === true };
}

const post = <T>(host: RelayHost, path: string, decode: (value: unknown) => T, body: unknown): Promise<T> =>
  host.request("POST", path, decode, decodeTeamProtocolV2Json(body));

/**
 * One relay pass: refresh every capable host's peer directory, then carry each claimed envelope to
 * its destination host and ack the source. Failures leave the envelope in its outbox; its lease
 * expiry makes it claimable on a later pass.
 */
export async function runAgentRelayTick(hosts: RelayHost[], routes: Map<string, string>): Promise<void> {
  const capable = hosts.filter((host) => host.capable);
  if (capable.length < 2) return;
  for (const host of capable) {
    const peers = capable
      .filter((other) => other.id !== host.id)
      .flatMap((other) =>
        other.agents.map((agent) => ({
          peerId: relayPeerId(other.id, agent.id),
          agentName: agent.name,
          serverName: other.name,
        })),
      );
    await post(host, AGENT_RELAY_ROUTES.directory, ignore, { peers }).catch(() => undefined);
  }
  for (const source of capable) {
    const envelopes = await post(source, AGENT_RELAY_ROUTES.claim, decodeClaim, {}).catch((): RelayEnvelope[] => []);
    for (const envelope of envelopes) {
      const delivered = await deliver(source, envelope, capable, routes).catch(() => false);
      if (delivered) {
        await post(source, AGENT_RELAY_ROUTES.ack, ignore, { envelopeId: envelope.envelopeId }).catch(() => undefined);
      }
    }
  }
}

async function deliver(
  source: RelayHost,
  envelope: RelayEnvelope,
  hosts: RelayHost[],
  routes: Map<string, string>,
): Promise<boolean> {
  let destination: RelayHost | undefined;
  let recipientAgentId = envelope.recipientAgentId;
  if (envelope.kind === "request") {
    for (const host of hosts) {
      const agent = host.agents.find((candidate) => relayPeerId(host.id, candidate.id) === envelope.recipientAgentId);
      if (agent) {
        destination = host;
        recipientAgentId = agent.id;
        break;
      }
    }
    if (!destination) return false;
    routes.set(envelope.envelopeId, source.id);
  } else {
    const originId = envelope.replyToEnvelopeId ? routes.get(envelope.replyToEnvelopeId) : undefined;
    destination = hosts.find((host) => host.id === originId);
    if (!destination) return false;
  }
  await post(destination, AGENT_RELAY_ROUTES.deliver, decodeDelivered, { ...envelope, recipientAgentId });
  return true;
}
