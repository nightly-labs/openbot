// The desktop half of cross-server teammate relay (`agent-relay-v1`).
//
// Servers never talk to each other. This signed-in client — the only party with sessions on every
// server — pushes each capable host a directory of the other hosts' agents, then carries outbox
// envelopes host to host: claim, deliver, ack. A peer id is a hash of (server, agent), minted here,
// so a host never learns another host's address, ids used by this client, or tokens. Replies route
// by the envelope id they answer; that map persists beside the app data so a restart mid-flight
// still finds its way back. When no client runs, envelopes wait in the source host's outbox.
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_SERVER_ID, type ServerSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_RELAY_CAPABILITY, AGENT_RELAY_ROUTES } from "@openbot/contracts/team-protocol/agent-relay-v1";
import type { Effect } from "effect";
import type { RelayEnvelope } from "../backend/agent/agent-relay-store";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";
import { decodeAgentSummaries } from "./remote-agent-decoding";
import { acceptEmpty } from "./remote-host-decoding";
import type { RemoteWorkflowError } from "./remote-service-effects";

const TICK_MS = 30_000;
/** The member binding for direct calls into this computer's own host. */
const LOCAL_MEMBER = "desktop-relay";

export interface AgentRelayClientDependencies {
  servers: () => ServerSummary[];
  supportsCapability: (serverId: string, capability: typeof AGENT_RELAY_CAPABILITY) => boolean;
  request: <T>(
    serverId: string,
    path: string,
    decoder: (value: unknown) => T,
    init?: { method?: string; body?: unknown },
  ) => Effect.Effect<T, RemoteWorkflowError>;
  local: {
    listAgents: () => ReadonlyArray<{ id: string; name: string }>;
    relayReplaceDirectory: (
      memberId: string,
      peers: Array<{ peerId: string; agentName: string; serverName: string }>,
    ) => void;
    relayClaim: (memberId: string) => RelayEnvelope[];
    relayAck: (memberId: string, envelopeId: string) => boolean;
    relayDeliver: (
      memberId: string,
      envelope: RelayEnvelope,
    ) => Effect.Effect<{ messageId: string; duplicate: boolean }, AgentLifecycleFailed>;
  };
  userDataPath: string;
  logError: (message: string, error: unknown) => void;
}

function peerIdFor(serverId: string, agentId: string): string {
  return `peer:${createHash("sha256").update(`${serverId}\0${agentId}`).digest("hex").slice(0, 32)}`;
}

