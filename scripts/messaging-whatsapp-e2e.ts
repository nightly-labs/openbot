// Checks the WhatsApp connector end to end against a fake WhatsApp: the link by QR code and by pairing
// code, the encrypted store and its lock, the sender rules (the owner's own chat, personal chats left
// alone, pairing codes on a dedicated number, the group mention gate, LID authors), the echo guard,
// numbered approval answers, the journal replay after a restart, each close code, the send queue while
// the socket is down, and the disconnect. Runs the real agent service, messaging service, WhatsApp
// driver, runtime, session and store on a temporary profile. Only the Baileys socket is fake: no
// message leaves this computer. `bun scripts/messaging-whatsapp-e2e.ts`.
// Writes .openbot-build/messaging-whatsapp-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Boom } from "@hapi/boom";
import type { MessagingConnection, WhatsAppLinkState } from "@openbot/contracts/ipc";
import {
  newStoreKey,
  WhatsAppAuthStore,
  WhatsAppStoreLocked,
  WhatsAppStoreUnreadable,
} from "@openbot/whatsapp/auth-store";
import {
  type AnyMessageContent,
  type BaileysEventMap,
  type GroupMetadata,
  type MiscMessageGenerationOptions,
  proto,
  type UserFacingSocketConfig,
  type WAMessage,
} from "@openbot/whatsapp/baileys";
import { gc } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { WhatsAppChatState } from "../src/backend/messaging/whatsapp/whatsapp-chats";
import { whatsAppDriver } from "../src/backend/messaging/whatsapp/whatsapp-driver";
import { whatsAppInbound } from "../src/backend/messaging/whatsapp/whatsapp-events";
import { WHATSAPP_TEXT_LIMIT, whatsAppChunks } from "../src/backend/messaging/whatsapp/whatsapp-render";
import { WhatsAppRuntime } from "../src/backend/messaging/whatsapp/whatsapp-runtime";
import { backoffDelay, closeDecision, type WhatsAppSocket } from "../src/backend/messaging/whatsapp/whatsapp-session";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { parseStartWhatsAppLinkInput, parseWhatsAppSenderInput } from "../src/main/ipc/messaging-inputs";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-whatsapp-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-whatsapp-e2e-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const whatsappRoot = join(userData, "whatsapp");

const OWNER = "48600100200";
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const OWNER_LID = "777001";
const FRIEND = "48600100300";
const STRANGER = "48600100400";
const LID_FRIEND = "48600100500";
const GROUP = "120363000000000001@g.us";
const OTHER_GROUP = "120363000000000002@g.us";
const PAIRING_CODE = "ABCD1234";
const lidDirectId = "IN-LID-DIRECT";

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { steps: Step[]; passed: boolean; unverified: string[] } = {
  steps: [],
  passed: false,
  unverified: [
    "The real WhatsApp servers and the Signal sessions: a fake socket stands in for Baileys. scripts/whatsapp-signal-e2e.ts checks the crypto; only a live smoke with two phones proves interop.",
    "An agent turn: no provider runs, so no answer is posted. Status posts, answers and approvals of a real turn use the same adapter calls that the steps make directly.",
    "Media download: it needs WhatsApp's media servers.",
  ],
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const entry: Step = { name, passed: false };
  report.steps.push(entry);
  try {
    entry.detail = await run();
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/** Waits for a state, not for a time: the condition is read again until it holds or the time ends. */
async function until<T>(read: () => T | null | undefined | false, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`);
    await new Promise((resume) => setTimeout(resume, 25));
  }
}

// The fake WhatsApp.

interface Sent {
  jid: string;
  content: AnyMessageContent;
  id: string;
}

/** One Baileys socket as OpenBot sees it. The phone drives it from the steps. */
class FakeSocket implements WhatsAppSocket {
  readonly #events = new EventEmitter();
  readonly #frames = new Set<() => void>();
  readonly #phone: FakePhone;
  readonly config: UserFacingSocketConfig;
  ended = false;
  user: { id: string } | undefined;
  readonly ev = {
    on: <T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void) => {
      this.#events.on(event, listener);
    },
  };
  readonly ws = {
    on: (_event: "frame", listener: () => void) => {
      this.#frames.add(listener);
    },
  };
  readonly signalRepository = {
    lidMapping: {
      getPNForLID: async (lid: string) =>
        lid.startsWith("999") ? `${LID_FRIEND}@s.whatsapp.net` : lid.startsWith(OWNER_LID) ? OWNER_JID : null,
    },
  };

  constructor(phone: FakePhone, config: UserFacingSocketConfig) {
    this.#phone = phone;
    this.config = config;
  }

  emit<T extends keyof BaileysEventMap>(event: T, arg: BaileysEventMap[T]): void {
    if (this.ended) return;
    for (const frame of this.#frames) frame();
    this.#events.emit(event, arg);
  }

  boot(): void {
    if (this.#phone.offline) {
      this.close(408);
      return;
    }
    const me = this.config.auth.creds.me;
    if (me?.id) {
      this.user = { id: me.id };
      this.emit("connection.update", { connection: "open" });
    } else this.emit("connection.update", { qr: `2@fake-qr-${this.#phone.sockets.length}` });
  }

  /** The phone scans the code: WhatsApp saves the account and asks for the restart after pairing. */
  scan(): void {
    this.emit("creds.update", { me: { id: `${OWNER}:5@s.whatsapp.net`, lid: `${OWNER_LID}:5@lid`, name: "Ana" } });
    this.close(515);
  }

  close(code: number): void {
    this.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: new Boom("closed", { statusCode: code }), date: new Date() },
    });
  }

  receive(messages: WAMessage[], type: "notify" | "append" = "notify"): void {
    this.emit("messages.upsert", { messages, type });
  }

  async sendMessage(jid: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions) {
    if (this.ended) throw new Error("socket closed");
    const id = options?.messageId ?? `SENT${this.#phone.sent.length}`;
    this.#phone.sent.push({ jid, content, id });
    const text = "text" in content && typeof content.text === "string" ? content.text : "";
    const message: WAMessage = {
      key: { remoteJid: jid, id, fromMe: true },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1_000),
    };
    return message;
  }

  async requestPairingCode(_phoneNumber: string): Promise<string> {
    return PAIRING_CODE;
  }

  async logout(): Promise<void> {
    this.#phone.logouts += 1;
  }

  end(_error: Error | undefined): void {
    this.ended = true;
  }

  async groupFetchAllParticipating() {
    return { [GROUP]: group(GROUP, "Team"), [OTHER_GROUP]: group(OTHER_GROUP, "Family") };
  }

  async groupMetadata(jid: string): Promise<GroupMetadata> {
    return group(jid, jid === GROUP ? "Team" : "Family");
  }

  async updateMediaMessage(message: WAMessage): Promise<WAMessage> {
    return message;
  }
}

