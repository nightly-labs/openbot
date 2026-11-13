// Cross-server teammate relay (`agent-relay-v1`): directory, outbox claim/ack, deliver, cancel.
//
// The relaying member's own session is the authorization. Delivery needs that member's chat level
// on the recipient agent, and a hidden agent answers as a missing one. Origin names in an envelope
// are display labels; they grant nothing. Only the member who pushed a directory entry can claim
// the envelopes written for it, so one member cannot read another member's cross-server mail.
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { AGENT_RELAY_CAPABILITY, AGENT_RELAY_ROUTES } from "@openbot/contracts/team-protocol/agent-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import type { RelayEnvelope } from "../../backend/agent/agent-relay-store";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

export interface AgentRelayRouteDependencies {
  agents: Pick<
    TeamApiAgents,
    "listAgents" | "relayReplaceDirectory" | "relayClaim" | "relayAck" | "relayDeliver" | "relayCancel"
  >;
}

export async function routeAgentRelay(
  context: TeamApiRequestContext,
  { agents }: AgentRelayRouteDependencies,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !new Set<string>(Object.values(AGENT_RELAY_ROUTES)).has(url.pathname)) return "unmatched";
  if (!capabilities.has(AGENT_RELAY_CAPABILITY)) {
    throw new HttpError(400, sourceText("error.team.agentRelayUnsupported"));
  }
  const body = await readJson(request);

  if (url.pathname === AGENT_RELAY_ROUTES.directory) {
    const peers = Array.isArray(body.peers) ? body.peers : [];
    agents.relayReplaceDirectory(
      member.id,
      peers.flatMap((peer) =>
        isDynamicRecord(peer)
          ? [
              {
                peerId: stringField(peer, "peerId"),
                agentName: stringField(peer, "agentName", true, 256),
                serverName: stringField(peer, "serverName", true, 256),
              },
            ]
          : [],
      ),
    );
    return json(200, {});
  }
  if (url.pathname === AGENT_RELAY_ROUTES.claim) {
    return json(200, { envelopes: agents.relayClaim(member.id) });
  }
  if (url.pathname === AGENT_RELAY_ROUTES.ack) {
    agents.relayAck(member.id, stringField(body, "envelopeId"));
    return json(200, {});
  }
  if (url.pathname === AGENT_RELAY_ROUTES.cancel) {
    return json(200, { cancelled: agents.relayCancel(stringField(body, "envelopeId")) });
  }
  if (url.pathname === AGENT_RELAY_ROUTES.deliver) {
    const envelope: RelayEnvelope = {
      envelopeId: stringField(body, "envelopeId"),
      kind: body.kind === "reply" ? "reply" : "request",
      recipientAgentId: stringField(body, "recipientAgentId"),
      originAgentId: stringField(body, "originAgentId"),
      originAgentName: stringField(body, "originAgentName", true, 256),
      originServerName: stringField(body, "originServerName", true, 256),
      text: stringField(body, "text", false, 100_000),
      expectsReply: body.expectsReply !== false,
      ...(isString(body.replyToEnvelopeId) ? { replyToEnvelopeId: body.replyToEnvelopeId } : {}),
      createdAt: stringField(body, "createdAt", true, 64),
      expiresAt: stringField(body, "expiresAt", true, 64),
    };
    if (hiddenAgentIds.has(envelope.recipientAgentId)) {
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    }
    requireListedAgent(agents, envelope.recipientAgentId);
    requireAgentLevel(context, envelope.recipientAgentId, "chat");
    return json(200, await runCauseEffect(agents.relayDeliver(member.id, envelope)));
  }
  return "unmatched";
}
