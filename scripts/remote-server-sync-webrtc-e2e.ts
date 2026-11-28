import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type ChannelSummary,
  type ConversationMessage,
  type ConversationPage,
  decodeChannelSummaries,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V9,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import { AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHANNELS_SYNC_COLLECTION } from "@openbot/contracts/team-protocol/sync-collections";
import { AGENT_MESSAGES_SYNC_LOG } from "@openbot/contracts/team-protocol/sync-logs";
import {
  decodeSyncServerMessage,
  isSyncClientMessage,
  type SyncServerMessage,
  syncName,
} from "@openbot/contracts/team-protocol/sync-v1";
import {
  decodeTeamProtocolV2EventFrame,
  type TeamProtocolV2EventFrame,
} from "@openbot/contracts/team-protocol/webrtc-framing";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-server-sync-webrtc-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const CHANNELS = CHANNELS_SYNC_COLLECTION.name;
const CLIENT_FINGERPRINTS = { localFingerprint: "client-fingerprint", remoteFingerprint: "host-fingerprint" };
const HOST_FINGERPRINTS = { localFingerprint: "host-fingerprint", remoteFingerprint: "client-fingerprint" };

delete process.env.ELECTRON_RENDERER_URL;

plugin({
  name: "remote-server-sync-webrtc-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => APP_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: class extends Inert {
          static getAllWindows() {
            return [];
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: class extends Inert {
          static isSupported() {
            return false;
          }
        },
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const realFetch = globalThis.fetch;
const httpCalls = new Map<string, number>();

function callKey(port: string | number, method: string, path: string): string {
  return `${port} ${method} ${path}`;
}

function httpCallCount(port: string | number, method: string, path: string): number {
  return httpCalls.get(callKey(port, method, path)) ?? 0;
}

globalThis.fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const call = callKey(url.port, method, url.pathname);
    httpCalls.set(call, (httpCalls.get(call) ?? 0) + 1);
    return realFetch(input, init);
  },
  { preconnect: realFetch.preconnect },
);

const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { REMOTE_SYNC_CONVERSATION_ROWS, syncedOrRequest } = await import("../src/main/remote-server-sync");
const { RemoteWorkflowError } = await import("../src/main/remote-service-effects");
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { TeamWebRtcBridge } = await import("../src/main/team-webrtc-bridge");
const { TeamWebRtcClientTransport } = await import("../src/main/team-webrtc-client-transport");
const { TeamWebRtcHostPeer } = await import("../src/main/team-webrtc-host-peer");

type Manager = InstanceType<typeof RemoteServerManager>;
type HostPeer = InstanceType<typeof TeamWebRtcHostPeer>;
type Channel = "rpc" | "events" | "files" | "desktop";

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The RTCPeerConnection, ICE, DTLS and Signal. Two loopback bridges carry the data channel frames in memory; the frames, the end-to-end authentication, the host peer and the client transport are the production code.",
    "The host gateway that makes a host peer for each Signal connection. The check makes the host peer as the gateway does, with a new peer ID for each connection.",
    "The renderer refresh on agent:sync-changed. The WebSocket check (test:remote-sync) records that event.",
  ],
  steps: [],
};