class FakePhone {
  readonly sockets: FakeSocket[] = [];
  readonly sent: Sent[] = [];
  logouts = 0;
  /** WhatsApp cannot be reached: each socket closes before it shows a code. */
  offline = false;

  readonly create = (config: UserFacingSocketConfig): WhatsAppSocket => {
    const socket = new FakeSocket(this, config);
    this.sockets.push(socket);
    queueMicrotask(() => socket.boot());
    return socket;
  };

  current(): FakeSocket {
    const socket = this.sockets.findLast((candidate) => !candidate.ended);
    assert.ok(socket, "No open fake socket.");
    return socket;
  }

  textsTo(jid: string): string[] {
    return this.sent.flatMap((sent) =>
      sent.jid === jid && "text" in sent.content && typeof sent.content.text === "string" && !("edit" in sent.content)
        ? [sent.content.text]
        : [],
    );
  }

  /** True once OpenBot reacted to the message: 👀 when it took it, 💔 when the queue was full. */
  reactedTo(messageId: string | null | undefined): boolean {
    return this.sent.some((sent) => "react" in sent.content && sent.content.react.key?.id === messageId);
  }

  reactionsTo(jid: string): number {
    return this.sent.filter((sent) => sent.jid === jid && "react" in sent.content).length;
  }
}

function group(id: string, subject: string): GroupMetadata {
  return { id, owner: undefined, subject, participants: [] };
}

let counter = 0;
function message(input: {
  chat: string;
  text: string;
  fromMe?: boolean;
  participant?: string;
  participantAlt?: string;
  remoteJidAlt?: string;
  mentions?: string[];
  quotedId?: string;
  quotedParticipant?: string;
  pushName?: string;
  id?: string;
}): WAMessage {
  counter += 1;
  const contextInfo =
    input.mentions || input.quotedId
      ? {
          ...(input.mentions ? { mentionedJid: input.mentions } : {}),
          ...(input.quotedId
            ? {
                stanzaId: input.quotedId,
                participant: input.quotedParticipant ?? null,
                quotedMessage: { conversation: "earlier" },
              }
            : {}),
        }
      : null;
  return {
    key: {
      remoteJid: input.chat,
      fromMe: input.fromMe ?? false,
      id: input.id ?? `IN${counter}`,
      ...(input.participant ? { participant: input.participant } : {}),
      ...(input.participantAlt ? { participantAlt: input.participantAlt } : {}),
      ...(input.remoteJidAlt ? { remoteJidAlt: input.remoteJidAlt } : {}),
    },
    message: contextInfo ? { extendedTextMessage: { text: input.text, contextInfo } } : { conversation: input.text },
    messageTimestamp: Math.floor(Date.now() / 1_000),
    pushName: input.pushName ?? "Someone",
  };
}

// The services.

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
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
};