function decodeClaim(value: unknown): RelayEnvelope[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.envelopes)) throw new Error("Invalid relay claim.");
  return value.envelopes.map((entry) => {
    if (!isDynamicRecord(entry)) throw new Error("Invalid relay envelope.");
    const text = (field: string) => {
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

interface RelayServer {
  id: string;
  name: string;
  local: boolean;
  agents: Array<{ id: string; name: string }>;
}

export class AgentRelayClient {
  readonly #deps: AgentRelayClientDependencies;
  readonly #routesPath: string;
  #routes = new Map<string, string>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(deps: AgentRelayClientDependencies) {
    this.#deps = deps;
    this.#routesPath = join(deps.userDataPath, "agent-relay-routes.json");
    try {
      const parsed = JSON.parse(readFileSync(this.#routesPath, "utf8"));
      if (isDynamicRecord(parsed)) {
        this.#routes = new Map(
          Object.entries(parsed).flatMap(([key, value]) => (isString(value) ? [[key, value] as const] : [])),
        );
      }
    } catch {
      // No routes yet. Replies without a route wait in their outbox and expire there.
    }
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#tick(), TICK_MS);
    void this.#tick();
  }

  dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  #saveRoutes(): void {
    const tmp = `${this.#routesPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.#routes)), { mode: 0o600 });
    renameSync(tmp, this.#routesPath);
  }

  async #tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const servers = await this.#capableServers();
      if (servers.length < 2) return;
      await this.#pushDirectories(servers);
      for (const server of servers) await this.#relayFrom(server, servers);
    } catch (error) {
      this.#deps.logError("Agent relay tick failed:", error);
    } finally {
      this.#running = false;
    }
  }

  async #capableServers(): Promise<RelayServer[]> {
    const result: RelayServer[] = [];
    for (const summary of this.#deps.servers()) {
      if (summary.id === LOCAL_SERVER_ID) {
        result.push({ id: summary.id, name: summary.name, local: true, agents: [...this.#deps.local.listAgents()] });
        continue;
      }
      if (summary.state !== "online" || summary.capabilitiesPending) continue;
      if (!this.#deps.supportsCapability(summary.id, AGENT_RELAY_CAPABILITY)) continue;
      const agents = await runCauseEffect(
        this.#deps.request(summary.id, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
      ).catch(() => null);
      if (agents) result.push({ id: summary.id, name: summary.name, local: false, agents });
    }
    return result;
  }

  async #pushDirectories(servers: RelayServer[]): Promise<void> {
    for (const server of servers) {
      const peers = servers
        .filter((other) => other.id !== server.id)
        .flatMap((other) =>
          other.agents.map((agent) => ({
            peerId: peerIdFor(other.id, agent.id),
            agentName: agent.name,
            serverName: other.name,
          })),
        );
      if (server.local) {
        this.#deps.local.relayReplaceDirectory(LOCAL_MEMBER, peers);
      } else {
        await runCauseEffect(
          this.#deps.request(server.id, AGENT_RELAY_ROUTES.directory, acceptEmpty, { method: "POST", body: { peers } }),
        ).catch((error) => this.#deps.logError("Agent relay directory push failed:", error));
      }
    }
  }

  async #relayFrom(source: RelayServer, servers: RelayServer[]): Promise<void> {
    const envelopes = source.local
      ? this.#deps.local.relayClaim(LOCAL_MEMBER)
      : await runCauseEffect(
          this.#deps.request(source.id, AGENT_RELAY_ROUTES.claim, decodeClaim, { method: "POST", body: {} }),
        ).catch((): RelayEnvelope[] => []);
    for (const envelope of envelopes) {
      const delivered = await this.#deliver(source, envelope, servers).catch((error) => {
        this.#deps.logError("Agent relay delivery failed:", error);
        return false;
      });
      if (!delivered) continue; // The lease expires and a later tick claims it again.
      if (source.local) {
        this.#deps.local.relayAck(LOCAL_MEMBER, envelope.envelopeId);
      } else {
        await runCauseEffect(
          this.#deps.request(source.id, AGENT_RELAY_ROUTES.ack, acceptEmpty, {
            method: "POST",
            body: { envelopeId: envelope.envelopeId },
          }),
        ).catch(() => undefined);
      }
    }
  }

  async #deliver(source: RelayServer, envelope: RelayEnvelope, servers: RelayServer[]): Promise<boolean> {
    let destination: RelayServer | undefined;
    let recipientAgentId = envelope.recipientAgentId;
    if (envelope.kind === "request") {
      // The recipient is a peer id this client minted; only this client can resolve it.
      for (const server of servers) {
        const agent = server.agents.find(
          (candidate) => peerIdFor(server.id, candidate.id) === envelope.recipientAgentId,
        );
        if (agent) {
          destination = server;
          recipientAgentId = agent.id;
          break;
        }
      }
      if (!destination) return false;
      this.#routes.set(envelope.envelopeId, source.id);
      this.#saveRoutes();
    } else {
      const originServerId = envelope.replyToEnvelopeId ? this.#routes.get(envelope.replyToEnvelopeId) : undefined;
      destination = servers.find((server) => server.id === originServerId);
      if (!destination) return false;
    }
    const wire = { ...envelope, recipientAgentId };
    if (destination.local) {
      await runCauseEffect(this.#deps.local.relayDeliver(LOCAL_MEMBER, wire));
    } else {
      await runCauseEffect(
        this.#deps.request(destination.id, AGENT_RELAY_ROUTES.deliver, decodeDelivered, { method: "POST", body: wire }),
      );
    }
    return true;
  }
}