async function step<T>(
  name: string,
  run: () => Promise<T>,
  describe: (value: T) => unknown = (value) => value,
): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: describe(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function eventFrame(data: string | ArrayBuffer): TeamProtocolV2EventFrame | null {
  if (!isString(data)) return null;
  try {
    return decodeTeamProtocolV2EventFrame(data);
  } catch {
    return null;
  }
}

function syncControlType(frame: TeamProtocolV2EventFrame | null): string | null {
  return frame?.type === "event-control" && isSyncClientMessage(frame.control) ? frame.control.type : null;
}

function syncEvent(frame: TeamProtocolV2EventFrame | null): SyncServerMessage | null {
  return frame?.type === "event" ? decodeSyncServerMessage(frame.payload) : null;
}

interface TicketClaims {
  sessionId: string;
  hostId: string;
  userId: string;
  membershipId: string;
  authEpoch: number;
  sessionExpiresAt: number;
  role: "owner";
  clientPublicKey: string;
}

interface LinkCounts {
  dials: number;
  syncControls: Record<string, number>;
  syncEvents: Record<string, number>;
  eventResets: number;
  droppedSyncEvents: number;
}

function linkClosed() {
  return Effect.fail(new RemoteWorkflowError({ cause: new Error("The loopback data channel is closed.") }));
}

class HostLoopbackBridge extends TeamWebRtcBridge {
  constructor(readonly link: LoopbackLink) {
    super();
  }

  override readonly send = (peerId: string, channel: Channel, data: string | ArrayBuffer) =>
    this.link.fromHost(peerId, channel, data);

  override readonly disconnectPeer = (peerId: string) => Effect.sync(() => this.link.hostDisconnect(peerId));
}

class ClientLoopbackBridge extends TeamWebRtcBridge {
  constructor(readonly link: LoopbackLink) {
    super();
  }

  override readonly start = () => Effect.void;

  override readonly prepareSignal = () => Effect.void;

  override readonly connect = (input: { peerId: string; token: string }) =>
    Effect.sync(() => this.link.clientConnect(input.peerId, input.token));

  override readonly disconnect = (hostId: string) => Effect.sync(() => this.link.clientDisconnect(hostId));

  override readonly send = (hostId: string, channel: Channel, data: string | ArrayBuffer) =>
    this.link.fromClient(hostId, channel, data);
}

class LoopbackLink {
  readonly counts: LinkCounts = { dials: 0, syncControls: {}, syncEvents: {}, eventResets: 0, droppedSyncEvents: 0 };
  readonly tickets = new Map<string, TicketClaims>();
  readonly peers = new Map<string, HostPeer>();
  readonly host = new HostLoopbackBridge(this);
  readonly client = new ClientLoopbackBridge(this);
  peerId: string | null = null;
  down = false;
  dropSyncEvent: ((message: SyncServerMessage) => boolean) | null = null;
  #heldDial: string | null = null;

  constructor(
    readonly hostId: string,
    readonly makePeer: (link: LoopbackLink, peerId: string) => HostPeer,
  ) {}

  fromHost(peerId: string, channel: Channel, data: string | ArrayBuffer) {
    if (this.down || peerId !== this.peerId) return linkClosed();
    const frame = channel === "events" ? eventFrame(data) : null;
    const message = syncEvent(frame);
    if (message && this.dropSyncEvent?.(message)) {
      this.dropSyncEvent = null;
      this.counts.droppedSyncEvents += 1;
      return linkClosed();
    }
    if (message) this.counts.syncEvents[message.type] = (this.counts.syncEvents[message.type] ?? 0) + 1;
    if (frame?.type === "event-reset") this.counts.eventResets += 1;
    return Effect.sync(() => queueMicrotask(() => this.client.emit("data", this.hostId, channel, data)));
  }

  fromClient(hostId: string, channel: Channel, data: string | ArrayBuffer) {
    const peerId = this.peerId;
    if (this.down || hostId !== this.hostId || !peerId) return linkClosed();
    const type = channel === "events" ? syncControlType(eventFrame(data)) : null;
    if (type) this.counts.syncControls[type] = (this.counts.syncControls[type] ?? 0) + 1;
    return Effect.sync(() => queueMicrotask(() => this.host.emit("data", peerId, channel, data)));
  }

  hostDisconnect(peerId: string): void {
    if (peerId !== this.peerId) return;
    this.#drop();
  }

  clientConnect(hostId: string, token: string): void {
    if (hostId !== this.hostId) return;
    if (this.down) this.#heldDial = token;
    else queueMicrotask(() => this.#startDial(token));
  }

  clientDisconnect(hostId: string): void {
    if (hostId !== this.hostId) return;
    this.#heldDial = null;
    const peerId = this.peerId;
    this.peerId = null;
    if (peerId) this.#endPeer(peerId);
  }

  #startDial(token: string): void {
    this.#dial(token).catch((error: unknown) =>
      this.client.emit("error", this.hostId, "loopback_dial_failed", String(error), true),
    );
  }

  async #dial(token: string): Promise<void> {
    const claims = this.tickets.get(token);
    if (!claims) {
      this.client.emit("error", this.hostId, "ticket_unknown", "The loopback link has no such ticket.");
      return;
    }
    this.counts.dials += 1;
    const previous = this.peerId;
    if (previous) this.#endPeer(previous);
    const peerId = `client-peer-${this.counts.dials}`;
    const peer = this.makePeer(this, peerId);
    this.peers.set(peerId, peer);
    this.peerId = peerId;
    await Effect.runPromise(
      peer.incoming({
        hostId: this.hostId,
        connectionId: randomUUID(),
        sessionId: claims.sessionId,
        userId: claims.userId,
        membershipId: claims.membershipId,
        role: claims.role,
        sessionExpiresAt: claims.sessionExpiresAt,
      }),
    );
    if (this.peerId !== peerId) return;
    this.host.emit("connected", peerId, HOST_FINGERPRINTS);
    this.client.emit("connected", this.hostId, CLIENT_FINGERPRINTS);
  }

  #endPeer(peerId: string): void {
    this.host.emit("disconnected", peerId);
    const peer = this.peers.get(peerId);
    this.peers.delete(peerId);
    if (peer) void Effect.runPromise(peer.dispose()).catch(() => undefined);
  }

  cut(): void {
    this.down = true;
    this.#drop();
  }

  #drop(): void {
    const peerId = this.peerId;
    this.peerId = null;
    if (peerId) this.#endPeer(peerId);
    this.client.emit("disconnected", this.hostId);
  }

  restore(): void {
    this.down = false;
    const held = this.#heldDial;
    this.#heldDial = null;
    if (held) this.#startDial(held);
  }

  async close(): Promise<void> {
    this.down = true;
    const peers = [...this.peers.values()];
    this.peers.clear();
    await Promise.all(peers.map((peer) => Effect.runPromise(peer.dispose()).catch(() => undefined)));
  }
}