function memoryCredentials(): MessagingCredentials {
  const values = new Map<string, Record<string, string>>();
  return {
    keys: () => [...values.keys()],
    status: (connectionId) => (values.has(connectionId) ? "saved" : "missing"),
    get: (connectionId) => values.get(connectionId) ?? null,
    set: (connectionId, value) => Effect.sync(() => void values.set(connectionId, value)),
    clear: (connectionId) => Effect.sync(() => void values.delete(connectionId)),
    retain: (connectionIds) =>
      Effect.sync(() => {
        for (const key of values.keys()) if (!connectionIds.has(key)) values.delete(key);
      }),
  };
}

// The credential store outlives one boot, as safeStorage does.
const credentials = memoryCredentials();
const phone = new FakePhone();

interface Booted {
  agents: AgentService;
  messaging: MessagingService;
  runtime: WhatsAppRuntime;
}

async function boot<T>(use: (services: Booted) => Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  const runtime = new WhatsAppRuntime({
    root: whatsappRoot,
    createSocket: phone.create,
    // The fake socket never encrypts, so it never calls the repository.
    makeSignalRepository: () => {
      throw new Error("Not used by the fake socket.");
    },
    fetchVersion: async () => null,
  });
  const messaging = new MessagingService({
    threads: agents.messaging,
    agents: {
      listAgents: () => agents.listAgents(),
      respondToApproval: (input) => agents.respondToApproval(input),
      onEvent: () => () => {},
      createAgentProfile: (input) => agents.createAgentProfile(input),
      createMemory: (input) => agents.createMemory(input),
      ensureDeletable: (agentId) => agents.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => agents.deleteAgent(agentId),
      sidebarChatIds: () => agents.sidebarChatIds(),
    },
    credentials,
    drivers: [whatsAppDriver({ runtime })],
    downloadsRoot: join(userData, "messaging-downloads"),
    whatsapp: runtime,
    sidebar,
  });
  await runCauseEffect(messaging.start());
  try {
    return await use({ agents, messaging, runtime });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
    releaseClosedStores();
  }
}

/**
 * Bun keeps a closed `node:sqlite` connection, and so the store's exclusive lock, until its statements
 * are collected; Node, which Electron runs, releases it at `close`. This script runs on Bun and opens
 * the same stores again, so it collects them first.
 */
function releaseClosedStores(): void {
  gc(true);
}

/** The store of the linked number while no service runs. The credential store keeps its id and key. */
function openConnectionStore(): WhatsAppAuthStore {
  const values = credentials
    .keys()
    .map((key) => credentials.get(key))
    .find((candidate) => candidate?.storeId);
  assert.ok(values?.storeId && values.whatsappStoreKey, "No WhatsApp store.");
  return WhatsAppAuthStore.open({
    path: join(whatsappRoot, `${values.storeId}.db`),
    key: Buffer.from(values.whatsappStoreKey, "base64"),
  });
}

/** A journal entry as the transport writes it: the message as protobuf, in JSON. */
function journalPayload(entry: WAMessage): string {
  return JSON.stringify({ message: Buffer.from(proto.WebMessageInfo.encode(entry).finish()).toString("base64") });
}

function storeFile(agents: AgentService): string {
  const storeId = credentials.get(connectionId(agents))?.storeId;
  assert.ok(storeId, "The connection has no store id.");
  return join(whatsappRoot, `${storeId}.db`);
}

function connection(messaging: MessagingService): MessagingConnection | undefined {
  return messaging.whatsappOverview().connections.find((candidate) => candidate.workspaceId === OWNER);
}

function connectionId(agents: AgentService): string {
  const record = agents.messaging.store.connectionForWorkspace("whatsapp", OWNER);
  assert.ok(record, "No WhatsApp connection row.");
  return record.connectionId;
}

function received(agents: AgentService, chat: string, id: string): boolean {
  return agents.messaging.received(`messaging:${connectionId(agents)}:${chat}:${id}`);
}

async function linkState(messaging: MessagingService, done: (state: WhatsAppLinkState) => boolean, label: string) {
  return until(() => {
    const state = messaging.whatsappLinkState();
    return done(state) ? state : null;
  }, label);
}

