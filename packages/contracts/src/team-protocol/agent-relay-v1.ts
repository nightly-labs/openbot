// Frozen optional agent-relay-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in client that
// holds sessions on two servers can relay one agent's teammate message from its own server to an
// agent on the other server, and relay the reply back. Servers never talk to each other and no
// third service stores the text. The host keeps a member-bound peer directory in memory only and a
// persistent outbox of envelopes that only the member who pushed the directory entry can claim.
// Delivery needs the relaying member's own chat level on the recipient agent; origin names are
// display labels and grant nothing. Envelopes are deduplicated by envelope id and expire 24 hours
// after creation. One recipient, no attachments. Widening any of it needs a second capability.
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const AGENT_RELAY_CAPABILITY = "agent-relay-v1";

export const AGENT_RELAY_ROUTES = {
  directory: "/v1/agent-relay/directory",
  claim: "/v1/agent-relay/claim",
  ack: "/v1/agent-relay/ack",
  deliver: "/v1/agent-relay/deliver",
  cancel: "/v1/agent-relay/cancel",
} as const;

const peer = fields({ peerId: identifier, agentName: string(256), serverName: string(256) });

const envelope = fields(
  {
    envelopeId: identifier,
    kind: oneOf("request", "reply"),
    recipientAgentId: identifier,
    originAgentId: identifier,
    originAgentName: string(256),
    originServerName: string(256),
    text: string(100_000),
    expectsReply: boolean,
    createdAt: string(64),
    expiresAt: string(64),
  },
  { replyToEnvelopeId: nullable(identifier) },
);

export const AGENT_RELAY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_RELAY_ROUTES.directory, adminRoute(fields({ peers: list(peer, 512) }), empty)],
  [AGENT_RELAY_ROUTES.claim, adminRoute(empty, fields({ envelopes: list(envelope, 64) }))],
  [AGENT_RELAY_ROUTES.ack, adminRoute(fields({ envelopeId: identifier }), empty)],
  [AGENT_RELAY_ROUTES.deliver, adminRoute(envelope, fields({ messageId: identifier, duplicate: boolean }))],
  [AGENT_RELAY_ROUTES.cancel, adminRoute(fields({ envelopeId: identifier }), fields({ cancelled: boolean }))],
]);