function recordSync(manager: Manager): SyncServerMessage[] {
  const received: SyncServerMessage[] = [];
  const receive = manager.sync.receive.bind(manager.sync);
  manager.sync.receive = (serverId, message) => {
    received.push(message);
    receive(serverId, message);
  };
  return received;
}

const openWaits = new Set<() => void>();

function until<T>(manager: Manager, read: () => T | null | undefined): Promise<T> {
  return new Promise((resolveValue) => {
    const stop = () => {
      manager.off("changed", check);
      manager.off("syncChanged", check);
      clearInterval(poll);
      openWaits.delete(stop);
    };
    const check = () => {
      const value = read();
      if (value === null || value === undefined) return;
      stop();
      resolveValue(value);
    };
    manager.on("changed", check);
    manager.on("syncChanged", check);
    const poll = setInterval(check, 25);
    openWaits.add(stop);
    check();
  });
}

function ids(channels: readonly ChannelSummary[]): string[] {
  return channels.map((channel) => channel.id).sort();
}

function channelUpserts(messages: readonly SyncServerMessage[]): { keys: string[]; deletes: string[] } {
  const changes = messages.flatMap((message) =>
    message.type === "sync-changes" && message.collection === CHANNELS ? [message] : [],
  );
  return {
    keys: changes.flatMap((message) => message.upserts.map((upsert) => upsert.key)).sort(),
    deletes: changes.flatMap((message) => message.deletes),
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-remote-sync-webrtc-"));
const userData = join(root, "user-data");
const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  answerPermission: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  answerViewDialog: unused,
  importSignIn: unused,
  answerHttpSignIn: unused,
};
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};
const centralAccount = { createTeamAuthTicket: unused, getEmail: () => "e2e@example.invalid" };

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
let manager: Manager | undefined;
let link: LoopbackLink | undefined;
let agents: AgentService | undefined;
let server: InstanceType<typeof TeamApiServer> | undefined;

