import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AgentApproval,
  AgentRuntimePrompt,
  AgentRuntimeSnapshot,
  ConversationMessageSender,
  ConversationPage,
  ConversationReadState,
  QueuedMessageReceipt,
  RespondToApprovalInput,
  RespondToPromptInput,
  SendMessageInput,
  TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  openWatchReply,
  sealWatchRequest,
  WATCH_RELAY_REPLY_SEALED_LIMIT,
  WATCH_TICKET_AUDIENCE,
  type WatchRelayRequest,
  watchProofMessage,
  watchSealedDigest,
} from "@openbot/contracts/signal-protocol/watch-relay";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { encodeTeamCapabilitiesV10, TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_ABSENT_CAPABILITIES_HEADER, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import {
  decodeWatchRelaySetup,
  WATCH_RELAY_ROUTES,
  WATCH_RELAY_TEAM_CAPABILITY,
} from "@openbot/contracts/team-protocol/watch-relay-v1";
import type { WatchCommand, WatchResult, WatchSnapshot } from "@openbot/contracts/watch-protocol";
import { plugin } from "bun";
import { Effect } from "effect";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { ApprovalResponder, PromptResponder } from "../src/backend/agent/attention-registry";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { SidebarPinStore } from "../src/main/sidebar-pin-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/watch-relay-host-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const AUTH_URL = "https://auth.watch-e2e.invalid";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const WATCHER = { username: "watcher", password: "watcher-password-123" };
const EPOCH = 3;
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

plugin({
  name: "watch-relay-electron-boundary",
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
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { CentralAuthManager } = await import("../src/main/central-auth-manager");
const { WatchRelayService } = await import("../src/main/watch-relay-service");
const { WatchRelayCommands } = await import("../src/main/watch-relay-commands");
const { createWatchRelayWantedStore, loadWatchRelayKey } = await import("../src/main/watch-relay-key");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The Signal ingress socket. The check calls the host's watch-delivery handler directly; Signal is not started.",
    "The account service. The check signs watch tickets with its own ES256 key and serves that key set to CentralAuth.",
    "Provider turns. The agent service is real, but approvals, questions, sends and stops go to recorded stand-ins.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>, summarize: (value: T) => unknown = (value) => value) {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const base64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(bytes)).toString("base64url");

const root = await mkdtemp(join(tmpdir(), "openbot-watch-relay-"));
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
  importSignIn: unused,
  answerPermission: unused,
  answerHttpSignIn: unused,
  answerViewDialog: unused,
};

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const sidebarPins = new SidebarPinStore(join(userData, "sidebar-pins.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};
const keyPath = join(userData, "watch-relay-key.json");
const wantedPath = join(userData, "watch-relay.json");
let holders = 0;
let service: AgentService | undefined;
let server: InstanceType<typeof TeamApiServer> | undefined;
let relay: InstanceType<typeof WatchRelayService> | undefined;
let commands: InstanceType<typeof WatchRelayCommands> | null = null;
let channels: ChannelService | null = null;
const CHANNEL_NAME = "Launch room";

interface Recorded {
  approvals: { requestId: string | number; decision: string; owner: boolean | null }[];
  prompts: { requestId: string | number; answers: Record<string, string[]>; sender: string | null }[];
  sends: { text: string; clientMessageId: string | null; sender: string | null }[];
  interrupts: { agentId: string; turnId: string }[];
  reads: { agentId: string; memberId: string; throughMessageId: string | null }[];
}

const recorded: Recorded = { approvals: [], prompts: [], sends: [], interrupts: [], reads: [] };
const pendingApprovals: AgentApproval[] = [];
const pendingPrompts: AgentRuntimePrompt[] = [];
const unread = new Map<string, number>();
const working = new Map<string, { threadId: string; turnId: string }>();
const LONG_REPLY = Array.from({ length: 24 }, (_, index) => `Sentence ${index + 1} of a long agent reply.`).join(" ");
const latestMessages: AgentRuntimeSnapshot["latestMessages"] = [];
const DISABLED_MEMBER = "disabled-member";
const disabledMember = (): TeamMemberSummary => ({
  id: DISABLED_MEMBER,
  username: "disabled",
  email: null,
  name: null,
  role: "member",
  createdAt: new Date(0).toISOString(),
  disabled: true,
});
const sameRequest = (left: string | number, right: string | number) => String(left) === String(right);

class WatchFixtureAgents extends AgentService {
  override getRuntimeSnapshot(): AgentRuntimeSnapshot {
    return {
      ...super.getRuntimeSnapshot(),
      activeTurns: [...working].map(([agentId, turn]) => ({ agentId, ...turn })),
      latestMessages: latestMessages.map((message) => ({ ...message, text: message.text.slice(0, 240) })),
      pendingApprovals: pendingApprovals.map((approval) => {
        const truncated = (approval.command?.length ?? 0) > 1_000;
        return {
          ...approval,
          command: truncated ? (approval.command?.slice(0, 1_000) ?? null) : approval.command,
          truncated,
        };
      }),
      pendingPrompts: [...pendingPrompts],
    };
  }

  override pendingApproval(requestId: string | number): AgentApproval | undefined {
    return pendingApprovals.find((item) => sameRequest(item.requestId, requestId));
  }

  override pendingPrompts(): AgentRuntimePrompt[] {
    return [...pendingPrompts];
  }

  override agentIdForRequest(requestId: string | number): string | undefined {
    return [...pendingApprovals, ...pendingPrompts].find((item) => sameRequest(item.requestId, requestId))?.agentId;
  }

  override respondToApproval(input: RespondToApprovalInput, responder?: ApprovalResponder) {
    return Effect.sync(() => {
      recorded.approvals.push({
        requestId: input.requestId,
        decision: input.decision,
        owner: responder?.owner ?? null,
      });
      const index = pendingApprovals.findIndex((item) => sameRequest(item.requestId, input.requestId));
      if (index >= 0) pendingApprovals.splice(index, 1);
    });
  }

  override respondToPrompt(input: RespondToPromptInput, responder?: PromptResponder) {
    return Effect.sync(() => {
      recorded.prompts.push({
        requestId: input.requestId,
        answers: input.answers,
        sender: responder?.sender?.id ?? null,
      });
      const index = pendingPrompts.findIndex((item) => sameRequest(item.requestId, input.requestId));
      if (index >= 0) pendingPrompts.splice(index, 1);
    });
  }

  override readonly sendMessage = (input: SendMessageInput, sender?: ConversationMessageSender) =>
    Effect.sync((): QueuedMessageReceipt => {
      recorded.sends.push({
        text: input.text,
        clientMessageId: input.clientMessageId ?? null,
        sender: sender?.id ?? null,
      });
      return { messageId: input.clientMessageId ?? randomUUID(), deliveries: [] };
    });

  override interrupt(agentId: string, turnId: string) {
    return Effect.sync(() => {
      recorded.interrupts.push({ agentId, turnId });
      working.delete(agentId);
    });
  }

  override listConversationReads(): Record<string, ConversationReadState> {
    return Object.fromEntries(
      [...unread].map(([agentId, unreadCount]): [string, ConversationReadState] => [
        agentId,
        { unreadCount, firstUnreadMessageId: null, throughMessageId: null },
      ]),
    );
  }

  override readConversationPageFor(agentId: string) {
    return Effect.succeed<ConversationPage>({
      agentId,
      threadId: `thread-${agentId}`,
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "reply-long",
          author: "assistant",
          text: LONG_REPLY,
          createdAt: "2026-11-26T09:59:00.000Z",
          status: "completed",
        },
        {
          id: "reply-1",
          author: "assistant",
          text: "Done.",
          createdAt: "2026-11-26T10:00:00.000Z",
          status: "completed",
        },
        {
          id: "question-2",
          author: "user",
          text: "Thanks",
          createdAt: "2026-11-26T10:01:00.000Z",
          status: "completed",
        },
      ],
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    });
  }

  override markConversationRead(agentId: string, memberId: string, throughMessageId: string | null) {
    return Effect.sync((): ConversationReadState => {
      recorded.reads.push({ agentId, memberId, throughMessageId });
      unread.delete(agentId);
      return { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null };
    });
  }
}

try {
  const setup = await step(
    "Start the host Team API with the watch relay",
    async () => {
      await runCauseEffect(sidebar.initialize());
      await runCauseEffect(agentStore.initialize());
      await runCauseEffect(mailbox.initialize());
      await runCauseEffect(team.initialize());
      const create = (name: string) =>
        runCauseEffect(
          agentStore.createAgent({
            name,
            description: "Watch relay fixture",
            avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
            avatarHue: null,
          }),
        );
      const approver = await create("Approver");
      const longAsker = await create("Long approver");
      const asker = await create("Asker");
      const worker = await create("Worker");
      service = new WatchFixtureAgents({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
      const real = service;
      await runCauseEffect(
        real.setAvatar(approver.id, { mimeType: "image/png", bytes: Buffer.from(PNG_BASE64, "base64") }),
      );
      await runCauseEffect(team.configure("Watch E2E Host", OWNER.username, OWNER.password));
      const invite = await runCauseEffect(team.createInvite("member"));
      const watcher = await runCauseEffect(team.acceptInvite(invite.token, WATCHER.username, WATCHER.password));
      const hostId = team.getIdentity()?.serverId;
      assert.ok(hostId, "The host has no identity.");
      const ownerId = team.getOwnerMemberId();
      assert.ok(ownerId, "The host has no owner.");
      channels = new ChannelService(database, mailbox, new ChannelImages(join(root, "channel-images")), {
        agents: () => real.listAgents(),
        generate: () => Effect.die(new Error("No routing runs in this check.")),
        schedule: () => {},
        interrupt: () => Effect.void,
        busy: () => false,
        changed: () => {},
        error: () => {},
      });
      const channelId = randomUUID();
      const owner = { id: ownerId, name: "Owner" };
      await runCauseEffect(
        sidebarPins.set(watcher.member.id, [
          { kind: "channel", id: channelId },
          { kind: "agent", id: approver.id },
        ]),
      );
      await runCauseEffect(
        channels.command(
          {
            type: "save",
            operationId: randomUUID(),
            channelId,
            draft: {
              name: CHANNEL_NAME,
              title: "Ship the release",
              instructions: "",
              members: [{ agentId: approver.id }, { agentId: asker.id }],
              leadAgentId: approver.id,
            },
          },
          owner,
        ),
      );
      await runCauseEffect(
        channels.command(
          {
            type: "send",
            operationId: randomUUID(),
            channelId,
            text: "Check the release notes, please.",
            recipientAgentId: approver.id,
            replyToMessageId: null,
            attachmentDraftIds: [],
          },
          owner,
        ),
      );

      const threadOf = (agentId: string) =>
        real.listAgents().find((agent) => agent.id === agentId)?.threadId ?? agentId;
      pendingApprovals.push(
        {
          requestId: "approval-short",
          agentId: approver.id,
          threadId: threadOf(approver.id),
          turnId: "turn-approver",
          kind: "command",
          command: "/bin/zsh -lc 'git status'",
          cwd: "/Users/someone/project",
          reason: null,
          grantRoot: null,
          permissions: null,
        },
        {
          requestId: "approval-long",
          agentId: longAsker.id,
          threadId: threadOf(longAsker.id),
          turnId: "turn-long",
          kind: "command",
          command: `echo ${"x".repeat(2_000)}`,
          cwd: null,
          reason: null,
          grantRoot: null,
          permissions: null,
        },
      );
      pendingPrompts.push({
        requestId: "prompt-one",
        agentId: asker.id,
        threadId: threadOf(asker.id),
        turnId: "turn-asker",
        questions: [
          {
            id: "color",
            header: "Color",
            question: "Which color?",
            isSecret: false,
            options: [
              { label: "Red", description: "" },
              { label: "Blue", description: "" },
            ],
            multiSelect: false,
          },
        ],
      });
      working.set(worker.id, { threadId: threadOf(worker.id), turnId: "turn-worker" });
      latestMessages.push({
        agentId: asker.id,
        id: "reply-long",
        text: LONG_REPLY,
        createdAt: "2026-11-26T09:59:00.000Z",
      });
      unread.set(approver.id, 2);

      const signing = await generateKeyPair("ES256", { extractable: true });
      const jwk = { ...(await exportJWK(signing.publicKey)), kid: "watch-e2e", alg: "ES256" };
      const centralAuth = new CentralAuthManager({
        apiUrl: AUTH_URL,
        storagePath: join(root, "session.bin"),
        encrypt: (value) => Buffer.from(value),
        decrypt: (value) => value.toString(),
        fetch: async (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/.well-known/jwks.json") return Response.json({ keys: [jwk] });
          return new Response("{}", { status: 404 });
        },
      });

      relay = new WatchRelayService({
        hostId: () => team.getIdentity()?.serverId ?? null,
        key: loadWatchRelayKey(keyPath, cipher),
        wanted: createWatchRelayWantedStore(wantedPath),
        ingress: {
          acquireWatchRelay: () => {
            holders += 1;
            let released = false;
            return () => {
              if (released) return;
              released = true;
              holders -= 1;
            };
          },
          authEpoch: () => EPOCH,
        },
        verifyTicket: (ticket) => centralAuth.verifyWatchTicket(ticket),
        member: (membershipId) => (membershipId === DISABLED_MEMBER ? disabledMember() : team.getMember(membershipId)),
        commands: () => commands,
      });
      server = new TeamApiServer({
        store: team,
        agents: real,
        mailbox,
        browser: teamBrowser,
        sidebarLayout: sidebar,
        appVersion: APP_VERSION,
        watchRelay: relay,
        channels,
        sidebarPins,
      });
      const port = await Effect.runPromise(server.start());
      await Effect.runPromise(relay.start());
      commands = new WatchRelayCommands(server.watchTeamApi());
      return {
        port,
        hostId,
        signing,
        watcher: { id: watcher.member.id, token: watcher.sessionToken },
        agents: { approver: approver.id, longAsker: longAsker.id, asker: asker.id, worker: worker.id },
        channelId,
      };
    },
    (value) => ({ port: value.port, hostId: value.hostId }),
  );
  const { port, hostId, signing, watcher, agents, channelId } = setup;
  const forwarded = encodeTeamCapabilitiesV10([...TEAM_CURRENT_CAPABILITIES]);

  async function wire(path: string, token?: string): Promise<{ status: number; body: unknown }> {
    const headers = new Headers({
      Accept: "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
      [TEAM_APP_VERSION_HEADER]: APP_VERSION,
      [TEAM_CAPABILITIES_HEADER]: forwarded.capabilities.join(","),
      [TEAM_ABSENT_CAPABILITIES_HEADER]: forwarded.absent.join(","),
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const watchKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const clientPublicKey = base64url(await crypto.subtle.exportKey("raw", watchKeys.publicKey));
  const watchSessionId = `watch-session-${randomUUID()}`;

  function ticket(
    overrides: Partial<{ hostId: string; authEpoch: number; membershipId: string }> = {},
    audience: string = WATCH_TICKET_AUDIENCE,
  ) {
    return new SignJWT({
      watchSessionId,
      hostId,
      userId: "watch-user",
      membershipId: watcher.id,
      role: "member",
      authEpoch: EPOCH,
      clientPublicKey,
      ...overrides,
    })
      .setProtectedHeader({ alg: "ES256", kid: "watch-e2e" })
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("10m")
      .setJti(`jti-${randomUUID()}`)
      .sign(signing.privateKey);
  }

  const watchKey = await step("The host makes, encrypts and keeps one watch key", async () => {
    assert.ok(relay);
    assert.equal(holders, 0, "The ingress socket was held before any watch setup.");
    const direct = await Effect.runPromise(relay.setup());
    assert.ok(direct, "The host gave no watch setup.");
    assert.equal(direct.hostId, hostId);
    assert.equal(holders, 1, "The setup did not keep the ingress socket open.");
    const wanted = JSON.parse(readFileSync(wantedPath, "utf8"));
    assert.ok(wanted.wantedUntil > Date.now() + 29 * 24 * 60 * 60_000, "The wanted time is not 30 days ahead.");
    const file = readFileSync(keyPath, "utf8");
    const saved = JSON.parse(file);
    assert.equal(saved.publicKey, direct.watchKey);
    const privateKey = cipher.decrypt(Buffer.from(saved.privateKey, "base64"));
    assert.ok(privateKey.length > 100 && !file.includes(privateKey), "The private watch key is not encrypted.");
    const again = await Effect.runPromise(loadWatchRelayKey(keyPath, cipher));
    assert.equal(again?.publicKey, direct.watchKey, "The watch key changed after a reload.");
    return direct.watchKey;
  });

  await step("A member reads the watch setup through the Team API", async () => {
    const compatibility = await wire(TEAM_API_ROUTES.compatibility);
    assert.ok(isDynamicRecord(compatibility.body) && Array.isArray(compatibility.body.capabilities));
    assert.ok(compatibility.body.capabilities.includes(WATCH_RELAY_TEAM_CAPABILITY), "The capability is missing.");
    const anonymous = await wire(WATCH_RELAY_ROUTES.setup);
    assert.equal(anonymous.status, 401, "The setup answered without a session.");
    const answered = await wire(WATCH_RELAY_ROUTES.setup, watcher.token);
    assert.equal(answered.status, 200, `Setup failed: ${JSON.stringify(answered.body)}`);
    const setupBody = decodeWatchRelaySetup(answered.body);
    assert.deepEqual(setupBody, { hostId, watchKey });
    assert.equal(holders, 1, "A second setup took the ingress socket again.");
    return setupBody;
  }).catch(() => null);

  async function delivery(
    command: WatchCommand,
    options: {
      ticket?: string;
      ts?: number;
      id?: string;
      proofHost?: string;
      sealHost?: string;
      sealJti?: string;
    } = {},
  ) {
    const signed = options.ticket ?? (await ticket());
    const jti = String(JSON.parse(Buffer.from(signed.split(".")[1] ?? "", "base64url").toString()).jti);
    const ts = options.ts ?? Date.now();
    const request: WatchRelayRequest = {
      id: options.id ?? `req-${randomUUID()}`,
      ts,
      responseKey: base64url(randomBytes(32)),
      command,
    };
    const sealed = await sealWatchRequest(watchKey, options.sealHost ?? hostId, options.sealJti ?? jti, request);
    const message = watchProofMessage(options.proofHost ?? hostId, jti, await watchSealedDigest(sealed), ts);
    const proof = base64url(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        watchKeys.privateKey,
        new TextEncoder().encode(message),
      ),
    );
    return { delivery: { ticket: signed, ts, proof, sealed }, request };
  }

  async function send(command: WatchCommand): Promise<{ result: WatchResult; snapshot: WatchSnapshot | null }> {
    assert.ok(relay);
    const built = await delivery(command);
    const answer = await Effect.runPromise(relay.deliver(built.delivery));
    assert.equal(answer.status, 200, `The host answered ${answer.status}.`);
    assert.ok(answer.sealed && answer.sealed.length <= WATCH_RELAY_REPLY_SEALED_LIMIT, "The reply is too large.");
    const result: WatchResult = JSON.parse(
      await openWatchReply(built.request.responseKey, built.request.id, answer.sealed),
    );
    const snapshot: WatchSnapshot | null = result.snapshot ? JSON.parse(result.snapshot) : null;
    return { result, snapshot };
  }

  const ready = (snapshot: WatchSnapshot | null) => {
    assert.ok(snapshot && snapshot.state === "ready", "The reply has no ready snapshot.");
    return snapshot;
  };

  const firstSnapshot = await step(
    "Refresh returns this host's snapshot in German",
    async () => {
      const { result, snapshot } = await send({ type: "refresh", language: "de-CH" });
      assert.equal(result.ok, true);
      const shown = ready(snapshot);
      assert.deepEqual(shown.servers, [{ id: hostId, name: "Watch E2E Host", online: true, watchKey }]);
      assert.equal(shown.language, "de");
      assert.equal(shown.text["mobile.chat.approval.allow"], "Erlauben", "The text is not localized.");
      const byId = new Map(shown.agents.map((agent) => [agent.id, agent]));
      const approver = byId.get(agents.approver);
      assert.equal(approver?.state, "waiting");
      assert.equal(approver?.wait?.kind, "approval");
      assert.ok(approver?.wait?.kind === "approval" && approver.wait.whole && approver.wait.body === "git status");
      assert.equal(approver?.wait?.kind === "approval" ? approver.wait.where : null, "~/project");
      assert.equal(approver?.unread, 2);
      assert.ok(approver?.avatar, "The agent picture has no name.");
      const long = byId.get(agents.longAsker)?.wait;
      assert.ok(long?.kind === "approval" && !long.whole, "A long approval is marked whole.");
      const asker = byId.get(agents.asker)?.wait;
      assert.ok(asker?.kind === "question" && asker.questions[0]?.options.join(",") === "Red,Blue");
      assert.equal(byId.get(agents.worker)?.state, "working");
      assert.equal(byId.get(agents.worker)?.turnId, "turn-worker");
      assert.equal(byId.get(agents.asker)?.reply, LONG_REPLY, "The newest reply is cut at the runtime limit.");
      assert.ok(shown.agents.every((agent) => agent.serverId === hostId));
      return shown;
    },
    (value) => ({ agents: value.agents.map((agent) => [agent.name, agent.state, agent.wait?.kind ?? null]) }),
  );

  await step("Approve refuses an approval that the watch cannot show in full", async () => {
    const { result } = await send({
      type: "approve",
      serverId: hostId,
      agentId: agents.longAsker,
      requestId: "approval-long",
    });
    assert.equal(result.ok, false);
    assert.equal(recorded.approvals.length, 0, "The host answered a long approval.");
    return result;
  });

  await step("Approve answers an approval shown in full, as the member", async () => {
    const { result, snapshot } = await send({
      type: "approve",
      serverId: hostId,
      agentId: agents.approver,
      requestId: "approval-short",
    });
    assert.equal(result.ok, true);
    assert.equal(recorded.approvals.length, 1);
    assert.deepEqual(recorded.approvals[0], { requestId: "approval-short", decision: "accept", owner: false });
    const approver = ready(snapshot).agents.find((agent) => agent.id === agents.approver);
    assert.notEqual(approver?.state, "waiting", "The answered approval still shows.");
    return recorded.approvals[0];
  });

  await step("Answer refuses an unknown question and sends a known one", async () => {
    const refused = await send({
      type: "answer",
      serverId: hostId,
      agentId: agents.asker,
      requestId: "prompt-one",
      answers: { other: ["Red"] },
    });
    assert.equal(refused.result.ok, false);
    assert.equal(recorded.prompts.length, 0);
    const { result } = await send({
      type: "answer",
      serverId: hostId,
      agentId: agents.asker,
      requestId: "prompt-one",
      answers: { color: ["Blue"] },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(recorded.prompts[0], {
      requestId: "prompt-one",
      answers: { color: ["Blue"] },
      sender: watcher.id,
    });
    return recorded.prompts[0];
  });

  await step("Send uses the watch message ID as the client message ID", async () => {
    const messageId = randomUUID();
    const { result } = await send({
      type: "send",
      serverId: hostId,
      agentId: agents.worker,
      text: "Hello from the wrist",
      messageId,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(recorded.sends[0], {
      text: "Hello from the wrist",
      clientMessageId: messageId,
      sender: watcher.id,
    });
    return recorded.sends[0];
  });

  await step("Read marks the chat read for the member", async () => {
    const { result, snapshot } = await send({ type: "read", serverId: hostId, agentId: agents.approver });
    assert.equal(result.ok, true);
    assert.deepEqual(recorded.reads[0], {
      agentId: agents.approver,
      memberId: watcher.id,
      throughMessageId: "reply-1",
    });
    assert.equal(ready(snapshot).agents.find((agent) => agent.id === agents.approver)?.unread, 0);
    return recorded.reads[0];
  });

  await step("Refresh lists the channels of the member with their place and unread count", async () => {
    const { result, snapshot } = await send({ type: "refresh" });
    assert.equal(result.ok, true);
    const channel = ready(snapshot).channels?.find((item) => item.id === channelId);
    assert.ok(channel, "The channel is missing from the snapshot.");
    assert.equal(channel.name, CHANNEL_NAME);
    assert.deepEqual(channel.members, [agents.approver, agents.asker]);
    assert.equal(channel.unread, 1);
    assert.equal(channel.author, "Owner");
    assert.equal(channel.reply, "Check the release notes, please.");
    assert.equal(channel.pinned, true);
    assert.equal(channel.position, 0);
    const pinnedAgent = ready(snapshot).agents.find((item) => item.id === agents.approver);
    assert.equal(pinnedAgent?.pinned, true);
    assert.equal(pinnedAgent?.position, 1);
    return { channel, pinnedAgent: { pinned: pinnedAgent?.pinned, position: pinnedAgent?.position } };
  });

  await step("Send to a channel posts the text as the member", async () => {
    const messageId = randomUUID();
    const text = "Ship it after the notes are done.";
    const { result } = await send({ type: "sendChannel", serverId: hostId, channelId, text, messageId });
    assert.equal(result.ok, true);
    const page = channels?.store.pageWithoutExtent(channelId, undefined, 20);
    const sent = page?.messages.at(-1);
    assert.equal(sent?.message.text, text);
    assert.equal(sent?.author.id, watcher.id);
    return { text: sent?.message.text, author: sent?.author };
  });

  await step("Read a channel clears its unread count for the member", async () => {
    const { result, snapshot } = await send({ type: "readChannel", serverId: hostId, channelId });
    assert.equal(result.ok, true);
    assert.equal(ready(snapshot).channels?.find((item) => item.id === channelId)?.unread, 0);
    const unknown = await send({ type: "readChannel", serverId: hostId, channelId: "no-such-channel" });
    assert.equal(unknown.result.ok, false);
    return { unread: 0, unknown: unknown.result };
  });

  await step("Stop ends the turn", async () => {
    const { result } = await send({ type: "stop", serverId: hostId, agentId: agents.worker, turnId: "turn-worker" });
    assert.equal(result.ok, true);
    assert.deepEqual(recorded.interrupts[0], { agentId: agents.worker, turnId: "turn-worker" });
    return recorded.interrupts[0];
  });

  await step("Avatars return the named agent picture", async () => {
    const name = firstSnapshot.agents.find((agent) => agent.id === agents.approver)?.avatar;
    assert.ok(name);
    const { result } = await send({ type: "avatars", names: [name] });
    assert.ok(result.ok && result.avatars);
    const stored = service?.resolveAvatar(agents.approver);
    assert.ok(stored, "The agent picture was not saved.");
    assert.equal(result.avatars[name], readFileSync(stored.path).toString("base64"));
    return { name, bytes: Buffer.from(result.avatars[name] ?? "", "base64").length };
  });

  await step("Open and pair are not on the direct link", async () => {
    const open = await send({ type: "open", serverId: hostId, agentId: agents.worker });
    assert.deepEqual(open.result, { ok: false, error: "failed", message: "" });
    return open.result;
  });

  await step("The host refuses bad tickets, proofs, clocks, replays, hosts and disabled members", async () => {
    assert.ok(relay);
    const host = relay;
    const statusOf = async (built: Awaited<ReturnType<typeof delivery>>) =>
      (await Effect.runPromise(host.deliver(built.delivery))).status;
    const refresh: WatchCommand = { type: "refresh" };
    const statuses = {
      badAudience: await statusOf(await delivery(refresh, { ticket: await ticket({}, "openbot-remote") })),
      badProof: await statusOf(await delivery(refresh, { proofHost: "another-host" })),
      staleClock: await statusOf(await delivery(refresh, { ts: Date.now() - 10 * 60_000 })),
      wrongHost: await statusOf(await delivery(refresh, { ticket: await ticket({ hostId: "another-host" }) })),
      oldEpoch: await statusOf(await delivery(refresh, { ticket: await ticket({ authEpoch: EPOCH - 1 }) })),
      unknownMember: await statusOf(await delivery(refresh, { ticket: await ticket({ membershipId: "nobody" }) })),
      disabledMember: await statusOf(
        await delivery(refresh, { ticket: await ticket({ membershipId: DISABLED_MEMBER }) }),
      ),
      wrongNonce: await statusOf(await delivery(refresh, { sealJti: "another-ticket" })),
    };
    const replayed = await delivery(refresh, { id: `replay-${randomUUID()}` });
    const first = (await Effect.runPromise(host.deliver(replayed.delivery))).status;
    const second = (await Effect.runPromise(host.deliver(replayed.delivery))).status;
    assert.deepEqual(statuses, {
      badAudience: 401,
      badProof: 401,
      staleClock: 401,
      wrongHost: 403,
      oldEpoch: 401,
      unknownMember: 200,
      disabledMember: 403,
      wrongNonce: 400,
    });
    assert.equal(first, 200);
    assert.equal(second, 400, "A replayed request was answered.");
    return { ...statuses, replayFirst: first, replaySecond: second };
  });

  await step("Dispose releases the ingress socket", async () => {
    assert.ok(relay);
    await Effect.runPromise(relay.dispose());
    assert.equal(holders, 0);
    return { holders };
  });

  report.passed = report.steps.every((entry) => entry.passed);
} finally {
  if (relay) await Effect.runPromise(relay.dispose()).catch(() => undefined);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  if (service) await runCauseEffect(service.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
