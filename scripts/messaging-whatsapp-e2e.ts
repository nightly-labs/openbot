import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Boom } from "@hapi/boom";
import type { MessagingConnection, WhatsAppLinkState } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  newStoreKey,
  WhatsAppAuthStore,
  WhatsAppStoreLocked,
  WhatsAppStoreUnreadable,
} from "@openbot/whatsapp/auth-store";
import {
  type AnyMessageContent,
  type BaileysEventMap,
  type BinaryNode,
  type GroupMetadata,
  type MiscMessageGenerationOptions,
  proto,
  type UserFacingSocketConfig,
  type WAMessage,
} from "@openbot/whatsapp/baileys";
import { gc } from "bun";
import { Effect, Scope } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { WhatsAppRefusedError } from "../src/backend/messaging/messaging-types";
import { WhatsAppChatState } from "../src/backend/messaging/whatsapp/whatsapp-chats";
import { whatsAppDriver } from "../src/backend/messaging/whatsapp/whatsapp-driver";
import { whatsAppInbound } from "../src/backend/messaging/whatsapp/whatsapp-events";
import { WHATSAPP_TEXT_LIMIT, whatsAppChunks } from "../src/backend/messaging/whatsapp/whatsapp-render";
import { WhatsAppRuntime } from "../src/backend/messaging/whatsapp/whatsapp-runtime";
import {
  backoffDelay,
  closeDecision,
  MESSAGE_ACK,
  NODE_HANDLING,
  type WhatsAppAck,
  WhatsAppSession,
  type WhatsAppSocket,
} from "../src/backend/messaging/whatsapp/whatsapp-session";
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
const LID_FRIEND_CHAT = "999123@lid";
const LEAD = "48600100600";
const OTHER_LEAD = "48600100700";
const BRAZIL_TYPED = "5531988887777";
const BRAZIL_ACCOUNT = "553188887777";
const GROUP = "120363000000000001@g.us";
const OTHER_GROUP = "120363000000000002@g.us";
const PAIRING_CODE: string = "ABCD1234";
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
    "Media download, also the download of a file at arrival: it needs WhatsApp's media servers. A file that the step writes stands in for the saved copy.",
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

async function until<T>(read: () => T | null | undefined | false, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`);
    await new Promise((resume) => setTimeout(resume, 25));
  }
}

interface Sent {
  jid: string;
  content: AnyMessageContent;
  id: string;
  quotedId: string | null;
}

class FakeSocket implements WhatsAppSocket {
  readonly #events = new EventEmitter();
  readonly #ws = new EventEmitter();
  readonly #phone: FakePhone;
  readonly config: UserFacingSocketConfig;
  ended = false;
  user: { id: string } | undefined;
  readonly ev = {
    on: <T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void) => {
      this.#events.on(event, listener);
    },
  };
  readonly ws: WhatsAppSocket["ws"] = this.#ws;
  readonly signalRepository = {
    lidMapping: {
      getPNForLID: async (lid: string) =>
        lid.startsWith("999") ? `${LID_FRIEND}@s.whatsapp.net` : lid.startsWith(OWNER_LID) ? OWNER_JID : null,
      getLIDForPN: async (pn: string) => (pn === `${LID_FRIEND}@s.whatsapp.net` ? LID_FRIEND_CHAT : null),
    },
  };

  constructor(phone: FakePhone, config: UserFacingSocketConfig) {
    this.#phone = phone;
    this.config = config;
  }

  emit<T extends keyof BaileysEventMap>(event: T, arg: BaileysEventMap[T]): void {
    if (this.ended) return;
    this.#ws.emit("frame");
    this.#events.emit(event, arg);
  }

  keepAlive(): void {
    if (!this.ended) this.#ws.emit("frame");
  }

  stallNode(): void {
    if (!this.ended)
      this.#ws.emit(NODE_HANDLING, { tag: "message", attrs: { id: "STALLED" } } satisfies BinaryNode, true);
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
      const first = this.#phone.onOpen;
      this.#phone.onOpen = null;
      if (first) this.receive([first]);
    } else this.emit("connection.update", { qr: `2@fake-qr-${this.#phone.sockets.length}` });
  }

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
    if (this.#phone.dropNext === jid) {
      this.#phone.dropNext = null;
      this.#phone.lost.push({ jid, content, id, quotedId: null });
      setTimeout(() => this.close(428), 0);
      return { key: { remoteJid: jid, id, fromMe: true }, message: {} } satisfies WAMessage;
    }
    this.#phone.sent.push({ jid, content, id, quotedId: options?.quoted?.key.id ?? null });
    const error = this.#phone.refused.get(jid);
    if (!this.#phone.holdAcks)
      setTimeout(() => {
        this.#ws.emit(MESSAGE_ACK, { attrs: { id, ...(error ? { error } : {}) } } satisfies WhatsAppAck);
      }, 0);
    const text = "text" in content && typeof content.text === "string" ? content.text : "";
    const message: WAMessage = {
      key: { remoteJid: jid, id, fromMe: true },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1_000),
    };
    return message;
  }

  async requestPairingCode(_phoneNumber: string): Promise<string> {
    const hold = this.#phone.holdPairing;
    if (!hold) return PAIRING_CODE;
    this.#phone.pairingWaits += 1;
    try {
      await hold;
      if (this.ended) throw new Error("socket closed");
      return PAIRING_CODE;
    } finally {
      this.#phone.pairingDone += 1;
    }
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

  async onWhatsApp(...phoneNumbers: string[]) {
    return phoneNumbers.map((number) => ({
      jid: `${number === BRAZIL_TYPED ? BRAZIL_ACCOUNT : number}@s.whatsapp.net`,
      exists: true,
    }));
  }

  async updateMediaMessage(message: WAMessage): Promise<WAMessage> {
    return message;
  }
}

class FakePhone {
  readonly sockets: FakeSocket[] = [];
  readonly sent: Sent[] = [];
  readonly refused = new Map<string, string>();
  dropNext: string | null = null;
  holdAcks = false;
  readonly lost: Sent[] = [];
  logouts = 0;
  offline = false;
  onOpen: WAMessage | null = null;
  holdPairing: Promise<void> | null = null;
  pairingWaits = 0;
  pairingDone = 0;

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

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
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

const credentials = memoryCredentials();
const phone = new FakePhone();

interface Booted {
  agents: AgentService;
  messaging: MessagingService;
  runtime: WhatsAppRuntime;
  mailbox: MailboxStore;
  database: OpenBotDatabase;
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
      approvalExecutionThreadId: (requestId) => agents.approvalExecutionThreadId(requestId),
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
    return await use({ agents, messaging, runtime, mailbox, database });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
    releaseClosedStores();
  }
}

function releaseClosedStores(): void {
  gc(true);
}

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

interface HistoryRead {
  messages: { author: string; sentAt: string; text: string; files?: { name: string; path?: string }[] }[];
  note: string;
}

async function readHistory(
  agents: AgentService,
  args: { place: string; query?: string; before?: string },
): Promise<HistoryRead> {
  const result = await runCauseEffect(
    agents.messaging.outboundTool(
      "agent-whatsapp-e2e",
      { threadId: "thread-whatsapp-e2e", turnId: "turn-whatsapp-e2e" },
      "messaging_history",
      { connection: connectionId(agents), ...args },
      () => Effect.succeed([]),
    ),
  );
  const text = result.contentItems[0]?.text ?? "";
  assert.ok(result.success, text);
  return JSON.parse(text);
}

async function postAs(agents: AgentService, agentId: string, place: string, text: string): Promise<void> {
  const result = await runCauseEffect(
    agents.messaging.outboundTool(
      agentId,
      { threadId: `thread-${agentId}`, turnId: `turn-${agentId}` },
      "messaging_post",
      { connection: connectionId(agents), place, text },
      () => Effect.succeed([]),
    ),
  );
  assert.ok(result.success, result.contentItems[0]?.text);
}