try {
  const setup = await step(
    "Start a host with one channel, and join it over the webrtc-v2 transport",
    async () => {
      await runCauseEffect(sidebar.initialize());
      await runCauseEffect(agentStore.initialize());
      await runCauseEffect(mailbox.initialize());
      await runCauseEffect(team.initialize());
      const agent = await runCauseEffect(
        agentStore.createAgent({
          name: "WebRTC sync fixture",
          description: "Synthetic agent for the WebRTC sync check",
          avatarSeed: "remote-sync-webrtc",
          avatarHue: null,
        }),
      );
      const service = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
      agents = service;
      await runCauseEffect(team.configure("E2E WebRTC Host", OWNER.username, OWNER.password));
      const ownerId = team.getOwnerMemberId();
      const identity = team.getIdentity();
      assert.ok(ownerId && identity, "The host has no owner or identity.");
      const actor = { id: ownerId, name: "Owner" };
      const createChannel = async (name: string, channelId: string = randomUUID()) =>
        (
          await runCauseEffect(
            service.channels.command(
              {
                type: "save",
                operationId: randomUUID(),
                channelId,
                draft: { name, title: "", instructions: "", members: [{ agentId: agent.id }], leadAgentId: agent.id },
              },
              actor,
            ),
          )
        ).id;
      const first = await createChannel("First room");
      server = new TeamApiServer({
        store: team,
        agents: service,
        agentTasks: service,
        mailbox,
        browser: teamBrowser,
        sidebarLayout: sidebar,
        appVersion: APP_VERSION,
        channels: service.channels,
      });
      const hostPort = await Effect.runPromise(server.start());
      const serverId = identity.serverId;
      const loopback = new LoopbackLink(serverId, (owner, peerId) => {
        return new TeamWebRtcHostPeer(
          {
            bridge: owner.host,
            store: team,
            appVersion: APP_VERSION,
            transferDirectory: join(root, "host-transfers"),
            verifyClientTicket: (ticket) => {
              const claims = owner.tickets.get(ticket);
              return claims
                ? Effect.succeed(claims)
                : Effect.fail(new RemoteWorkflowError({ cause: new Error("Unknown ticket.") }));
            },
          },
          { peerId, hostId: serverId, localApiPort: hostPort },
        );
      });
      link = loopback;
      const accountUserId = `account-${ownerId}`;
      const transport = new TeamWebRtcClientTransport({
        bridge: loopback.client,
        listHosts: () =>
          Effect.succeed([
            {
              hostId: serverId,
              name: identity.serverName,
              logoKey: null,
              devicePublicKey: identity.publicKey,
              keyHandovers: [],
              authEpoch: 1,
              membershipId: ownerId,
              role: "owner" as const,
            },
          ]),
        startSession: (hostId) =>
          Effect.succeed({ sessionId: randomUUID(), hostId, expiresAt: Date.now() + 3_600_000 }),
        issueTicket: (sessionId, clientPublicKey) =>
          Effect.sync(() => {
            const ticket = `ticket-${randomUUID()}`;
            loopback.tickets.set(ticket, {
              sessionId,
              hostId: serverId,
              userId: accountUserId,
              membershipId: ownerId,
              authEpoch: 1,
              sessionExpiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              role: "owner",
              clientPublicKey,
            });
            return { ticket, expiresAt: Date.now() + 60_000, signalUrl: "wss://signal.invalid/v1/connect" };
          }),
        endSession: () => Effect.void,
        createInvite: unused,
        listInvites: unused,
        previewInvite: unused,
        acceptInvite: unused,
        revokeInvite: unused,
        listMembers: unused,
        updateMember: unused,
        removeMember: unused,
        removeOwnedHost: unused,
        setHostHidden: unused,
        getPrincipalId: () => accountUserId,
        controlPlaneUrl: "https://account.invalid/",
        downloadHostLogo: unused,
        transferDirectory: join(root, "client-transfers"),
      });
      const target = new RemoteServerManager(join(userData, "remote-servers.json"), cipher, centralAccount, {
        appVersion: APP_VERSION,
        webrtcTransport: transport,
        getLocalHostId: () => null,
      });
      manager = target;
      const received = recordSync(target);
      let eventResets = 0;
      transport.on("eventReset", () => {
        eventResets += 1;
      });
      await runCauseEffect(target.initialize());
      await runCauseEffect(target.awaitHostDirectory());
      const record = target.list().find((summary) => summary.id === serverId);
      assert.ok(record, "The host directory did not add the server.");
      await runCauseEffect(target.select(serverId));
      await runCauseEffect(target.startEventConnections());
      await until(target, () => (transport.isConnected(serverId) ? true : null));
      const joined = target.list().find((summary) => summary.id === serverId);
      assert.equal(joined?.apiUrl, null, "The server record is not a webrtc-v2 record.");
      return {
        manager: target,
        loopback,
        transport,
        received,
        resets: () => eventResets,
        serverId,
        hostPort,
        first,
        createChannel,
        agentId: agent.id,
      };
    },
    ({ serverId, hostPort, first, loopback }) => ({
      serverId,
      hostPort,
      firstChannel: first,
      dials: loopback.counts.dials,
    }),
  );
  const {
    manager: client,
    loopback,
    transport,
    received,
    resets,
    serverId,
    hostPort,
    first,
    createChannel,
    agentId,
  } = setup;
  const listCalls = () => httpCallCount(hostPort, "GET", CHANNEL_ROUTES.list);
  const hostList = () => runCauseEffect(client.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries));

  await step("A thread rename reaches the remote event stream and both host title records", async () => {
    const threads = new AgentThreadStore(database);
    const thread = threads.create({ agentId, title: "Original", origin: "user", titleSource: "auto" });
    const rows = database.connection.prepare(`
      SELECT a.title AS taskTitle, t.title AS threadTitle, a.last_event_sequence AS taskSequence,
             t.last_event_sequence AS threadSequence FROM projection_agent_threads a
      JOIN projection_threads t USING (thread_id) WHERE thread_id = ?
    `);
    const readTitle = (title: string) => {
      const row = rows.get(thread.threadId);
      assert.equal(row?.taskTitle, title);
      assert.equal(row?.threadTitle, title);
      assert.equal(row?.threadSequence, row?.taskSequence);
      return row?.threadSequence;
    };
    threads.retitle(thread.threadId, "Automatic");
    const automatic = readTitle("Automatic");
    let receivedTitle: string | undefined;
    client.on("agent", (from, event) => {
      if (from === serverId && event.type === "agent-tasks-changed" && event.snapshot.agentId === agentId)
        receivedTitle = event.snapshot.tasks.find((task) => task.id === thread.taskId)?.title;
    });
    const title = "Manual title";
    const writer = await runCauseEffect(team.login(OWNER.username, OWNER.password));
    const response = await fetch(`http://127.0.0.1:${hostPort}${AGENT_THREADS_ROUTES.rename}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${writer.sessionToken}`,
        "Content-Type": "application/json",
        [TEAM_APP_VERSION_HEADER]: APP_VERSION,
        [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
        [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
      },
      body: JSON.stringify({ agentId, taskId: thread.taskId, title }),
    });
    assert.equal(response.status, 200);
    await until(client, () => (receivedTitle === title ? true : null));
    const manual = readTitle(title);
    assert.ok(Number(manual) > Number(automatic));
    threads.retitle(thread.threadId, "Later automatic title");
    assert.equal(readTitle(title), manual);
    return { receivedTitle, manual, automatic };
  });

  await step("The first sync arrives as WebRTC event frames, and a read makes no HTTP list call", async () => {
    const synced = await until(client, () => client.sync.channels.values(serverId));
    assert.deepEqual(ids(synced), [first], "The first sync does not hold the host channel.");
    assert.ok((loopback.counts.syncControls["sync-subscribe"] ?? 0) > 0, "No sync-subscribe went as event-control.");
    assert.ok((loopback.counts.syncEvents["sync-changes"] ?? 0) > 0, "No sync-changes came as an event frame.");
    const before = listCalls();
    const read = await runCauseEffect(
      syncedOrRequest(client.sync.channels.values(serverId), () =>
        client.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries),
      ),
    );
    assert.equal(listCalls(), before, "A read after the first sync made an HTTP list call.");
    const host = await hostList();
    assert.deepEqual(ids(read), ids(host), "The synced copy differs from the host list over WebRTC rpc.");
    return {
      channels: synced.length,
      syncControls: { ...loopback.counts.syncControls },
      syncEvents: { ...loopback.counts.syncEvents },
    };
  });

  await step("A channel change on the host reaches the client over the events channel", async () => {
    const before = listCalls();
    const second = await createChannel("Second room");
    const synced = await until(client, () => {
      const values = client.sync.channels.values(serverId);
      return values?.some((channel) => channel.id === second) ? values : null;
    });
    assert.deepEqual(ids(synced), [first, second].sort());
    assert.equal(listCalls(), before, "The change made an HTTP list call.");
    return { channels: synced.length, httpListCalls: listCalls() - before };
  });

  await step(
    "The data channel drops, then connects again: the client resubscribes and gets only the diff",
    async () => {
      const dialsBefore = loopback.counts.dials;
      loopback.cut();
      await until(client, () => (client.sync.channels.values(serverId) === null ? true : null));
      const third = await createChannel("Third room");
      const before = listCalls();
      received.length = 0;
      loopback.restore();
      await runCauseEffect(client.wake());
      const synced = await until(client, () => {
        const values = client.sync.channels.values(serverId);
        return values?.some((channel) => channel.id === third) ? values : null;
      });
      assert.equal(synced.length, 3);
      assert.ok(loopback.counts.dials > dialsBefore, "The client did not connect again.");
      const diff = channelUpserts(received);
      assert.deepEqual(diff.keys, [third], "The resubscribe did not send only the new channel.");
      assert.deepEqual(diff.deletes, []);
      assert.equal(listCalls(), before, "The reconnect made an HTTP list call.");
      return {
        channels: synced.length,
        upserts: diff.keys.length,
        deletes: diff.deletes.length,
        dials: loopback.counts.dials,
      };
    },
  );

  await step("A lost sync event frame causes event-reset, and the resubscribe delivers the lost change", async () => {
    let taskListsInvalidated = false;
    client.on("syncChanged", (from, name) => {
      if (from === serverId && name === "agent-tasks") taskListsInvalidated = true;
    });
    const resetsBefore = resets();
    const framesBefore = loopback.counts.eventResets;
    received.length = 0;
    let receivedAtReset: number | null = null;
    transport.once("eventReset", () => {
      receivedAtReset = received.length;
    });
    const lost = randomUUID();
    loopback.dropSyncEvent = (message) =>
      message.type === "sync-changes" &&
      message.collection === CHANNELS &&
      message.upserts.some((upsert) => upsert.key === lost);
    await createChannel("Lost room", lost);
    await until(client, () => (loopback.counts.droppedSyncEvents > 0 ? true : null));
    const after = await createChannel("After reset room");
    const synced = await until(client, () => {
      const values = client.sync.channels.values(serverId);
      return values?.some((channel) => channel.id === lost) && values.some((channel) => channel.id === after)
        ? values
        : null;
    });
    assert.ok(loopback.counts.eventResets > framesBefore, "The host did not send event-reset.");
    assert.ok(resets() > resetsBefore, "The client transport did not report event-reset.");
    assert.ok(taskListsInvalidated, "The reset did not invalidate the cached thread lists.");
    assert.ok(receivedAtReset !== null, "The client got no event-reset.");
    assert.ok(
      channelUpserts(received.slice(receivedAtReset)).keys.includes(lost),
      "No sync message after the reset holds the lost channel.",
    );
    assert.deepEqual(ids(synced), ids(await hostList()), "The synced copy differs from the host list after the reset.");
    return {
      channels: synced.length,
      droppedSyncEvents: loopback.counts.droppedSyncEvents,
      eventResetFrames: loopback.counts.eventResets - framesBefore,
      clientResets: resets() - resetsBefore,
    };
  });

  const hostService = agents;
  assert.ok(hostService, "The host has no agent service.");
  const baseTime = Date.now();
  let messageClock = 0;
  const conversationMessage = (id: string, author: "user" | "assistant", text: string): ConversationMessage => {
    messageClock += 1;
    return {
      id,
      author,
      text,
      createdAt: new Date(baseTime + messageClock * 1000).toISOString(),
      status: "completed",
      reactions: [],
      reaction: null,
    };
  };
  const writeAgentMessages = (changedMessages: ConversationMessage[]) => {
    const threadId = agentStore.ensureThreadIdNow(agentId);
    database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: null,
      changedMessages,
      eventType: "conversation.remote-sync-webrtc-e2e",
    });
    hostService.emit("event", {
      type: "conversation-invalidated",
      agentId,
      revision: database.readConversationRevision(agentId, threadId),
    });
  };
  const logName = syncName(AGENT_MESSAGES_SYNC_LOG.name, agentId);
  const pagePath = TEAM_API_ROUTES.agent.conversationPage(agentId);
  const pageCalls = () => httpCallCount(hostPort, "GET", pagePath);
  const synced = () => client.sync.latestConversationPage(serverId, agentId);
  const overRpc = () =>
    runCauseEffect(
      client.readAgentConversationPage(agentId, { type: "latest" }, REMOTE_SYNC_CONVERSATION_ROWS, serverId),
    );
  const syncedEqualsHost = async (): Promise<ConversationPage> => {
    const expected = await overRpc();
    return until(client, () => {
      const value = synced();
      return value !== null && isDeepStrictEqual(value, expected) ? value : null;
    });
  };

  await step(
    "agent-messages.v1 over WebRTC: the log opens, and a new message arrives with no HTTP page call",
    async () => {
      writeAgentMessages([conversationMessage("webrtc-u1", "user", "WebRTC question.")]);
      const before = pageCalls();
      await overRpc();
      assert.ok(pageCalls() - before >= 1, "The first page read did not reach the host.");
      await until(client, () => synced());
      assert.ok(
        (loopback.counts.syncControls["sync-log-subscribe"] ?? 0) > 0,
        "No sync-log-subscribe went as event-control.",
      );
      await syncedEqualsHost();
      const callsBefore = pageCalls();
      writeAgentMessages([conversationMessage("webrtc-a1", "assistant", "WebRTC answer.")]);
      const page = await until(client, () => {
        const value = synced();
        return value?.messages.some((message) => message.id === "webrtc-a1") ? value : null;
      });
      assert.equal(pageCalls(), callsBefore, "The new message made an HTTP page call.");
      assert.ok(
        (loopback.counts.syncEvents["sync-log-changes"] ?? 0) > 0,
        "No sync-log-changes came as an event frame.",
      );
      return { messages: page.messages.length, httpPageCalls: pageCalls() - callsBefore };
    },
  );

  await step("agent-messages.v1 over WebRTC: after a drop and a reconnect, the client gets only the diff", async () => {
    loopback.cut();
    await until(client, () => (synced() === null ? true : null));
    const offline = conversationMessage("webrtc-offline", "assistant", "Written while the data channel was down.");
    writeAgentMessages([offline]);
    received.length = 0;
    loopback.restore();
    await runCauseEffect(client.wake());
    const page = await until(client, () => {
      const value = synced();
      return value?.messages.some((message) => message.id === offline.id) ? value : null;
    });
    const changes = received.flatMap((message) =>
      message.type === "sync-log-changes" && message.log === logName ? [message] : [],
    );
    const rows = [...new Set(changes.flatMap((change) => change.rows.map((row) => row.key)))];
    assert.equal(changes.filter((change) => change.reset).length, 0, "The agent log was reset on reconnect.");
    assert.deepEqual(rows, [offline.id], "The agent log did not send only the new message.");
    await syncedEqualsHost();
    return { messages: page.messages.length, logChanges: changes.length, rows };
  });

  report.passed = true;
} finally {
  for (const stop of [...openWaits]) stop();
  globalThis.fetch = realFetch;
  if (manager) await runCauseEffect(manager.stop()).catch(() => undefined);
  if (link) await link.close();
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