try {
  await step("pure rules: close codes, backoff, chunks and formatting", async () => {
    assert.equal(closeDecision(401, false, false, true), "fatal");
    assert.equal(closeDecision(403, false, false, true), "fatal");
    assert.equal(closeDecision(411, false, false, true), "fatal");
    assert.equal(closeDecision(440, false, false, true), "replaced");
    assert.equal(closeDecision(515, true, true, true), "restart");
    assert.equal(closeDecision(408, true, false, true), "restart");
    assert.equal(closeDecision(408, true, true, true), "timeout");
    assert.equal(closeDecision(408, false, true, true), "retry");
    assert.equal(closeDecision(428, false, false, true), "retry");
    assert.equal(closeDecision(undefined, false, false, true), "retry");
    // A link that closes before it showed a code did not reach WhatsApp; the user sees "unavailable".
    assert.equal(closeDecision(408, true, false, false), "unreachable");
    assert.equal(closeDecision(428, true, false, false), "unreachable");
    assert.equal(closeDecision(515, true, false, false), "restart");
    const delays = [0, 1, 5, 20].map((attempt) => [backoffDelay(attempt, () => 0), backoffDelay(attempt, () => 1)]);
    assert.deepEqual(delays[0], [1_500, 2_500]);
    assert.ok((delays[3]?.[1] ?? 0) <= 37_500 && (delays[3]?.[0] ?? 0) >= 22_500, "The backoff is not capped.");
    const long = `# Title\n**bold** and *italic* and ~~gone~~ [site](https://example.com)\n${"word ".repeat(2_000)}\n\`\`\`\ncode **kept**\n\`\`\``;
    const chunks = whatsAppChunks(long);
    assert.ok(chunks.length >= 3 && chunks.every((chunk) => chunk.length <= WHATSAPP_TEXT_LIMIT + 4));
    assert.ok(chunks[0]?.startsWith("*Title*\n*bold* and _italic_ and ~gone~ site (https://example.com)"));
    assert.ok(chunks.at(-1)?.includes("code **kept**"), "Text inside a code block changed.");
    return { delays, chunks: chunks.length };
  });

  await step("store: values are sealed, a second opener is locked out, a wrong key cannot read", async () => {
    const path = join(root, "store-check.db");
    const key = newStoreKey();
    const store = WhatsAppAuthStore.open({ path, key });
    store.creds.me = { id: `${OWNER}:9@s.whatsapp.net`, name: "Ana" };
    store.saveCreds();
    await store.state.keys.set({ session: { "48600100300.0": new Uint8Array([1, 2, 3]) } });
    assert.throws(() => WhatsAppAuthStore.open({ path, key }), WhatsAppStoreLocked);
    store.close();
    releaseClosedStores();
    const raw = readFileSync(path);
    assert.ok(!raw.includes(Buffer.from(OWNER)), "The store file holds the phone number in clear text.");
    assert.ok(!raw.includes(Buffer.from("noiseKey")), "The store file holds the creds in clear text.");
    assert.throws(() => WhatsAppAuthStore.open({ path, key: newStoreKey() }), WhatsAppStoreUnreadable);
    releaseClosedStores();
    const again = WhatsAppAuthStore.open({ path, key });
    assert.equal(again.creds.me?.id, `${OWNER}:9@s.whatsapp.net`);
    const session = await again.state.keys.get("session", ["48600100300.0"]);
    assert.deepEqual([...(session["48600100300.0"] ?? [])], [1, 2, 3]);
    again.close();
    return { sealed: true };
  });

  await boot(async ({ agents, messaging, runtime }) => {
    await step("link without network: the link fails as unavailable, not as an expired code", async () => {
      phone.offline = true;
      await runCauseEffect(messaging.startWhatsAppLink(parseStartWhatsAppLinkInput({ method: "qr", ownNumber: true })));
      const failed = await linkState(messaging, (state) => state.status === "failed", "the failed link");
      phone.offline = false;
      assert.equal(failed.error, "unavailable");
      assert.equal(messaging.whatsappOverview().connections.length, 0, "A failed link left a connection.");
      return { error: failed.error };
    });

    await step("link by QR code: the scan pairs, WhatsApp restarts, and the number connects", async () => {
      assert.throws(() => parseStartWhatsAppLinkInput({ method: "code", phoneNumber: "12", ownNumber: true }));
      const started = await runCauseEffect(
        messaging.startWhatsAppLink(parseStartWhatsAppLinkInput({ method: "qr", ownNumber: true })),
      );
      assert.equal(started.status, "waiting");
      const waiting = await linkState(messaging, (state) => state.qr !== null, "a QR code");
      assert.match(waiting.qr ?? "", /^2@fake-qr-/u);
      phone.current().scan();
      const linked = await linkState(messaging, (state) => state.status === "linked", "the link");
      assert.equal(linked.workspaceId, OWNER);
      const live = await until(
        () => connection(messaging)?.state === "connected" && connection(messaging),
        "connected",
      );
      assert.equal(live.platform, "whatsapp");
      assert.ok(existsSync(storeFile(agents)), "The connection has no store file.");
      const account = messaging.whatsappOverview().accounts[0];
      assert.equal(account?.ownNumber, true);
      return { workspaceName: live.workspaceName, state: live.state };
    });

    await step("orchestrator: one WhatsApp Orchestrator answers new conversations", async () => {
      const added = await runCauseEffect(messaging.addWhatsAppOrchestrator({}));
      const agent = agents.listAgents().find((candidate) => candidate.id === added.agentId);
      assert.equal(agent?.name, "WhatsApp Orchestrator");
      assert.equal(connection(messaging)?.orchestratorAgentId, added.agentId);
      return { agentId: added.agentId };
    });

    await step("own chat: the owner's message reaches the orchestrator and gets 👀", async () => {
      const first = message({ chat: OWNER_JID, fromMe: true, text: "What is on my calendar?" });
      phone.current().receive([first]);
      await until(() => received(agents, OWNER_JID, first.key.id ?? ""), "the owner's message in the mailbox");
      await until(() => phone.reactionsTo(OWNER_JID) === 1, "the received reaction");
      const link = agents.messaging.store.linkByKey(connectionId(agents), OWNER_JID, "dm");
      assert.ok(link, "No conversation for the owner's chat.");
      return { linkId: link.linkId };
    });

    await step("echo guard: OpenBot's own post in the owner's chat is not a new request", async () => {
      const own = phone.sent.at(-1);
      assert.ok(own);
      phone.current().receive([message({ chat: OWNER_JID, fromMe: true, text: "👀", id: own.id })]);
      phone.current().receive([message({ chat: OWNER_JID, fromMe: true, text: "echo", id: own.id })], "append");
      // A later message is read, so the two echoes above were read and dropped.
      const later = message({ chat: OWNER_JID, fromMe: true, text: "And tomorrow?" });
      phone.current().receive([later]);
      await until(() => received(agents, OWNER_JID, later.key.id ?? ""), "the later message");
      assert.equal(received(agents, OWNER_JID, own.id), false, "An own post was read as a request.");
      return { echoId: own.id };
    });

    await step(
      "personal number: other chats, the owner's own messages in them, and strangers stay untouched",
      async () => {
        const elsewhere = () => phone.sent.filter((sent) => sent.jid !== OWNER_JID).length;
        const before = elsewhere();
        const personal = message({ chat: `${STRANGER}@s.whatsapp.net`, text: "hi, dinner tonight?" });
        const ownReply = message({ chat: `${STRANGER}@s.whatsapp.net`, fromMe: true, text: "sure" });
        const groupChat = message({
          chat: GROUP,
          participant: `${FRIEND}@s.whatsapp.net`,
          text: "@48600100200 hello",
          mentions: [OWNER_JID],
        });
        phone.current().receive([personal, ownReply, groupChat]);
        const marker = message({ chat: OWNER_JID, fromMe: true, text: "marker" });
        phone.current().receive([marker]);
        await until(() => phone.reactedTo(marker.key.id), "the marker");
        assert.equal(received(agents, `${STRANGER}@s.whatsapp.net`, personal.key.id ?? ""), false);
        assert.equal(received(agents, GROUP, groupChat.key.id ?? ""), false);
        assert.equal(phone.textsTo(`${STRANGER}@s.whatsapp.net`).length, 0, "OpenBot wrote to a personal contact.");
        assert.equal(messaging.whatsappOverview().accounts[0]?.pendingRequests.length, 0);
        assert.equal(elsewhere(), before, "OpenBot posted outside the owner's own chat.");
        return { ignored: 3 };
      },
    );

    await step(
      "dedicated number: an unknown person gets one code, the owner approves, and the person can write",
      async () => {
        await runCauseEffect(messaging.setWhatsAppOwnNumber(OWNER, false));
        const strangerJid = `${STRANGER}@s.whatsapp.net`;
        phone.current().receive([message({ chat: strangerJid, text: "hello bot", pushName: "Cara" })]);
        const request = await until(
          () => messaging.whatsappOverview().accounts[0]?.pendingRequests[0],
          "a pairing request",
        );
        assert.equal(request.senderId, STRANGER);
        assert.equal(request.name, "Cara");
        await until(() => phone.textsTo(strangerJid).length === 1, "the pairing code reply");
        assert.ok(phone.textsTo(strangerJid)[0]?.includes(request.code), "The reply does not hold the code.");
        phone.current().receive([message({ chat: strangerJid, text: "hello again" })]);
        const marker = message({ chat: OWNER_JID, fromMe: true, text: "marker 2" });
        phone.current().receive([marker]);
        await until(() => phone.reactedTo(marker.key.id), "the marker");
        assert.equal(phone.textsTo(strangerJid).length, 1, "A second message got a second code.");
        await runCauseEffect(messaging.answerWhatsAppRequest(OWNER, request.code, true));
        assert.deepEqual(
          messaging.whatsappOverview().accounts[0]?.allowedSenders.map((sender) => sender.id),
          [STRANGER],
        );
        await until(() => phone.textsTo(strangerJid).length === 2, "the approval line");
        const allowed = message({ chat: strangerJid, text: "Can you check the build?" });
        phone.current().receive([allowed]);
        await until(() => received(agents, strangerJid, allowed.key.id ?? ""), "the allowed person's message");
        return { code: request.code };
      },
    );

    await step("pairing limit: at most three requests wait, and the fourth person gets no answer", async () => {
      for (const suffix of ["01", "02", "03", "04"])
        phone.current().receive([message({ chat: `486009999${suffix}@s.whatsapp.net`, text: "hi" })]);
      await until(() => messaging.whatsappOverview().accounts[0]?.pendingRequests.length === 3, "three requests");
      const marker = message({ chat: OWNER_JID, fromMe: true, text: "marker 3" });
      phone.current().receive([marker]);
      await until(() => phone.reactedTo(marker.key.id), "the marker");
      assert.equal(phone.textsTo("48600999904@s.whatsapp.net").length, 0, "The fourth person got a code.");
      return { pending: 3 };
    });

    await step(
      "groups: only an allowed group, only a mention starts a conversation, and a reply continues it",
      async () => {
        const groups = await runCauseEffect(messaging.listWhatsAppGroups(OWNER));
        assert.deepEqual(
          groups.groups.map((entry) => entry.name),
          ["Family", "Team"],
        );
        const input = parseWhatsAppSenderInput({
          workspaceId: OWNER,
          sender: { id: GROUP, kind: "group", name: "Team" },
        });
        await runCauseEffect(messaging.addWhatsAppSender(input.workspaceId, input.sender));
        const author = `${FRIEND}@s.whatsapp.net`;
        const chatter = message({ chat: GROUP, participant: author, text: "lunch?" });
        const mention = message({
          chat: GROUP,
          participant: author,
          text: "@48600100200 summarize the release",
          mentions: [OWNER_JID],
        });
        phone.current().receive([chatter, mention]);
        await until(() => received(agents, GROUP, mention.key.id ?? ""), "the mention");
        assert.equal(
          received(agents, GROUP, chatter.key.id ?? ""),
          false,
          "A group message without a mention started work.",
        );
        const link = agents.messaging.store.linkByKey(connectionId(agents), GROUP, mention.key.id ?? "");
        assert.ok(link, "The mention did not start a conversation keyed by its message.");
        const reply = message({
          chat: GROUP,
          participant: author,
          text: "and the changelog",
          quotedId: mention.key.id ?? "",
          quotedParticipant: author,
        });
        phone.current().receive([reply]);
        await until(() => received(agents, GROUP, reply.key.id ?? ""), "the reply in the conversation");
        const other = message({
          chat: OTHER_GROUP,
          participant: author,
          text: "@48600100200 hi",
          mentions: [OWNER_JID],
        });
        phone.current().receive([other]);
        const marker = message({ chat: OWNER_JID, fromMe: true, text: "marker 4" });
        phone.current().receive([marker]);
        await until(() => phone.reactedTo(marker.key.id), "the marker");
        assert.equal(
          received(agents, OTHER_GROUP, other.key.id ?? ""),
          false,
          "A group that is not allowed started work.",
        );
        return { threadKey: link.threadKey };
      },
    );

    await step("LID authors: a LID chat with a phone form, and a LID group member, map to their numbers", async () => {
      const input = parseWhatsAppSenderInput({
        workspaceId: OWNER,
        sender: { id: "+48 600 100 500", kind: "contact", name: "Dan" },
      });
      assert.equal(input.sender.id, LID_FRIEND);
      await runCauseEffect(messaging.addWhatsAppSender(input.workspaceId, input.sender));
      const direct = message({
        chat: "999123@lid",
        remoteJidAlt: `${LID_FRIEND}@s.whatsapp.net`,
        text: "status?",
        id: lidDirectId,
      });
      phone.current().receive([direct]);
      await until(
        () => received(agents, `${LID_FRIEND}@s.whatsapp.net`, direct.key.id ?? ""),
        "the LID direct message",
      );
      const lidOnly = message({ chat: "999456@lid", text: "still there?" });
      phone.current().receive([lidOnly]);
      await until(() => received(agents, `${LID_FRIEND}@s.whatsapp.net`, lidOnly.key.id ?? ""), "the LID-only message");
      return { chat: `${LID_FRIEND}@s.whatsapp.net` };
    });

    await step("burst: short messages of one person within 1.5 s become one request", async () => {
      const strangerJid = `${STRANGER}@s.whatsapp.net`;
      const first = message({ chat: strangerJid, text: "one more thing" });
      const second = message({ chat: strangerJid, text: "the logs are in Shared" });
      phone.current().receive([first]);
      phone.current().receive([second]);
      await until(() => received(agents, strangerJid, first.key.id ?? ""), "the joined request");
      assert.equal(received(agents, strangerJid, second.key.id ?? ""), false, "The burst was not joined.");
      return { joined: 2 };
    });

    await step(
      "numbered answers: 1 approves the quoted menu, 2 denies the newest one, only for its buttons",
      async () => {
        const chats = new WhatsAppChatState();
        chats.rememberMenu("MENU1", {
          chatJid: OWNER_JID,
          threadKey: "dm",
          buttons: [
            { action: "accept", label: "Approve", token: "t-accept" },
            { action: "decline", label: "Deny", token: "t-decline" },
          ],
        });
        const context = {
          me: { number: OWNER, lid: `${OWNER_LID}@lid` },
          openedAt: Date.now(),
          now: Date.now(),
          rules: { ownNumber: true, contacts: new Set<string>(), groups: new Set<string>() },
          chats,
          isOwnPost: () => false,
          threadOf: () => null,
          numberForLid: async () => null,
        };
        const quoted = await whatsAppInbound(
          message({ chat: OWNER_JID, fromMe: true, text: "1", quotedId: "MENU1", quotedParticipant: OWNER_JID }),
          context,
        );
        assert.equal(quoted?.type, "action");
        assert.ok(quoted?.type === "action" && quoted.action.type === "approval" && quoted.action.token === "t-accept");
        const newest = await whatsAppInbound(message({ chat: OWNER_JID, fromMe: true, text: "2" }), context);
        assert.ok(
          newest?.type === "action" && newest.action.type === "approval" && newest.action.decision === "decline",
        );
        const plain = await whatsAppInbound(message({ chat: `${STRANGER}@s.whatsapp.net`, text: "1" }), context);
        assert.equal(plain, null, "A stranger's 1 counted on a personal number.");
        return { approved: true };
      },
    );

    await step("adapter: a post outside the allowed chats is refused, and a late edit becomes a new post", async () => {
      const values = credentials.get(connectionId(agents));
      assert.ok(values);
      const adapter = whatsAppDriver({ runtime }).createAdapter(values, { rateLimited: () => {} });
      await runCauseEffect(adapter.identify());
      const refused = await Effect.runPromise(
        Effect.result(
          adapter.postAnswer({ platformChannelId: "48611111111@s.whatsapp.net", replyThreadId: null }, "hi", null),
        ),
      );
      assert.equal(refused._tag, "Failure", "A post to a chat that is not allowed went out.");
      const before = phone.textsTo(OWNER_JID).length;
      await runCauseEffect(
        adapter.edit({ platformChannelId: OWNER_JID, replyThreadId: null }, "UNKNOWN-POST", { text: "Updated" }),
      );
      await until(() => phone.textsTo(OWNER_JID).length === before + 1, "the edit as a new post");
      return { refused: true };
    });
  });

  // A crash after WhatsApp delivered two messages: one reached the mailbox, one did not. Their journal
  // entries are still unhandled, as a crash leaves them.
  const crash = await (async () => {
    const store = openConnectionStore();
    const done = message({ chat: `${LID_FRIEND}@s.whatsapp.net`, text: "status?", id: lidDirectId });
    const lost = message({ chat: `${LID_FRIEND}@s.whatsapp.net`, text: "lost in the crash" });
    for (const entry of [done, lost])
      store.journal({
        dedupKey: `${LID_FRIEND}@s.whatsapp.net:${entry.key.id}`,
        payload: journalPayload(entry),
        receivedAt: Date.now(),
      });
    store.close();
    releaseClosedStores();
    return { lostId: lost.key.id ?? "" };
  })();

  await boot(async ({ agents, messaging, runtime }) => {
    await step(
      "restart after a crash: the journal replays the lost message once, and not the one in the mailbox",
      async () => {
        // Dan already has two requests waiting, so the replayed one gets the busy answer: it was read.
        await until(() => phone.reactedTo(crash.lostId), "the replayed message");
        const reactions = phone.sent.filter(
          (sent) => "react" in sent.content && sent.content.react.key?.id === lidDirectId,
        ).length;
        assert.equal(reactions, 1, "The message that was already in the mailbox was answered again.");
        return { replayed: crash.lostId };
      },
    );

    await step("restart: the number connects again from its store and keeps reading", async () => {
      await until(() => connection(messaging)?.state === "connected", "connected after restart");
      const handle = runtime.get(credentials.get(connectionId(agents))?.storeId ?? "");
      assert.ok(handle, "No open store after the restart.");
      // The service enqueues within moments, so the earlier boot's messages are in the mailbox.
      const reactions = phone.reactionsTo(OWNER_JID);
      const strangerReactions = phone.reactionsTo(`${STRANGER}@s.whatsapp.net`);
      const marker = message({ chat: OWNER_JID, fromMe: true, text: "after restart" });
      phone.current().receive([marker]);
      // The owner already has two requests waiting, so this one gets the busy answer: it was read.
      await until(() => phone.reactedTo(marker.key.id), "a message after the restart");
      await until(() => phone.reactionsTo(OWNER_JID) === reactions + 1, "one new reaction");
      assert.equal(phone.reactionsTo(OWNER_JID), reactions + 1, "A replayed message was answered again.");
      assert.equal(
        phone.reactionsTo(`${STRANGER}@s.whatsapp.net`),
        strangerReactions,
        "A message of a joined burst was sent again after the restart.",
      );
      return { reactions: phone.reactionsTo(OWNER_JID) };
    });
  });

  await step("normal stop: every message the service took is marked handled, so nothing replays", async () => {
    const store = openConnectionStore();
    const left = store.unhandled().length;
    store.close();
    releaseClosedStores();
    assert.equal(left, 0, "A normal stop left messages to replay.");
    return { left };
  });

  await boot(async ({ agents, messaging, runtime }) => {
    await step(
      "close codes: 440 stops with an error, Reconnect connects, 428 reconnects by itself, 401 needs a new link",
      async () => {
        phone.current().close(440);
        await until(() => connection(messaging)?.state === "error", "the replaced state");
        const sockets = phone.sockets.length;
        await new Promise((resume) => setTimeout(resume, 200));
        assert.equal(phone.sockets.length, sockets, "A replaced session reconnected by itself.");
        await runCauseEffect(messaging.reconnect("whatsapp", OWNER, true));
        await until(() => connection(messaging)?.state === "connected", "connected after Reconnect");

        // The send waits for the socket while it is down, then goes out.
        phone.current().close(428);
        await until(() => connection(messaging)?.state === "reconnecting", "reconnecting");
        const handle = runtime.get(credentials.get(connectionId(agents))?.storeId ?? "");
        assert.ok(handle);
        const queued = runCauseEffect(handle.session.send(OWNER_JID, { text: "sent after the reconnect" }));
        await until(() => connection(messaging)?.state === "connected", "connected after the backoff", 15_000);
        await queued;
        assert.ok(phone.textsTo(OWNER_JID).includes("sent after the reconnect"), "The queued post was lost.");

        phone.current().close(401);
        await until(() => connection(messaging)?.state === "invalid_token", "the logged-out state");
        return { states: ["error", "connected", "reconnecting", "connected", "invalid_token"] };
      },
    );

    await step(
      "link by pairing code: the phone types the code, and the same number links again with its settings",
      async () => {
        const oldStore = storeFile(agents);
        const started = await runCauseEffect(
          messaging.startWhatsAppLink(
            parseStartWhatsAppLinkInput({ method: "code", phoneNumber: "+48 600 100 200", ownNumber: false }),
          ),
        );
        assert.equal(started.status, "waiting");
        const withCode = await linkState(messaging, (state) => state.code !== null, "a pairing code");
        assert.equal(withCode.code, PAIRING_CODE);
        phone.current().scan();
        await linkState(messaging, (state) => state.status === "linked", "the second link");
        await until(() => connection(messaging)?.state === "connected", "connected after the second link");
        const account = messaging.whatsappOverview().accounts[0];
        assert.ok(
          account?.allowedSenders.some((sender) => sender.id === GROUP),
          "The allowed senders were lost.",
        );
        assert.equal(account?.ownNumber, false);
        assert.equal(existsSync(oldStore), false, "The replaced device's keys stayed on disk.");
        assert.ok(existsSync(storeFile(agents)), "The new link has no store file.");
        return { code: withCode.code };
      },
    );

    await step("disconnect: the device logs out, its keys are deleted, and the orchestrator goes", async () => {
      const id = connectionId(agents);
      const file = storeFile(agents);
      const orchestrator = connection(messaging)?.orchestratorAgentId;
      const logouts = phone.logouts;
      // No provider runs here, so the orchestrator still holds the requests of the steps above. A busy
      // orchestrator stops a disconnect, as for the other platforms, so each person stops theirs first.
      const authors: Record<string, string> = {
        [OWNER_JID]: OWNER,
        [`${STRANGER}@s.whatsapp.net`]: STRANGER,
        [`${LID_FRIEND}@s.whatsapp.net`]: LID_FRIEND,
        [GROUP]: FRIEND,
      };
      for (const link of agents.messaging.store.links(orchestrator ?? ""))
        await runCauseEffect(agents.messaging.stop(link.linkId, authors[link.platformChannelId] ?? ""));
      await runCauseEffect(messaging.disconnectWhatsAppNumber(OWNER));
      assert.equal(phone.logouts, logouts + 1, "The device was not logged out.");
      assert.equal(existsSync(file), false, "The keys stayed on disk.");
      assert.equal(credentials.status(id), "missing");
      assert.equal(connection(messaging), undefined);
      assert.ok(!agents.listAgents().some((agent) => agent.id === orchestrator), "The orchestrator stayed.");
      assert.ok(
        agents.messaging.store.allowedSenders(id).length > 0,
        "Disconnect removed the allowed senders, which a new link of the number gets back.",
      );
      return { disconnected: true };
    });
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`WhatsApp connector check passed. Report: ${REPORT}\n`);