async function leadReply(
  agents: AgentService,
  mailbox: MailboxStore,
  lead: string,
  agentId: string,
  post: string,
): Promise<{ agentId: string; prompt: string }> {
  const messaging = agents.messaging;
  const jid = `${lead}@s.whatsapp.net`;
  await postAs(agents, agentId, `+${lead}`, post);
  assert.ok(phone.textsTo(jid).includes(post), "The agent's post did not reach the lead.");
  const reply = message({ chat: jid, text: "Yes, please send it." });
  phone.current().receive([reply]);
  await until(() => received(agents, jid, reply.key.id ?? ""), "the lead's reply in a mailbox");
  const link = messaging.store.linkByKey(connectionId(agents), jid, "dm");
  assert.ok(link, "No conversation for the lead's reply.");
  const request = mailbox.unresolvedMessagingDeliveries(link.linkId)[0];
  assert.ok(request, "No request waits in the lead's chat.");
  const prepared = await runCauseEffect(messaging.prepare({ delivery: request.delivery, managedAttachments: [] }));
  assert.equal(phone.textsTo(jid).length, 1, "OpenBot wrote more than the agent's post to the lead.");
  return { agentId: link.agentId, prompt: prepared?.text ?? "" };
}

const OLD_ID = "IN-OLD";
let oldCopy = "";

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

  await boot(async ({ agents, messaging, runtime, mailbox, database }) => {
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
      assert.equal(phone.current().config.browser?.[1], "OpenBot", "A QR link does not show as OpenBot.");
      const early = message({ chat: OWNER_JID, fromMe: true, text: "first message after the link" });
      phone.onOpen = early;
      phone.current().scan();
      const linked = await linkState(messaging, (state) => state.status === "linked", "the link");
      assert.equal(linked.workspaceId, OWNER);
      const sockets = phone.sockets.length;
      const live = await until(
        () => connection(messaging)?.state === "connected" && connection(messaging),
        "connected",
      );
      assert.equal(phone.sockets.length, sockets, "The connection opened a second socket after the link.");
      await until(
        () => phone.textsTo(OWNER_JID).some((text) => text.includes("Write here to ask your agents.")),
        "the welcome message in the owner's own chat",
      );
      await until(
        () => phone.textsTo(OWNER_JID).some((text) => text.includes("No agent can answer here yet")),
        "the answer to the message that came before the transport listened",
      );
      const answer = phone.sent.find(
        (sent) => sent.jid === OWNER_JID && "text" in sent.content && sent.content.text.includes("No agent can answer"),
      );
      assert.equal(answer?.quotedId, early.key.id, "The answer in the owner's own chat does not quote the message.");
      assert.equal(live.platform, "whatsapp");
      assert.ok(existsSync(storeFile(agents)), "The connection has no store file.");
      const account = messaging.whatsappOverview().accounts[0];
      assert.equal(account?.ownNumber, true);
      return { workspaceName: live.workspaceName, state: live.state };
    });

    await step("no orchestrator: an allowed contact gets no setup text from the owner's number (#11438)", async () => {
      const input = parseWhatsAppSenderInput({
        workspaceId: OWNER,
        sender: { id: FRIEND, kind: "contact", name: "Ewa" },
      });
      await runCauseEffect(messaging.addWhatsAppSender(input.workspaceId, input.sender));
      const friendJid = `${FRIEND}@s.whatsapp.net`;
      const ownBefore = phone.textsTo(OWNER_JID).filter((text) => text.includes("No agent can answer")).length;
      phone.current().receive([message({ chat: friendJid, text: "Is the meeting still on?" })]);
      phone.current().receive([message({ chat: OWNER_JID, fromMe: true, text: "marker 0" })]);
      await until(
        () => phone.textsTo(OWNER_JID).filter((text) => text.includes("No agent can answer")).length > ownBefore,
        "the notice in the owner's own chat",
      );
      assert.equal(phone.textsTo(friendJid).length, 0, "OpenBot wrote setup text to an allowed contact.");
      await runCauseEffect(messaging.removeWhatsAppSender(OWNER, input.sender.id));
      return { contactPosts: 0 };
    });

    await step("no orchestrator: a lead's reply to an agent's post reaches that agent (#9978)", async () => {
      await runCauseEffect(messaging.addWhatsAppSender(OWNER, { id: LEAD, kind: "contact", name: "Lead" }));
      const sales = await runCauseEffect(
        agents.createAgentProfile({
          name: "Sales",
          description: "Writes to leads.",
          avatarSeed: "sales",
          avatarHue: null,
        }),
      );
      const post = "Hello, do you still need the offer?";
      const reply = await leadReply(agents, mailbox, LEAD, sales.id, post);
      assert.equal(reply.agentId, sales.id, "The reply did not reach the agent that posted.");
      assert.ok(reply.prompt.includes(`OpenBot, a post of yours: ${post}`), "The agent does not see its own post.");
      await runCauseEffect(messaging.removeWhatsAppSender(OWNER, LEAD));
      await postAs(agents, sales.id, OWNER_JID, "Your morning report.");
      const notices = () => phone.textsTo(OWNER_JID).filter((text) => text.includes("No agent can answer")).length;
      const before = notices();
      phone.current().receive([message({ chat: OWNER_JID, fromMe: true, text: "Thanks, and the leads?" })]);
      await until(() => notices() > before, "the setup text in the owner's own chat");
      assert.equal(
        agents.messaging.store.linkByKey(connectionId(agents), OWNER_JID, "dm"),
        null,
        "An agent's post took the owner's own chat.",
      );
      return { agent: "Sales", ownChat: "setup text" };
    });

    await step("orchestrator: one WhatsApp Orchestrator answers new conversations", async () => {
      const added = await runCauseEffect(messaging.addWhatsAppOrchestrator({}));
      const agent = agents.listAgents().find((candidate) => candidate.id === added.agentId);
      assert.equal(agent?.name, "WhatsApp Orchestrator");
      assert.equal(connection(messaging)?.orchestratorAgentId, added.agentId);
      return { agentId: added.agentId };
    });

    await step("orchestrator: a lead's reply to a teammate's post names the teammate (#9978)", async () => {
      await runCauseEffect(messaging.addWhatsAppSender(OWNER, { id: OTHER_LEAD, kind: "contact", name: "Lead" }));
      const sales = agents.listAgents().find((agent) => agent.name === "Sales");
      assert.ok(sales, "No Sales agent.");
      const post = "Hello, the offer is ready.";
      const reply = await leadReply(agents, mailbox, OTHER_LEAD, sales.id, post);
      assert.equal(
        reply.agentId,
        connection(messaging)?.orchestratorAgentId,
        "The orchestrator lost the conversation.",
      );
      assert.ok(
        reply.prompt.includes(`OpenBot, a post by your teammate Sales: ${post}`),
        "The orchestrator does not know which teammate wrote to the lead.",
      );
      await runCauseEffect(messaging.removeWhatsAppSender(OWNER, OTHER_LEAD));
      return { agent: "WhatsApp Orchestrator", teammate: "Sales" };
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
      const otherStatus = message({ chat: OWNER_JID, fromMe: true, text: "Working on it…\n\nReply stop to stop." });
      const otherAnswer = message({ chat: OWNER_JID, fromMe: true, text: `Here you go.\n${"\u2800".repeat(36)}` });
      phone.current().receive([otherStatus, otherAnswer]);
      const later = message({ chat: OWNER_JID, fromMe: true, text: "And tomorrow?" });
      phone.current().receive([later]);
      await until(() => received(agents, OWNER_JID, later.key.id ?? ""), "the later message");
      assert.equal(received(agents, OWNER_JID, own.id), false, "An own post was read as a request.");
      for (const other of [otherStatus, otherAnswer])
        assert.equal(received(agents, OWNER_JID, other.key.id ?? ""), false, "Another OpenBot's post was a request.");
      const told = () => phone.textsTo(OWNER_JID).filter((text) => text.startsWith("Another OpenBot is linked")).length;
      await until(() => told() === 1, "one notice about the other OpenBot");
      return { echoId: own.id, otherOpenBotNotices: told() };
    });

    await step(
      "held messages: after a wake, a synced number answers what WhatsApp held; a new link does not",
      async () => {
        const handle = runtime.get(credentials.get(connectionId(agents))?.storeId ?? "");
        assert.ok(handle, "No open store.");
        const journaled = (id: string | null | undefined) =>
          handle.store.unhandled().some((entry) => entry.dedupKey === `${OWNER_JID}:${id}`);
        const held = (text: string, minutesAgo: number) => {
          const sent = message({ chat: OWNER_JID, fromMe: true, text });
          sent.messageTimestamp = Math.floor((Date.now() - minutesAgo * 60_000) / 1_000);
          return sent;
        };
        const readUpTo = async (label: string) => {
          const marker = message({ chat: OWNER_JID, fromMe: true, text: label });
          phone.current().receive([marker]);
          await until(() => journaled(marker.key.id), label);
        };

        const history = held("from before the link", 5);
        phone.current().receive([history], "append");
        await readUpTo("a live message on the new link");
        assert.equal(journaled(history.key.id), false, "A new link answered a message from its history.");

        const sockets = phone.sockets.length;
        messaging.resume();
        await until(() => phone.sockets.length > sockets && connection(messaging)?.state === "connected", "the wake");
        const recent = held("written while the computer slept", 5);
        const old = held("written long before the wake", 30);
        phone.current().receive([old, recent], "append");
        await readUpTo("a live message after the wake");
        assert.equal(journaled(recent.key.id), true, "A message that WhatsApp held during the sleep was dropped.");
        assert.equal(journaled(old.key.id), false, "A message older than the held-message window was answered.");
        const saved = new Set(
          agents.messaging.history.recent(connectionId(agents), OWNER_JID, null, 200).map((entry) => entry.id),
        );
        assert.ok(saved.has(history.key.id ?? ""), "A message from the history of a new link was not saved.");
        assert.ok(saved.has(old.key.id ?? ""), "A message older than the held-message window was not saved.");
        return { history: false, recent: true, old: false, saved: true };
      },
    );

    await step("status post: a number with the setting off gets no “Working on it…” post", async () => {
      const link = agents.messaging.store.linkByKey(connectionId(agents), OWNER_JID, "dm");
      assert.ok(link, "No conversation for the owner's chat.");
      const request = mailbox.unresolvedMessagingDeliveries(link.linkId)[0];
      assert.ok(request, "No request waits in the owner's chat.");
      await runCauseEffect(mailbox.markStarting(request.delivery.id));
      const scope = Effect.runSync(Scope.make());
      const start = (turnId: string) =>
        agents.messaging.event({ type: "turn-started", agentId: link.agentId, threadId: link.threadId, turnId }, scope);
      const working = () =>
        phone.sent.filter(
          (sent) =>
            sent.jid === OWNER_JID &&
            "text" in sent.content &&
            typeof sent.content.text === "string" &&
            sent.content.text.includes("Working on it"),
        ).length;
      const before = working();
      assert.equal(messaging.whatsappOverview().accounts[0]?.workingMessage, true, "The post is not on by default.");
      await runCauseEffect(messaging.setWhatsAppWorkingMessage(OWNER, false));
      assert.equal(messaging.whatsappOverview().accounts[0]?.workingMessage, false);
      start("turn-without-status-post");
      await runCauseEffect(messaging.setWhatsAppWorkingMessage(OWNER, true));
      assert.equal(messaging.whatsappOverview().accounts[0]?.workingMessage, true);
      start("turn-with-status-post");
      await until(() => working() > before, "the “Working on it…” post");
      assert.equal(working(), before + 1, "A number with the setting off got a “Working on it…” post.");
      await runCauseEffect(mailbox.restoreQueued(request.delivery.id));
      return { posts: working() - before };
    });

    await step("failed turn: the chat gets the catalog reason, never the provider's own text (#11303)", async () => {
      const link = agents.messaging.store.linkByKey(connectionId(agents), OWNER_JID, "dm");
      assert.ok(link, "No conversation for the owner's chat.");
      const texts = () =>
        phone.sent.flatMap((sent) =>
          sent.jid === OWNER_JID && "text" in sent.content && typeof sent.content.text === "string"
            ? [sent.content.text]
            : [],
        );
      const failTurn = async (turnId: string, error: string) => {
        const request = mailbox.unresolvedMessagingDeliveries(link.linkId)[0];
        assert.ok(request, "No request waits in the owner's chat.");
        await runCauseEffect(mailbox.markStarting(request.delivery.id));
        const scope = Effect.runSync(Scope.make());
        const turn = { agentId: link.agentId, threadId: link.threadId, turnId };
        agents.messaging.event({ type: "turn-started", ...turn }, scope);
        await runCauseEffect(mailbox.markTerminal(request.delivery.id, "failed", error));
        agents.messaging.event({ type: "turn-completed", ...turn, status: "failed" }, scope);
      };
      const signIn = sourceText("error.provider.signInExpired", { provider: "Claude" });
      await failTurn("turn-sign-in-expired", signIn);
      await until(() => texts().includes(signIn), "the sign-in reason");
      const general = sourceText("status.messaging.failed");
      const generalPosts = () => texts().filter((text) => text === general).length;
      const before = generalPosts();
      await failTurn("turn-provider-text", "Claude Code failed: /home/ana/.claude/settings.json is not valid.");
      await until(() => generalPosts() > before, "the general text");
      assert.ok(!texts().some((text) => text.includes("/home/ana")), "The provider's own text reached WhatsApp.");
      const otherReason = message({ chat: OWNER_JID, fromMe: true, text: signIn });
      phone.current().receive([otherReason]);
      const later = message({ chat: OWNER_JID, fromMe: true, text: "after the other OpenBot's reason" });
      phone.current().receive([later]);
      await until(() => received(agents, OWNER_JID, later.key.id ?? ""), "the message after the other reason");
      assert.equal(
        received(agents, OWNER_JID, otherReason.key.id ?? ""),
        false,
        "Another OpenBot's reason was a request.",
      );
      for (let index = 1; mailbox.unresolvedMessagingDeliveries(link.linkId).length < 2; index += 1) {
        const again = message({ chat: OWNER_JID, fromMe: true, text: `request again ${index}` });
        phone.current().receive([again]);
        await until(() => received(agents, OWNER_JID, again.key.id ?? ""), `request again ${index}`);
      }
      return { reason: signIn, general };
    });

    await step("answer: an email address, a link and an asked password stay, and an API key is masked", async () => {
      const link = agents.messaging.store.linkByKey(connectionId(agents), OWNER_JID, "dm");
      assert.ok(link, "No conversation for the owner's chat.");
      const request = mailbox.unresolvedMessagingDeliveries(link.linkId)[0];
      assert.ok(request, "No request waits in the owner's chat.");
      await runCauseEffect(mailbox.markStarting(request.delivery.id));
      const scope = Effect.runSync(Scope.make());
      const turn = { agentId: link.agentId, threadId: link.threadId, turnId: "turn-answer-with-address" };
      agents.messaging.event({ type: "turn-started", ...turn }, scope);
      const answer =
        "Write to kontakt@example.pl or open https://wa.me/48500100200?text=Hi%20there. password=hunter2, key sk-ant-api03-e2efakekey";
      const snapshot = database.readConversation(link.agentId, link.threadId);
      snapshot.messages.push({
        id: `${turn.turnId}:answer`,
        turnId: turn.turnId,
        author: "assistant",
        text: answer,
        createdAt: new Date().toISOString(),
        status: "completed",
      });
      database.persistStreamingMessage({ snapshot, messageId: `${turn.turnId}:answer`, eventType: "item.completed" });
      await runCauseEffect(mailbox.markTerminal(request.delivery.id, "completed", null));
      agents.messaging.event({ type: "turn-completed", ...turn, status: "completed" }, scope);
      const expected =
        "Write to kontakt@example.pl or open https://wa.me/48500100200?text=Hi%20there. password=hunter2, key [redacted]";
      const texts = () =>
        phone.sent.flatMap((sent) =>
          sent.jid === OWNER_JID && "text" in sent.content && typeof sent.content.text === "string"
            ? [sent.content.text]
            : [],
        );
      await until(() => texts().some((text) => text.includes("kontakt")), "the answer");
      const posted = texts().find((text) => text.includes("kontakt"));
      assert.equal(posted, expected, "The answer changed on its way to WhatsApp.");
      assert.ok(!texts().some((text) => text.includes("e2efakekey")), "An API key reached WhatsApp.");
      for (let index = 1; mailbox.unresolvedMessagingDeliveries(link.linkId).length < 2; index += 1) {
        const again = message({ chat: OWNER_JID, fromMe: true, text: `answer request again ${index}` });
        phone.current().receive([again]);
        await until(() => received(agents, OWNER_JID, again.key.id ?? ""), `answer request again ${index}`);
      }
      return { posted };
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

    await step(
      "prompt: an allowed person on a personal number writes to the owner, not to the agent (#11470)",
      async () => {
        const strangerJid = `${STRANGER}@s.whatsapp.net`;
        const link = agents.messaging.store.linkByKey(connectionId(agents), strangerJid, "dm");
        assert.ok(link, "No conversation for the allowed person.");
        const request = mailbox.unresolvedMessagingDeliveries(link.linkId)[0];
        assert.ok(request, "No request waits in the allowed person's chat.");
        const prompt = async () =>
          (await runCauseEffect(agents.messaging.prepare({ delivery: request.delivery, managedAttachments: [] })))
            ?.text ?? "";
        const dedicated = await prompt();
        assert.ok(dedicated.includes("Place: a direct message to you."), "A dedicated number lost its own framing.");
        assert.ok(!dedicated.includes("message from the OpenBot user"), "A dedicated number answers as the owner.");
        await runCauseEffect(messaging.setWhatsAppOwnNumber(OWNER, true));
        try {
          const personal = await prompt();
          assert.ok(
            personal.includes("The person writes to the OpenBot user, not to you."),
            "The agent reads a message to the owner as a message to itself.",
          );
          assert.ok(
            personal.includes("WhatsApp shows your answer as a message from the OpenBot user."),
            "The agent does not know that its answer shows as the owner.",
          );
          assert.ok(!personal.includes("Place: a direct message to you."), "The personal number kept the bot framing.");
        } finally {
          await runCauseEffect(messaging.setWhatsAppOwnNumber(OWNER, false));
        }
        return { dedicated: "direct message to you", personal: "writes to the OpenBot user" };
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
        const ownerReply = message({
          chat: GROUP,
          fromMe: true,
          text: "@48600100200 I can bring dessert",
          mentions: [OWNER_JID],
        });
        phone.current().receive([chatter, ownerReply, mention]);
        await until(() => received(agents, GROUP, mention.key.id ?? ""), "the mention");
        assert.equal(
          received(agents, GROUP, chatter.key.id ?? ""),
          false,
          "A group message without a mention started work.",
        );
        assert.equal(
          received(agents, GROUP, ownerReply.key.id ?? ""),
          false,
          "The owner's group message started work.",
        );
        const groupHistory = agents.messaging.history.recent(connectionId(agents), GROUP, null, 200);
        assert.ok(
          groupHistory.some((entry) => entry.id === ownerReply.key.id),
          "The owner's message in an allowed group was not saved.",
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

    await step(
      "posts: one file takes the text as its caption, and a post lost with its socket goes again (#12211)",
      async () => {
        const folder = await mkdtemp(join(tmpdir(), "openbot-wa-post-"));
        const png = join(folder, "offer.png");
        writeFileSync(
          png,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        const post = (args: { text: string; files?: string[] }) =>
          runCauseEffect(
            agents.messaging.outboundTool(
              "agent-whatsapp-e2e",
              { threadId: "thread-whatsapp-e2e", turnId: "turn-whatsapp-e2e" },
              "messaging_post",
              { connection: connectionId(agents), place: GROUP, ...args },
              (paths) => Effect.succeed(paths.map(() => ({ name: "offer.png", path: png, mimeType: "image/png" }))),
            ),
          );
        const toGroup = (from: number) => phone.sent.slice(from).filter((sent) => sent.jid === GROUP);
        try {
          let from = phone.sent.length;
          const captioned = await post({ text: "**Offer**: 1.299 TL", files: ["offer.png"] });
          assert.ok(captioned.success, captioned.contentItems[0]?.text);
          const media = toGroup(from).filter((sent) => "image" in sent.content);
          assert.equal(media.length, 1, "The file was not sent once.");
          const content = media[0]?.content;
          assert.ok(
            content && "caption" in content && content.caption === "*Offer*: 1.299 TL",
            "The text is not the caption.",
          );
          assert.ok(!phone.textsTo(GROUP).includes("*Offer*: 1.299 TL"), "The text went apart from the file.");
          assert.ok(
            captioned.contentItems[0]?.text?.includes(media[0]?.id ?? "-"),
            "The result names another message.",
          );

          from = phone.sent.length;
          const long = "Long ".repeat(300).trim();
          const apart = await post({ text: long, files: ["offer.png"] });
          assert.ok(apart.success, apart.contentItems[0]?.text);
          const order = toGroup(from).filter(
            (sent) => "image" in sent.content || ("text" in sent.content && sent.content.text === long),
          );
          assert.deepEqual(
            order.map((sent) => ("image" in sent.content ? "file" : "text")),
            ["text", "file"],
          );

          phone.refused.set(GROUP, "463");
          from = phone.sent.length;
          const refusedPost = await post({ text: "Refused", files: ["offer.png"] }).finally(() =>
            phone.refused.delete(GROUP),
          );
          assert.equal(refusedPost.success, false, "A refused post counted as sent.");
          assert.ok(refusedPost.contentItems[0]?.text?.includes("whatsapp_463"), refusedPost.contentItems[0]?.text);
          assert.equal(
            toGroup(from).filter((sent) => "image" in sent.content || "text" in sent.content).length,
            1,
            "A refused post was sent again apart.",
          );

          const sockets = phone.sockets.length;
          phone.dropNext = GROUP;
          const resent = await post({ text: "Lost once" });
          assert.ok(resent.success, resent.contentItems[0]?.text);
          const lostId = phone.lost.at(-1)?.id;
          assert.ok(lostId, "No message was lost.");
          const again = phone.sent.filter((sent) => sent.jid === GROUP && sent.id === lostId);
          assert.equal(again.length, 1, "The lost text was not sent again with its id.");
          assert.ok(phone.sockets.length > sockets, "The socket did not close.");
          await until(() => connection(messaging)?.state === "connected", "connected after the lost post");
          return { captionId: media[0]?.id, resentId: lostId };
        } finally {
          phone.dropNext = null;
          await rm(folder, { recursive: true, force: true });
        }
      },
    );

    await step("HD photo: the normal copy gets an answer, and its HD copy gets none (#11764)", async () => {
      const author = `${FRIEND}@s.whatsapp.net`;
      const image: proto.IMessage = {
        imageMessage: {
          mimetype: "image/jpeg",
          caption: "@48600100200 what is on this photo?",
          contextInfo: { mentionedJid: [OWNER_JID] },
        },
      };
      const photo = (id: string): WAMessage => ({
        key: { remoteJid: GROUP, fromMe: false, id, participant: author },
        message: image,
        messageTimestamp: Math.floor(Date.now() / 1_000),
        pushName: "Ewa",
      });
      const hdCopy = (id: string, firstId: string): WAMessage => ({
        key: { remoteJid: GROUP, fromMe: false, id, participant: author },
        message: {
          messageContextInfo: {
            messageAssociation: {
              associationType: proto.MessageAssociation.AssociationType.HD_IMAGE_DUAL_UPLOAD,
              parentMessageKey: { remoteJid: GROUP, fromMe: false, id: firstId, participant: author },
            },
          },
          associatedChildMessage: { message: image },
        },
        messageTimestamp: Math.floor(Date.now() / 1_000),
        pushName: "Ewa",
      });
      phone.current().receive([photo("IN-HD-NORMAL")]);
      await until(() => phone.reactedTo("IN-HD-NORMAL"), "the answer to the normal copy");
      phone.current().receive([hdCopy("IN-HD-COPY", "IN-HD-NORMAL"), hdCopy("IN-HD-ALONE", "IN-HD-NEVER-SEEN")]);
      await until(() => phone.reactedTo("IN-HD-ALONE"), "the answer to the HD copy of an unread photo");
      assert.equal(phone.reactedTo("IN-HD-COPY"), false, "The HD copy got a second answer.");
      assert.equal(
        agents.messaging.store.linkByKey(connectionId(agents), GROUP, "IN-HD-COPY"),
        null,
        "The HD copy started a second conversation.",
      );
      return { normal: "answered", hdCopy: "skipped", hdCopyOfUnreadPhoto: "answered" };
    });

    await step(
      "saved history: the oldest copies go over the size limit, a delete for everyone deletes, an edit changes",
      async () => {
        const id = connectionId(agents);
        const author = `${FRIEND}@s.whatsapp.net`;
        const fileMessage = (messageId: string, fileName: string): WAMessage => ({
          key: { remoteJid: GROUP, fromMe: false, id: messageId, participant: author },
          message: { documentMessage: { fileName, mimetype: "text/plain", fileLength: 5, caption: messageId } },
          messageTimestamp: Math.floor(Date.now() / 1_000),
          pushName: "Ewa",
        });
        const change = (
          messageId: string,
          protocolMessage: proto.Message.IProtocolMessage,
          participant = author,
        ): WAMessage => ({
          key: { remoteJid: GROUP, fromMe: false, id: messageId, participant },
          message: { protocolMessage },
          messageTimestamp: Math.floor(Date.now() / 1_000),
          pushName: "Ewa",
        });
        const other = `${STRANGER}@s.whatsapp.net`;
        const savedText = (messageId: string) =>
          agents.messaging.history.recent(id, GROUP, null, 200).find((entry) => entry.id === messageId)?.text;
        phone.current().receive([fileMessage("IN-KEEP-1", "first.txt"), fileMessage("IN-KEEP-2", "second.txt")]);
        await until(() => savedText("IN-KEEP-2"), "the two saved file messages");
        const folder = runtime.filesPath(id);
        mkdirSync(folder, { recursive: true });
        const first = join(folder, "copy-first.txt");
        const second = join(folder, "copy-second.txt");
        writeFileSync(first, "first");
        writeFileSync(second, "secnd");
        assert.ok(agents.messaging.history.saveFilePath(id, GROUP, "IN-KEEP-1", `${GROUP}|IN-KEEP-1`, first, 5));
        assert.ok(agents.messaging.history.saveFilePath(id, GROUP, "IN-KEEP-2", `${GROUP}|IN-KEEP-2`, second, 5));
        assert.deepEqual(agents.messaging.history.trimFiles(id, 10), [], "Copies under the limit went.");
        assert.deepEqual(agents.messaging.history.trimFiles(id, 9), [first], "The oldest copy did not go first.");
        rmSync(first);
        const trimmed = await readHistory(agents, { place: GROUP, query: "IN-KEEP-1" });
        assert.deepEqual(trimmed.messages[0]?.files, [{ name: "first.txt" }], "A trimmed message kept its path.");

        phone.current().receive([
          change("EDIT-1", {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { remoteJid: GROUP, id: "IN-KEEP-1", participant: author },
            editedMessage: { conversation: "the first file, renamed" },
          }),
          change(
            "EDIT-FORGED",
            {
              type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
              key: { remoteJid: GROUP, id: "IN-KEEP-1", participant: author },
              editedMessage: { conversation: "forged" },
            },
            other,
          ),
          change(
            "REVOKE-FORGED",
            {
              type: proto.Message.ProtocolMessage.Type.REVOKE,
              key: { remoteJid: GROUP, id: "IN-KEEP-1", participant: author },
            },
            other,
          ),
          change("REVOKE-1", {
            type: proto.Message.ProtocolMessage.Type.REVOKE,
            key: { remoteJid: GROUP, id: "IN-KEEP-2", participant: author },
          }),
        ]);
        await until(() => savedText("IN-KEEP-1") === "the first file, renamed", "the edited text");
        await until(() => savedText("IN-KEEP-2") === undefined && !existsSync(second), "the deleted message");
        assert.equal(savedText("IN-KEEP-1"), "the first file, renamed", "Another member changed or deleted a message.");
        assert.equal(received(agents, GROUP, "EDIT-1"), false, "An edit started work.");
        assert.equal(received(agents, GROUP, "REVOKE-1"), false, "A delete for everyone started work.");
        return { trimmed: 1, edited: true, revoked: true };
      },
    );

    await step(
      "saved history: a group message without a mention is saved with its file, and query and before find it",
      async () => {
        const id = connectionId(agents);
        const fileMessage: WAMessage = {
          key: { remoteJid: GROUP, fromMe: false, id: "IN-FILE", participant: `${FRIEND}@s.whatsapp.net` },
          message: {
            documentMessage: { fileName: "plan.pdf", mimetype: "application/pdf", fileLength: 4, caption: "the plan" },
          },
          messageTimestamp: Math.floor(Date.now() / 1_000),
          pushName: "Ewa",
        };
        phone.current().receive([fileMessage]);
        await until(
          () => agents.messaging.history.recent(id, GROUP, null, 50).some((entry) => entry.id === "IN-FILE"),
          "the saved file message",
        );
        assert.equal(received(agents, GROUP, "IN-FILE"), false, "A group message without a mention started work.");
        const all = await readHistory(agents, { place: GROUP });
        const texts = all.messages.map((entry) => entry.text);
        assert.ok(texts.includes("lunch?"), "A group message without a mention was not saved.");
        assert.ok(texts.includes("and the changelog"), "A reply was not saved.");
        const lunch = await readHistory(agents, { place: GROUP, query: "LUNCH" });
        assert.deepEqual(
          lunch.messages.map((entry) => entry.text),
          ["lunch?"],
        );
        const byAuthor = await readHistory(agents, { place: GROUP, query: "ewa plan" });
        assert.equal(byAuthor.messages.length, 1, "The query did not match the author and the text.");
        assert.deepEqual(byAuthor.messages[0]?.files, [{ name: "plan.pdf" }]);
        const early = await readHistory(agents, { place: GROUP, before: "2000-01-01T00:00:00Z" });
        assert.equal(early.messages.length, 0, "before did not limit the read.");
        const late = await readHistory(agents, { place: GROUP, before: "2999-01-01T00:00:00+02:00" });
        assert.equal(late.messages.length, all.messages.length);
        const folder = runtime.filesPath(id);
        mkdirSync(folder, { recursive: true });
        const copy = join(folder, "copy-plan.pdf");
        writeFileSync(copy, "plan");
        assert.ok(agents.messaging.history.saveFilePath(id, GROUP, "IN-FILE", `${GROUP}|IN-FILE`, copy, 4));
        const withPath = await readHistory(agents, { place: GROUP, query: "plan" });
        assert.deepEqual(withPath.messages[0]?.files, [{ name: "plan.pdf", path: copy }]);
        const values = credentials.get(id);
        assert.ok(values);
        const adapter = whatsAppDriver({ runtime }).createAdapter(values, {
          connectionId: "whatsapp-e2e",
          rateLimited: () => {},
        });
        await runCauseEffect(adapter.identify());
        const destination = join(root, "downloaded-plan.pdf");
        await runCauseEffect(
          adapter.download(
            {
              id: `${GROUP}|IN-FILE`,
              name: "plan.pdf",
              mimeType: "application/pdf",
              size: 4,
              url: `${GROUP}|IN-FILE`,
            },
            destination,
            1_024,
          ),
        );
        assert.equal(readFileSync(destination, "utf8"), "plan", "The download did not use the saved copy.");
        oldCopy = join(folder, "copy-old.txt");
        writeFileSync(oldCopy, "old");
        const sentAt = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString();
        agents.messaging.history.save(
          id,
          GROUP,
          OLD_ID,
          FRIEND,
          {
            id: OLD_ID,
            authorName: "Ewa",
            text: "old news",
            sentAt,
            files: [
              {
                id: `${GROUP}|${OLD_ID}`,
                name: "old.txt",
                mimeType: "text/plain",
                size: 3,
                url: `${GROUP}|${OLD_ID}`,
                path: oldCopy,
              },
            ],
          },
          sentAt,
        );
        return { saved: all.messages.length, lunch: lunch.messages.length, copy: true };
      },
    );

    await step(
      "saved history: a group message that first arrives undecryptable is saved when it comes again",
      async () => {
        const id = connectionId(agents);
        const key = { remoteJid: GROUP, fromMe: false, id: "IN-RESENT", participant: `${FRIEND}@s.whatsapp.net` };
        const messageTimestamp = Math.floor(Date.now() / 1_000);
        phone.current().receive([
          {
            key,
            messageTimestamp,
            messageStubType: proto.WebMessageInfo.StubType.CIPHERTEXT,
            messageStubParameters: ["No SenderKeyRecord found for decryption"],
          },
        ]);
        phone.current().receive([{ key, messageTimestamp, message: { conversation: "coupon 10" }, pushName: "Ewa" }]);
        const saved = await until(
          () => agents.messaging.history.recent(id, GROUP, null, 200).find((entry) => entry.id === "IN-RESENT"),
          "the resent message",
        );
        assert.equal(saved.text, "coupon 10");
        return { saved: true };
      },
    );

    await step(
      "read only: a read-only group or contact is saved, starts no work, and OpenBot sends nothing to it",
      async () => {
        const id = connectionId(agents);
        const reader = "48600100800";
        const readerJid = `${reader}@s.whatsapp.net`;
        await runCauseEffect(messaging.addWhatsAppSender(OWNER, { id: reader, kind: "contact", name: "Reader" }));
        await runCauseEffect(messaging.setWhatsAppSenderReadOnly(OWNER, GROUP, true));
        await runCauseEffect(messaging.setWhatsAppSenderReadOnly(OWNER, reader, true));
        const modes = () =>
          new Map(
            (messaging.whatsappOverview().accounts[0]?.allowedSenders ?? []).map((sender) => [
              sender.id,
              sender.readOnly,
            ]),
          );
        assert.equal(modes().get(GROUP), true, "The group is not read only.");
        assert.equal(modes().get(reader), true, "The contact is not read only.");
        const from = phone.sent.length;
        const mention = message({
          chat: GROUP,
          participant: `${FRIEND}@s.whatsapp.net`,
          text: "@48600100200 we chose the blue logo",
          mentions: [OWNER_JID],
          pushName: "Ewa",
        });
        const direct = message({ chat: readerJid, text: "the client approved the blue logo", pushName: "Reader" });
        phone.current().receive([mention, direct]);
        const marker = message({ chat: OWNER_JID, fromMe: true, text: "marker read only" });
        phone.current().receive([marker]);
        await until(() => phone.reactedTo(marker.key.id), "the marker");
        await until(
          () => agents.messaging.history.recent(id, GROUP, null, 200).some((entry) => entry.id === mention.key.id),
          "the saved mention",
        );
        await until(
          () => agents.messaging.history.recent(id, readerJid, null, 200).some((entry) => entry.id === direct.key.id),
          "the saved direct message",
        );
        assert.equal(
          received(agents, GROUP, mention.key.id ?? ""),
          false,
          "A mention in a read-only group started work.",
        );
        assert.equal(received(agents, readerJid, direct.key.id ?? ""), false, "A read-only contact started work.");
        const notes = join(root, "read-only-notes.txt");
        writeFileSync(notes, "notes");
        const tool = (name: string, args: { place?: string; text?: string; files?: string[] }) =>
          runCauseEffect(
            agents.messaging.outboundTool(
              "agent-whatsapp-e2e",
              { threadId: "thread-whatsapp-e2e", turnId: "turn-whatsapp-e2e" },
              name,
              { connection: id, ...args },
              (paths) => Effect.succeed(paths.map(() => ({ name: "notes.txt", path: notes, mimeType: "text/plain" }))),
            ),
          );
        const groupPost = await tool("messaging_post", { place: GROUP, text: "Noted." });
        const contactPost = await tool("messaging_post", { place: `+${reader}`, text: "Noted." });
        const filePost = await tool("messaging_post", { place: GROUP, files: ["notes.txt"] });
        for (const refused of [groupPost, contactPost, filePost]) {
          assert.equal(refused.success, false, "A post to a read-only chat was accepted.");
          assert.match(refused.contentItems[0]?.text ?? "", /read only/u);
        }
        const listed = JSON.parse((await tool("messaging_list_places", {})).contentItems[0]?.text ?? "{}");
        assert.ok(
          isDynamicRecord(listed) &&
            Array.isArray(listed.places) &&
            listed.places.some((place) => isDynamicRecord(place) && place.id === GROUP && place.readOnly === true),
          "The group is not marked read only in the places.",
        );
        const history = await readHistory(agents, { place: GROUP, query: "blue logo" });
        assert.deepEqual(
          history.messages.map((entry) => entry.text),
          ["@48600100200 we chose the blue logo"],
        );
        const elsewhere = phone.sent.slice(from).filter((sent) => sent.jid !== OWNER_JID);
        assert.deepEqual(elsewhere, [], "OpenBot sent something to a read-only chat.");
        await runCauseEffect(messaging.setWhatsAppSenderReadOnly(OWNER, GROUP, false));
        await runCauseEffect(messaging.removeWhatsAppSender(OWNER, reader));
        assert.equal(modes().get(GROUP), false, "The group does not give work again.");
        return { saved: 2, sent: elsewhere.length };
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

    await step("LID contacts: posts, edits and reactions to a contact with a LID go to the LID chat", async () => {
      const values = credentials.get(connectionId(agents));
      assert.ok(values);
      const adapter = whatsAppDriver({ runtime }).createAdapter(values, {
        connectionId: "whatsapp-e2e",
        rateLimited: () => {},
      });
      await runCauseEffect(adapter.identify());
      const target = { platformChannelId: `${LID_FRIEND}@s.whatsapp.net`, replyThreadId: null };
      const sentFrom = phone.sent.length;
      const status = await runCauseEffect(adapter.post(target, { text: "Working on it" }));
      await runCauseEffect(adapter.postAnswer(target, "Done", status));
      await runCauseEffect(adapter.react(target, "IN-LID-REACT", "done", true));
      const sent = phone.sent
        .slice(sentFrom)
        .filter((entry) => entry.jid === LID_FRIEND_CHAT || entry.jid === `${LID_FRIEND}@s.whatsapp.net`);
      assert.ok(
        sent.every((entry) => entry.jid === LID_FRIEND_CHAT),
        "A post to a contact with a LID went to the phone number, where WhatsApp may not deliver it.",
      );
      assert.ok(phone.textsTo(LID_FRIEND_CHAT).includes("Working on it"), "The status post did not go out.");
      const edit = sent.find((entry) => "edit" in entry.content && entry.content.edit?.id === status)?.content;
      assert.ok(
        edit && "edit" in edit && edit.edit?.remoteJid === LID_FRIEND_CHAT,
        "The answer did not edit the status post in the LID chat.",
      );
      const reaction = sent.find(
        (entry) => "react" in entry.content && entry.content.react.key?.id === "IN-LID-REACT",
      )?.content;
      assert.ok(
        reaction && "react" in reaction && reaction.react.key?.remoteJid === LID_FRIEND_CHAT,
        "The reaction names another chat.",
      );
      return { chat: LID_FRIEND_CHAT, posts: sent.length };
    });

    await step(
      "Brazilian numbers: a contact typed with the 9 gets work through the form that WhatsApp sends",
      async () => {
        const accountJid = `${BRAZIL_ACCOUNT}@s.whatsapp.net`;
        agents.messaging.store.addAllowedSender(connectionId(agents), {
          id: BRAZIL_TYPED,
          kind: "contact",
          name: "Bia",
        });
        const saved = message({ chat: accountJid, text: "oi, tudo bem?" });
        phone.current().receive([saved]);
        await until(() => received(agents, accountJid, saved.key.id ?? ""), "the message of the saved contact");
        const values = credentials.get(connectionId(agents));
        assert.ok(values);
        const adapter = whatsAppDriver({ runtime }).createAdapter(values, {
          connectionId: "whatsapp-e2e",
          rateLimited: () => {},
        });
        await runCauseEffect(adapter.identify());
        await runCauseEffect(
          adapter.postAnswer({ platformChannelId: accountJid, replyThreadId: null }, "Resposta", null),
        );
        await until(() => phone.textsTo(accountJid).includes("Resposta"), "the answer to the saved contact");
        agents.messaging.store.removeAllowedSender(connectionId(agents), BRAZIL_TYPED);
        const input = parseWhatsAppSenderInput({
          workspaceId: OWNER,
          sender: { id: "+55 31 9 8888-7777", kind: "contact", name: "Bia" },
        });
        await runCauseEffect(messaging.addWhatsAppSender(input.workspaceId, input.sender));
        const ids = messaging.whatsappOverview().accounts[0]?.allowedSenders.map((sender) => sender.id) ?? [];
        assert.ok(ids.includes(BRAZIL_ACCOUNT), "The contact was not saved in the form that WhatsApp has.");
        assert.ok(!ids.includes(BRAZIL_TYPED), "The contact was saved as typed.");
        const posted = await runCauseEffect(
          agents.messaging.outboundTool(
            "agent-whatsapp-e2e",
            { threadId: "thread-whatsapp-e2e", turnId: "turn-whatsapp-e2e" },
            "messaging_post",
            { connection: connectionId(agents), place: "+55 31 9 8888-7777", text: "Lembrete" },
            () => Effect.succeed([]),
          ),
        );
        assert.ok(posted.success, posted.contentItems[0]?.text);
        await until(() => phone.textsTo(accountJid).includes("Lembrete"), "the post to the typed number");
        return { saved: BRAZIL_ACCOUNT, postedTo: accountJid };
      },
    );

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
          rules: {
            ownNumber: true,
            contacts: new Map<string, string>(),
            groups: new Set<string>(),
            readOnly: new Set<string>(),
          },
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
      const adapter = whatsAppDriver({ runtime }).createAdapter(values, {
        connectionId: "whatsapp-e2e",
        rateLimited: () => {},
      });
      await runCauseEffect(adapter.identify());
      const refused = await Effect.runPromise(
        Effect.result(
          adapter.postAnswer({ platformChannelId: "48611111111@s.whatsapp.net", replyThreadId: null }, "hi", null),
        ),
      );
      assert.equal(refused._tag, "Failure", "A post to a chat that is not allowed went out.");
      const pending = await Effect.runPromise(
        Effect.result(
          adapter.postAnswer({ platformChannelId: "48600999901@s.whatsapp.net", replyThreadId: null }, "hi", null),
        ),
      );
      assert.equal(pending._tag, "Failure", "A post to a person who only got a pairing code went out.");
      const before = phone.textsTo(OWNER_JID).length;
      await runCauseEffect(
        adapter.edit({ platformChannelId: OWNER_JID, replyThreadId: null }, "UNKNOWN-POST", { text: "Updated" }),
      );
      await until(() => phone.textsTo(OWNER_JID).length === before + 1, "the edit as a new post");
      assert.equal(phone.textsTo(OWNER_JID).at(-1), "Updated", "A post in the owner's own chat has extra text.");
      const contactJid = `${STRANGER}@s.whatsapp.net`;
      await runCauseEffect(
        adapter.post({ platformChannelId: contactJid, replyThreadId: null }, { text: "To a contact" }),
      );
      await until(() => phone.textsTo(contactJid).includes("To a contact"), "the post to an allowed contact, as it is");
      return { refused: true, ownChatAsIs: true };
    });

    await step("adapter: a post that the server refuses in its ack fails, and is not reported as sent", async () => {
      const values = credentials.get(connectionId(agents));
      assert.ok(values);
      const adapter = whatsAppDriver({ runtime }).createAdapter(values, {
        connectionId: "whatsapp-e2e",
        rateLimited: () => {},
      });
      await runCauseEffect(adapter.identify());
      const contactJid = `${STRANGER}@s.whatsapp.net`;
      phone.refused.set(contactJid, "463");
      try {
        const sentFrom = phone.sent.length;
        const refused = await Effect.runPromise(
          Effect.result(adapter.postAnswer({ platformChannelId: contactJid, replyThreadId: null }, "Test", null)),
        );
        assert.ok(
          phone.sent.slice(sentFrom).some((sent) => sent.jid === contactJid),
          "The post never reached the server.",
        );
        assert.equal(refused._tag, "Failure", "A post that the server refused counted as sent.");
        const cause = refused._tag === "Failure" ? refused.failure.cause : null;
        assert.ok(cause instanceof WhatsAppRefusedError, "The failure does not say that WhatsApp refused the post.");
        assert.equal(cause.code, "whatsapp_463");
      } finally {
        phone.refused.delete(contactJid);
      }
      const accepted = await runCauseEffect(
        adapter.postAnswer({ platformChannelId: contactJid, replyThreadId: null }, "Accepted", null),
      );
      assert.ok(accepted, "A post with a clean ack did not return its id.");
      return { refusedCode: "whatsapp_463", acceptedId: accepted };
    });

    await step("adapter: an answer that mentions a person is a new post that notifies them", async () => {
      const values = credentials.get(connectionId(agents));
      assert.ok(values);
      const adapter = whatsAppDriver({ runtime }).createAdapter(values, {
        connectionId: "whatsapp-e2e",
        rateLimited: () => {},
      });
      await runCauseEffect(adapter.identify());
      const target = { platformChannelId: OWNER_JID, replyThreadId: null };
      const sentFrom = phone.sent.length;
      const quiet = await runCauseEffect(adapter.post(target, { text: "Working on it…" }));
      const quietText = `Done. Mail support@${FRIEND}.example, run \`ping @${FRIEND}\`.`;
      assert.equal(await runCauseEffect(adapter.postAnswer(target, quietText, quiet)), quiet);
      assert.ok(
        phone.sent.some((sent) => "edit" in sent.content && sent.content.edit?.id === quiet),
        "An answer without a mention did not edit the status post.",
      );
      const status = await runCauseEffect(adapter.post(target, { text: "Working on it…" }));
      const answerId = await runCauseEffect(adapter.postAnswer(target, `Done, @${FRIEND}.`, status));
      assert.notEqual(answerId, status, "An answer with a mention kept the edited status post.");
      const sent = phone.sent.slice(sentFrom);
      assert.ok(
        !sent.some((entry) => "edit" in entry.content && entry.content.edit?.id === status),
        "An answer with a mention was an edit, which notifies nobody.",
      );
      const deleted = sent.findIndex((entry) => "delete" in entry.content && entry.content.delete?.id === status);
      assert.ok(deleted >= 0, "The status post stayed above the answer.");
      const answerAt = sent.findIndex((entry) => entry.id === answerId);
      assert.ok(answerAt < deleted, "The status post was deleted before the answer was posted.");
      const answer = sent[answerAt];
      assert.ok(answer && "mentions" in answer.content, "The answer was not sent.");
      assert.deepEqual(answer.content.mentions, [`${FRIEND}@s.whatsapp.net`], "The answer did not list the person.");
      return { mentions: answer.content.mentions };
    });
  });

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
      const reactions = phone.reactionsTo(OWNER_JID);
      const strangerReactions = phone.reactionsTo(`${STRANGER}@s.whatsapp.net`);
      const marker = message({ chat: OWNER_JID, fromMe: true, text: "after restart" });
      phone.current().receive([marker]);
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

    await step("status reactions: a number with the setting off gets no reaction, and its posts stay", async () => {
      const busy = () => phone.textsTo(OWNER_JID).filter((text) => text.includes("Too many requests")).length;
      const posts = busy();
      assert.equal(messaging.whatsappOverview().accounts[0]?.statusReactions, true, "Reactions are not on by default.");
      await runCauseEffect(messaging.setWhatsAppStatusReactions(OWNER, false));
      assert.equal(messaging.whatsappOverview().accounts[0]?.statusReactions, false);
      const quiet = message({ chat: OWNER_JID, fromMe: true, text: "no reaction, please" });
      phone.current().receive([quiet]);
      await until(() => busy() === posts + 1, "the busy answer with reactions off");
      await runCauseEffect(messaging.setWhatsAppStatusReactions(OWNER, true));
      assert.equal(messaging.whatsappOverview().accounts[0]?.statusReactions, true);
      const loud = message({ chat: OWNER_JID, fromMe: true, text: "a reaction again" });
      phone.current().receive([loud]);
      await until(() => phone.reactedTo(loud.key.id), "the reaction with reactions on");
      assert.equal(phone.reactedTo(quiet.key.id), false, "A number with reactions off got a reaction.");
      return { busyPosts: busy() - posts };
    });

    await step(
      "saved history: the messages stay after a restart, and one older than 90 days goes with its file",
      async () => {
        await until(() => !existsSync(oldCopy), "the prune of the old message's file");
        const id = connectionId(agents);
        const saved = agents.messaging.history.recent(id, GROUP, null, 200);
        assert.ok(
          saved.some((entry) => entry.text === "lunch?"),
          "The saved messages went at the restart.",
        );
        assert.ok(!saved.some((entry) => entry.id === OLD_ID), "A message older than 90 days stayed.");
        const lunch = await readHistory(agents, { place: GROUP, query: "lunch" });
        assert.equal(lunch.messages.length, 1);
        return { saved: saved.length };
      },
    );

    await step(
      "loop guard: a loop in the owner's own chat pauses it, a burst does not, and stop goes through",
      async () => {
        const paused = () =>
          phone.textsTo(OWNER_JID).filter((text) => text.startsWith("OpenBot stopped answering here")).length;
        const handle = runtime.get(credentials.get(connectionId(agents))?.storeId ?? "");
        assert.ok(handle, "No open store.");
        const journaled = (chat: string, id: string | null | undefined) =>
          handle.store.unhandled().some((entry) => entry.dedupKey === `${chat}:${id}`);
        const mention = (text: string) =>
          message({
            chat: GROUP,
            participant: `${FRIEND}@s.whatsapp.net`,
            text: `@48600100200 ${text}`,
            mentions: [OWNER_JID],
          });
        const burst = Array.from({ length: 35 }, (_, index) =>
          message({ chat: OWNER_JID, fromMe: true, text: `note ${index}` }),
        );
        phone.current().receive(burst);
        const afterBurst = mention("after the burst");
        phone.current().receive([afterBurst]);
        await until(() => phone.reactedTo(afterBurst.key.id), "a group mention after the burst");
        assert.equal(paused(), 0, "A burst of messages paused the owner's own chat.");
        assert.equal(journaled(OWNER_JID, burst[0]?.key.id), true, "The burst did not go on as one request.");
        const start = Date.now() - 31 * 12_000;
        const loop = Array.from({ length: 31 }, (_, index) => {
          const sent = message({ chat: OWNER_JID, fromMe: true, text: `loop ${index}` });
          sent.messageTimestamp = Math.floor((start + index * 12_000) / 1_000);
          return sent;
        });
        phone.current().receive(loop);
        await until(() => paused() === 1, "the pause notice");
        await until(() => !journaled(OWNER_JID, loop[1]?.key.id), "the loop requests before the limit");
        const during = message({ chat: OWNER_JID, fromMe: true, text: "during the pause" });
        const stop = message({ chat: OWNER_JID, fromMe: true, text: "stop" });
        const marker = mention("during the pause");
        phone.current().receive([during]);
        phone.current().receive([stop]);
        phone.current().receive([marker]);
        await until(() => phone.reactedTo(marker.key.id), "a group mention during the pause");
        assert.equal(journaled(OWNER_JID, during.key.id), false, "The paused chat took a request.");
        assert.equal(journaled(OWNER_JID, stop.key.id), true, "A stop request did not go through the pause.");
        assert.equal(journaled(OWNER_JID, loop.at(-1)?.key.id), false, "The loop went on past the limit.");
        assert.equal(paused(), 1, "The pause notice came more than once.");
        return { pauseNotices: paused() };
      },
    );
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

    await step("a cancelled pairing-code request that fails late leaves the next link alone", async () => {
      let release = () => {};
      phone.holdPairing = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waits = phone.pairingWaits;
      const done = phone.pairingDone;
      await runCauseEffect(
        messaging.startWhatsAppLink(
          parseStartWhatsAppLinkInput({ method: "code", phoneNumber: "+48 600 100 200", ownNumber: false }),
        ),
      );
      await until(() => phone.pairingWaits === waits + 1, "the held pairing-code request");
      await runCauseEffect(messaging.cancelWhatsAppLink());
      phone.holdPairing = null;
      await runCauseEffect(
        messaging.startWhatsAppLink(parseStartWhatsAppLinkInput({ method: "qr", ownNumber: false })),
      );
      await linkState(messaging, (state) => state.qr !== null, "the new link's QR code");
      release();
      await until(() => phone.pairingDone === done + 1, "the late failure of the old request");
      await new Promise((resolve) => setImmediate(resolve));
      const after = messaging.whatsappLinkState();
      assert.equal(after.status, "waiting", "The old request's late failure ended the new link.");
      assert.notEqual(after.qr, null);
      await runCauseEffect(messaging.cancelWhatsAppLink());
      return { status: after.status };
    });

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
        assert.equal(phone.current().config.browser?.[1], "Chrome", "A pairing-code link does not show as Chrome.");
        phone.current().scan();
        await linkState(messaging, (state) => state.status === "linked", "the second link");
        await until(() => connection(messaging)?.state === "connected", "connected after the second link");
        await until(
          () => phone.textsTo(OWNER_JID).some((text) => text.includes("can now write to this number")),
          "the welcome message of a number only for OpenBot",
        );
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
      const authors: Record<string, string> = {
        [OWNER_JID]: OWNER,
        [`${STRANGER}@s.whatsapp.net`]: STRANGER,
        [`${LID_FRIEND}@s.whatsapp.net`]: LID_FRIEND,
        [`${BRAZIL_ACCOUNT}@s.whatsapp.net`]: BRAZIL_ACCOUNT,
        [`${OTHER_LEAD}@s.whatsapp.net`]: OTHER_LEAD,
        [GROUP]: FRIEND,
      };
      for (const link of agents.messaging.store.links(orchestrator ?? ""))
        await runCauseEffect(agents.messaging.stop(link.linkId, authors[link.platformChannelId] ?? ""));
      await runCauseEffect(messaging.disconnectWhatsAppNumber(OWNER));
      assert.equal(phone.logouts, logouts + 1, "The device was not logged out.");
      assert.equal(existsSync(file), false, "The keys stayed on disk.");
      assert.equal(credentials.status(id), "missing");
      assert.equal(agents.messaging.history.recent(id, GROUP, null, 200).length, 0, "The saved messages stayed.");
      assert.equal(existsSync(runtime.filesPath(id)), false, "The saved files stayed.");
      assert.equal(connection(messaging), undefined);
      assert.ok(!agents.listAgents().some((agent) => agent.id === orchestrator), "The orchestrator stayed.");
      assert.ok(
        agents.messaging.store.allowedSenders(id).length > 0,
        "Disconnect removed the allowed senders, which a new link of the number gets back.",
      );
      return { disconnected: true };
    });
  });

  await step(
    "a socket that stops handling messages reconnects by itself, and stops after three stalls in an hour",
    async () => {
      let clock = Date.now();
      const store = WhatsAppAuthStore.open({ path: join(root, "stall.db"), key: newStoreKey(), now: () => clock });
      store.creds.me = { id: `${OWNER}:7@s.whatsapp.net` };
      store.saveCreds();
      const session = new WhatsAppSession({
        store,
        createSocket: phone.create,
        makeSignalRepository: () => {
          throw new Error("Not used by the fake socket.");
        },
        fetchVersion: async () => null,
        now: () => clock,
      });
      const advance = (ms: number) => {
        clock += ms;
        phone.current().keepAlive();
      };
      const stall = async (label: string) => {
        const socket = phone.current();
        socket.stallNode();
        advance(5 * 60_000);
        await until(() => socket.ended, label, 20_000);
      };
      try {
        session.start();
        await until(() => session.state === "open", "the first socket open");
        await stall("a stalled node ends its socket");
        await until(() => session.state === "open", "a new socket after the first stall");

        phone.holdAcks = true;
        const unconfirmed = phone.current();
        const posted = await runCauseEffect(session.send(OWNER_JID, { text: "not confirmed" }));
        phone.holdAcks = false;
        assert.ok(posted.key.id, "The unconfirmed post failed.");
        await until(() => unconfirmed.ended && session.state === "open", "a new socket after an unconfirmed post");

        await stall("a second stalled node ends its socket");
        await until(() => session.state === "open", "a new socket after the second stall");
        await stall("a third stalled node ends its socket");
        await until(() => session.state === "failing", "Needs attention after three stalls in an hour");

        session.reconnect();
        await until(() => session.state === "open", "connected after a wake");
        await stall("a stall after the wake ends its socket");
        await until(() => session.state === "open", "a new socket after a stall that follows the wake");

        await runCauseEffect(session.stop());
        session.start();
        await until(() => session.state === "open", "connected after Reconnect");
        return {
          states: [
            "open after a stall",
            "open after an unconfirmed post, which does not count",
            "open after the second stall",
            "failing after the third stall",
            "open after a wake, and after one more stall",
            "open after Reconnect",
          ],
        };
      } finally {
        await runCauseEffect(session.stop());
        store.close();
      }
    },
  );

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`WhatsApp connector check passed. Report: ${REPORT}\n`);
