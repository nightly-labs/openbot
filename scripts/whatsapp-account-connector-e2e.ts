// Checks the WhatsApp account connection end to end, without WhatsApp: the real service, store,
// encrypted files and loopback MCP server, with a client that stands in for Baileys and emits what
// Baileys emits (a QR code, the open connection, a removed device). An agent's MCP calls go over HTTP
// to the real server. The cipher is fake, so this does not open Keychain.
//
// Cases: a QR link that saves the device; the MCP server's host and bearer checks; reading and
// searching the chats; sending refused until the user turns it on, then sent; mark-read; a restart
// that keeps the device, the chats and the MCP port; a link with a phone number and a pairing code;
// a device that WhatsApp removed; unlink; and redaction of the phone number. Media: attachments in
// the messages that agents read, a download (with the image returned inline, no second download,
// the size limit), and the files that whatsapp_send_file takes or refuses.
//
// `bun scripts/whatsapp-account-connector-e2e.ts`. Writes .openbot-build/whatsapp-account-connector-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { proto } from "@whiskeysockets/baileys";
import { Effect } from "effect";
import { z } from "zod";
import type { SecretCipher } from "../src/main/provider-credential-store";
import {
  messageAttachment,
  newWhatsAppAuth,
  readWhatsAppStoredAuth,
  type WhatsAppAccountClientEvents,
  type WhatsAppOutgoingFile,
  type WhatsAppStoredAuth,
} from "../src/main/whatsapp-account-client";
import {
  WhatsAppAccountConnectorService,
  type WhatsAppClientLike,
  type WhatsAppClientModule,
} from "../src/main/whatsapp-account-connector-service";
import { WhatsAppAccountConnectorStore } from "../src/main/whatsapp-account-connector-store";
import { WhatsAppDataFile } from "../src/main/whatsapp-account-data-file";
import { whatsappAttachmentFileName, whatsappOutgoingFile } from "../src/main/whatsapp-account-files";
import type {
  WhatsAppHistory,
  WhatsAppStoredAttachment,
  WhatsAppStoredMessage,
} from "../src/main/whatsapp-account-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/whatsapp-account-connector-e2e");
const OWN_ID = "48600100200@s.whatsapp.net";
const FRIEND = "48600999888@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
// A 1×1 PNG, as the downloaded photo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PHOTO: WhatsAppStoredAttachment = {
  kind: "photo",
  fileName: null,
  mimeType: "image/png",
  size: PNG.length,
  seconds: null,
  media: "c2VjcmV0LW1lZGlhLWtleQ==",
};
const VOICE: WhatsAppStoredAttachment = {
  kind: "voice",
  fileName: null,
  mimeType: "audio/ogg; codecs=opus",
  size: 60 * 1024 * 1024,
  seconds: 12,
  media: "c2VjcmV0LXZvaWNlLWtleQ==",
};

const cipher: SecretCipher = {
  encrypt: (value) => Buffer.from(`fake:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
  decrypt: (value) => {
    const text = value.toString("utf8");
    if (!text.startsWith("fake:")) throw new Error("decrypt failed");
    return Buffer.from(text.slice("fake:".length), "base64").toString("utf8");
  },
};

/** A client that does what the service asks and records it. The test emits Baileys' events. */
class FakeClient implements WhatsAppClientLike {
  readonly events: WhatsAppAccountClientEvents;
  readonly history: WhatsAppHistory;
  readonly auth: WhatsAppStoredAuth;
  open = false;
  destroyed = false;
  loggedOut = false;
  readonly sent: Array<{ chat: string; text: string; replyTo: string | null }> = [];
  readonly read: Array<{ chat: string; ids: string[] }> = [];
  readonly pairingRequests: string[] = [];
  readonly downloads: string[] = [];
  readonly files: Array<{ chat: string; file: WhatsAppOutgoingFile; replyTo: string | null }> = [];

  constructor(options: { auth: WhatsAppStoredAuth; history: WhatsAppHistory; events: WhatsAppAccountClientEvents }) {
    this.events = options.events;
    this.history = options.history;
    this.auth = options.auth;
  }

  async start(): Promise<void> {}
  async whenOpen(): Promise<boolean> {
    return this.open;
  }
  isOpen(): boolean {
    return this.open;
  }
  async requestPairingCode(phone: string): Promise<string> {
    this.pairingRequests.push(phone);
    return "ABCD-1234";
  }
  async lookUp(phone: string): Promise<string | null> {
    return phone === "48600777666" ? `${phone}@s.whatsapp.net` : null;
  }
  async sendText(chat: string, text: string, replyTo: WhatsAppStoredMessage | null): Promise<WhatsAppStoredMessage> {
    this.sent.push({ chat, text, replyTo: replyTo?.id ?? null });
    const message: WhatsAppStoredMessage = {
      id: `SENT${this.sent.length}`,
      chat,
      sender: null,
      fromMe: true,
      pushName: null,
      at: 1_800_000_100 + this.sent.length,
      text,
      media: null,
      replyTo: replyTo?.id ?? null,
      edited: false,
      deleted: false,
      attachment: null,
    };
    this.history.upsertMessage(message);
    return message;
  }
  async sendFile(
    chat: string,
    file: WhatsAppOutgoingFile,
    replyTo: WhatsAppStoredMessage | null,
  ): Promise<WhatsAppStoredMessage> {
    this.files.push({ chat, file, replyTo: replyTo?.id ?? null });
    const message: WhatsAppStoredMessage = {
      id: `FILE${this.files.length}`,
      chat,
      sender: null,
      fromMe: true,
      pushName: null,
      at: 1_800_000_200 + this.files.length,
      text: file.caption ?? "",
      media: file.kind,
      replyTo: replyTo?.id ?? null,
      edited: false,
      deleted: false,
      attachment: null,
    };
    this.history.upsertMessage(message);
    return message;
  }
  async downloadMedia(message: WhatsAppStoredMessage, path: string): Promise<void> {
    this.downloads.push(message.id);
    await writeFile(path, PNG);
  }
  async markRead(chat: string, messages: readonly WhatsAppStoredMessage[]): Promise<void> {
    this.read.push({ chat, ids: messages.map((message) => message.id) });
    this.history.upsertChat({ id: chat, unread: { set: 0 } });
  }
  async fetchOlder(): Promise<boolean> {
    return false;
  }
  async logOut(): Promise<void> {
    this.loggedOut = true;
  }
  destroy(): void {
    this.destroyed = true;
    this.open = false;
  }

  /** WhatsApp accepted the device: the keys get an account, the phone sends history, the socket opens. */
  link(): void {
    this.auth.creds.registered = true;
    this.events.authChanged();
    this.history.upsertChat({ id: FRIEND, name: "Grace Hopper", kind: "private", unread: { set: 2 } });
    this.history.upsertChat({ id: GROUP, name: "Lab team", kind: "group" });
    const message = (id: string, chat: string, text: string, at: number, sender: string | null) =>
      this.history.upsertMessage({
        id,
        chat,
        sender,
        fromMe: sender === null,
        pushName: sender ? "Grace" : null,
        at,
        text,
        media: null,
        replyTo: null,
        edited: false,
        deleted: false,
        attachment: null,
      });
    message("M1", FRIEND, "Are we meeting on Friday?", 1_800_000_001, FRIEND);
    message("M2", FRIEND, "Yes, at 10.", 1_800_000_002, null);
    message("M3", FRIEND, "Bring the compiler notes.", 1_800_000_003, FRIEND);
    message("M4", FRIEND, "And the Friday agenda.", 1_800_000_004, FRIEND);
    message("G1", GROUP, "Release on Friday", 1_800_000_010, FRIEND);
    // The user's own photo and voice message in the group, before G1, so G1 stays unread.
    const own = {
      chat: GROUP,
      sender: null,
      fromMe: true,
      pushName: null,
      replyTo: null,
      edited: false,
      deleted: false,
    };
    this.history.upsertMessage({
      ...own,
      id: "P1",
      at: 1_800_000_005,
      text: "The plan",
      media: "image",
      attachment: PHOTO,
    });
    this.history.upsertMessage({
      ...own,
      id: "V1",
      at: 1_800_000_006,
      text: "",
      media: "voice message (12s)",
      attachment: VOICE,
    });
    this.open = true;
    this.events.open({ id: OWN_ID, name: "Ada Lovelace" });
  }
}

interface Harness {
  service: WhatsAppAccountConnectorService;
  clients: FakeClient[];
  accessChanges: number;
}

async function harness(root: string, work: string): Promise<Harness> {
  const clients: FakeClient[] = [];
  // The real keys and their real storage; only the connection to WhatsApp is a stand-in.
  const module: WhatsAppClientModule = {
    newWhatsAppAuth,
    readStoredAuth: readWhatsAppStoredAuth,
    createClient: (options) => {
      const client = new FakeClient(options);
      clients.push(client);
      return client;
    },
  };
  const service = new WhatsAppAccountConnectorService({
    store: new WhatsAppAccountConnectorStore(join(root, "connector.json"), cipher),
    authFile: new WhatsAppDataFile({ path: join(root, "keys.json"), cipher, maxBytes: 1024 * 1024, delayMs: 10 }),
    historyFile: new WhatsAppDataFile({ path: join(root, "chats.json"), cipher, maxBytes: 1024 * 1024, delayMs: 10 }),
    appVersion: "0.0.0-e2e",
    mediaDirectory: join(work, "media"),
    protectedDirectory: root,
    homeDirectory: join(work, "home"),
    loadClient: () => Effect.succeed(module),
  });
  const result: Harness = { service, clients, accessChanges: 0 };
  service.onAgentAccessChanged(() => {
    result.accessChanges += 1;
  });
  await Effect.runPromise(service.load());
  return result;
}

/** Waits until `check` holds, for a change that an event or a delayed write makes. */
async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setImmediate(done));
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

const toolAnswer = z.object({
  result: z.object({
    content: z.array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
        data: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    ),
    isError: z.boolean().optional(),
  }),
});
const chatList = z.object({ chats: z.array(z.object({ id: z.string(), name: z.string(), unread_count: z.number() })) });
const messagePage = z.object({
  messages: z.array(z.object({ id: z.string(), from: z.string() })),
  has_more: z.boolean(),
});
const searchResults = z.object({ results: z.array(z.object({ id: z.string(), chat: z.object({ id: z.string() }) })) });

/** One MCP call over HTTP, as an agent makes it. */
async function mcp(
  service: WhatsAppAccountConnectorService,
  name: string,
  args: Record<string, string | number | boolean>,
  options: { bearer?: string | null; host?: string } = {},
): Promise<{ status: number; text: string; isError: boolean; images: string[] }> {
  const server = service.mcpServer();
  assert.ok(server, "the MCP server is given to agents");
  const bearer = options.bearer === undefined ? await Effect.runPromise(service.mcpAuthorization()) : options.bearer;
  const url = new URL(server.url);
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: options.host ?? url.host,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.text();
  if (response.status !== 200) return { status: response.status, text: body, isError: true, images: [] };
  const line = body.split("\n").find((item) => item.startsWith("data: ")) ?? `data: ${body}`;
  const parsed = toolAnswer.parse(JSON.parse(line.slice("data: ".length)));
  return {
    status: 200,
    text: parsed.result.content[0]?.text ?? "",
    isError: parsed.result.isError === true,
    images: parsed.result.content.flatMap((item) => (item.type === "image" && item.data ? [item.data] : [])),
  };
}

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-whatsapp-e2e-"));
const work = await mkdtemp(join(tmpdir(), "openbot-whatsapp-e2e-files-"));
try {
  const files = join(work, "files");
  await mkdir(files, { recursive: true });
  await mkdir(join(work, "home", ".ssh"), { recursive: true });
  await writeFile(join(files, "plan.png"), PNG);
  await writeFile(join(files, "notes.pdf"), "%PDF-1.7");
  await writeFile(join(files, "hello.ogg"), "OggS");
  await writeFile(join(work, "home", ".ssh", "id_ed25519"), "secret key");
  await symlink(join(root, "connector.json"), join(files, "innocent.pdf"));

  // 0. What Baileys' media messages become: the kind, the size and a media part without thumbnails
  // that still holds the address and the key; and how a file to send is shown.
  const media = { url: "https://mmg.whatsapp.net/x", directPath: "/v/t62/x", mediaKey: Buffer.alloc(32, 7) };
  const thumbnail = Buffer.alloc(4_000, 1);
  const image = messageAttachment({
    imageMessage: {
      ...media,
      mimetype: "image/jpeg",
      fileLength: 181_234,
      caption: "Look",
      jpegThumbnail: thumbnail,
      contextInfo: { stanzaId: "Q1" },
    },
  });
  assert.ok(image);
  assert.deepEqual(
    { ...image, media: "" },
    {
      kind: "photo",
      fileName: null,
      mimeType: "image/jpeg",
      size: 181_234,
      seconds: null,
      media: "",
    },
  );
  const decoded = proto.Message.decode(Buffer.from(image.media, "base64"));
  assert.equal(decoded.imageMessage?.directPath, "/v/t62/x");
  assert.deepEqual(Buffer.from(decoded.imageMessage?.mediaKey ?? []), media.mediaKey);
  assert.equal(decoded.imageMessage?.jpegThumbnail?.length ?? 0, 0);
  assert.ok(image.media.length < 400, "the media part stays small");
  const kinds = [
    messageAttachment({ audioMessage: { ...media, ptt: true, seconds: 12, mimetype: "audio/ogg; codecs=opus" } }),
    messageAttachment({ audioMessage: { ...media, seconds: 180, mimetype: "audio/mpeg" } }),
    messageAttachment({ videoMessage: { ...media, seconds: 30, mimetype: "video/mp4" } }),
    messageAttachment({ videoMessage: { ...media, gifPlayback: true, mimetype: "video/mp4" } }),
    messageAttachment({ ptvMessage: { ...media, seconds: 9, mimetype: "video/mp4" } }),
    messageAttachment({ stickerMessage: { ...media, mimetype: "image/webp" } }),
    messageAttachment({
      documentWithCaptionMessage: {
        message: { documentMessage: { ...media, fileName: "../Faktura 11/2026.pdf", mimetype: "application/pdf" } },
      },
    }),
  ];
  assert.deepEqual(
    kinds.map((item) => [item?.kind, item?.seconds ?? null]),
    [
      ["voice", 12],
      ["audio", 180],
      ["video", 30],
      ["gif", null],
      ["video_note", 9],
      ["sticker", null],
      ["document", null],
    ],
  );
  assert.equal(messageAttachment({ conversation: "hi" }), null);
  assert.equal(messageAttachment({ imageMessage: { caption: "no media yet" } }), null);
  const stored = (id: string, attachment: WhatsAppStoredAttachment): string =>
    whatsappAttachmentFileName(
      {
        id,
        chat: FRIEND,
        sender: FRIEND,
        fromMe: false,
        pushName: null,
        at: 0,
        text: "",
        media: null,
        replyTo: null,
        edited: false,
        deleted: false,
        attachment,
      },
      attachment,
    );
  assert.equal(stored("3EB0", VOICE), "3EB0-voice.ogg");
  const documentAttachment = kinds[6];
  assert.ok(documentAttachment);
  assert.equal(stored("3EB1", documentAttachment), "3EB1-_Faktura 11_2026.pdf");
  assert.equal(stored("../../x", PHOTO), "_.._x-photo.png");
  const outgoing = ["a.JPG", "b.mp4", "c.mp3", "d.ogg", "e.pdf", "f.gif", "g"].map((name) => {
    const file = whatsappOutgoingFile(join(files, name), "auto");
    return typeof file === "string" ? file : [file.kind, file.mimeType];
  });
  assert.deepEqual(outgoing, [
    ["photo", "image/jpeg"],
    ["video", "video/mp4"],
    ["audio", "audio/mpeg"],
    ["audio", "audio/ogg; codecs=opus"],
    ["document", "application/pdf"],
    ["document", "image/gif"],
    ["document", "application/octet-stream"],
  ]);
  const attachments = { ok: true, kinds: kinds.length + 1 };

  // 1. A QR link saves the device, gives agents the tools, and keeps every file encrypted.
  const first = await harness(root, work);
  assert.equal(first.service.status().state, "disconnected");
  assert.equal(first.service.mcpServer(), null);
  await Effect.runPromise(first.service.connect({ method: "qr" }));
  const linkClient = first.clients[0];
  assert.ok(linkClient);
  linkClient.events.qr("2@first-qr");
  assert.equal(first.service.status().state, "qr");
  assert.equal(first.service.status().qrCode, "2@first-qr");
  linkClient.events.qr("2@second-qr");
  assert.equal(first.service.status().qrCode, "2@second-qr");
  linkClient.link();
  await until(() => first.service.status().state === "connected", "the link to finish");
  const connected = first.service.status();
  assert.equal(connected.account?.name, "Ada Lovelace");
  assert.equal(connected.account?.phone, "+4860***200");
  assert.equal(connected.sendingEnabled, false);
  assert.equal(first.accessChanges, 1);
  await until(
    async () => (await exists(join(root, "keys.json"))) && (await exists(join(root, "chats.json"))),
    "the files",
  );
  for (const file of ["connector.json", "keys.json", "chats.json"]) {
    const text = await readFile(join(root, file), "utf8");
    assert.ok(!text.includes("Grace") && !text.includes("48600100200"), `${file} is encrypted`);
  }
  const qrLink = { ok: true, state: connected.state, accessChanges: first.accessChanges };

  // 2. The MCP server takes only its own host and its bearer.
  const noBearer = await mcp(first.service, "whatsapp_list_chats", {}, { bearer: null });
  assert.equal(noBearer.status, 401);
  const wrongBearer = await mcp(first.service, "whatsapp_list_chats", {}, { bearer: "x".repeat(43) });
  assert.equal(wrongBearer.status, 401);
  const wrongHost = await mcp(first.service, "whatsapp_list_chats", {}, { host: "evil.example:80" });
  assert.equal(wrongHost.status, 403);
  const mcpChecks = {
    ok: true,
    noBearer: noBearer.status,
    wrongBearer: wrongBearer.status,
    wrongHost: wrongHost.status,
  };

  // 3. Agents list, read and search the chats on this computer. Reading marks nothing as read.
  const list = await mcp(first.service, "whatsapp_list_chats", { unread_only: true });
  assert.equal(list.isError, false);
  const listed = chatList.parse(JSON.parse(list.text));
  assert.deepEqual(
    listed.chats.map((chat) => [chat.id, chat.unread_count]),
    [[FRIEND, 2]],
  );
  const read = await mcp(first.service, "whatsapp_read_messages", { chat: "Grace", limit: 2 });
  const page = messagePage.parse(JSON.parse(read.text));
  assert.deepEqual(
    page.messages.map((message) => message.id),
    ["M3", "M4"],
  );
  assert.equal(page.has_more, true);
  assert.match(page.messages[0]?.from ?? "", /Grace Hopper/u);
  const older = messagePage.parse(
    JSON.parse((await mcp(first.service, "whatsapp_read_messages", { chat: FRIEND, before_id: "M3" })).text),
  );
  assert.deepEqual(
    older.messages.map((message) => message.id),
    ["M1", "M2"],
  );
  const search = searchResults.parse(
    JSON.parse((await mcp(first.service, "whatsapp_search_messages", { query: "friday" })).text),
  );
  assert.deepEqual(
    search.results.map((result) => result.id),
    ["G1", "M4", "M1"],
  );
  assert.equal(linkClient.read.length, 0);
  const reading = { ok: true, chats: listed.chats.length, searchResults: search.results.length };

  // 3b. Messages with a file have an attachment, without the key that downloads it. A download goes
  // to the chat's folder, returns a small image inline, and is not repeated.
  const groupRead = await mcp(first.service, "whatsapp_read_messages", { chat: "Lab team" });
  const groupPage = z
    .object({
      messages: z.array(
        z.object({
          id: z.string(),
          attachment: z.object({ kind: z.string(), size_bytes: z.number().nullable() }).nullable(),
        }),
      ),
    })
    .parse(JSON.parse(groupRead.text));
  assert.deepEqual(
    groupPage.messages.map((message) => [message.id, message.attachment?.kind ?? null]),
    [
      ["P1", "photo"],
      ["V1", "voice"],
      ["G1", null],
    ],
  );
  assert.ok(!groupRead.text.includes(PHOTO.media) && !groupRead.text.includes("c2VjcmV0"), "no media key for agents");
  const photo = await mcp(first.service, "whatsapp_download_media", { chat: GROUP, message_id: "P1" });
  assert.equal(photo.isError, false, photo.text);
  const photoPath = z.object({ path: z.string() }).parse(JSON.parse(photo.text)).path;
  assert.equal(photoPath, join(work, "media", "120363000000000001_g.us", "P1-photo.png"));
  assert.deepEqual(await readFile(photoPath), PNG);
  assert.deepEqual(photo.images, [PNG.toString("base64")]);
  await mcp(first.service, "whatsapp_download_media", { chat: "Lab team", message_id: "P1" });
  assert.deepEqual(linkClient.downloads, ["P1"]);
  const tooLarge = await mcp(first.service, "whatsapp_download_media", { chat: GROUP, message_id: "V1" });
  assert.equal(tooLarge.isError, true);
  assert.match(tooLarge.text, /more than max_mb/u);
  const voice = await mcp(first.service, "whatsapp_download_media", { chat: GROUP, message_id: "V1", max_mb: 100 });
  assert.equal(voice.isError, false, voice.text);
  assert.deepEqual(voice.images, []);
  assert.match(voice.text, /V1-voice\.ogg/u);
  const noFile = await mcp(first.service, "whatsapp_download_media", { chat: GROUP, message_id: "G1" });
  assert.equal(noFile.isError, true);
  assert.match(noFile.text, /has no file/u);
  const downloading = { ok: true, downloads: linkClient.downloads.length };

  // 4. Sending is off until the user turns it on; then a send needs the exact chat.
  const refused = await mcp(first.service, "whatsapp_send_message", { chat: FRIEND, text: "Hi" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /Sending is turned off/u);
  const refusedFile = await mcp(first.service, "whatsapp_send_file", { chat: FRIEND, path: join(files, "plan.png") });
  assert.match(refusedFile.text, /Sending is turned off/u);
  assert.equal(linkClient.sent.length, 0);
  await Effect.runPromise(first.service.setSending(true));
  const partial = await mcp(first.service, "whatsapp_send_message", { chat: "Grace", text: "Hi" });
  assert.equal(partial.isError, true);
  assert.equal(linkClient.sent.length, 0);
  const sent = await mcp(first.service, "whatsapp_send_message", {
    chat: "Grace Hopper",
    text: "On my way",
    reply_to_id: "M3",
  });
  assert.equal(sent.isError, false, sent.text);
  assert.deepEqual(linkClient.sent, [{ chat: FRIEND, text: "On my way", replyTo: "M3" }]);
  const unknownNumber = await mcp(first.service, "whatsapp_send_message", { chat: "+48 600 111 222", text: "Hi" });
  assert.equal(unknownNumber.isError, true);
  assert.match(unknownNumber.text, /has no WhatsApp account/u);
  const newNumber = await mcp(first.service, "whatsapp_send_message", { chat: "+48 600 777 666", text: "Hello" });
  assert.equal(newNumber.isError, false, newNumber.text);
  assert.equal(linkClient.sent.at(-1)?.chat, "48600777666@s.whatsapp.net");
  const sending = { ok: true, sent: linkClient.sent.length };

  // 4b. Files: the kind follows the extension, and paths that keep keys are refused.
  const photoSent = await mcp(first.service, "whatsapp_send_file", {
    chat: "Grace Hopper",
    path: join(files, ".", "plan.png"),
    caption: "The plan",
    reply_to_id: "M4",
  });
  assert.equal(photoSent.isError, false, photoSent.text);
  const pdfSent = await mcp(first.service, "whatsapp_send_file", { chat: FRIEND, path: join(files, "notes.pdf") });
  assert.equal(pdfSent.isError, false, pdfSent.text);
  const voiceSent = await mcp(first.service, "whatsapp_send_file", {
    chat: FRIEND,
    path: join(files, "hello.ogg"),
    kind: "voice",
  });
  assert.equal(voiceSent.isError, false, voiceSent.text);
  assert.deepEqual(
    linkClient.files.map(({ chat, file, replyTo }) => [chat, file.kind, file.mimeType, file.caption, replyTo]),
    [
      [FRIEND, "photo", "image/png", "The plan", "M4"],
      [FRIEND, "document", "application/pdf", null, null],
      [FRIEND, "voice", "audio/ogg; codecs=opus", null, null],
    ],
  );
  const refusals: Array<[Record<string, string>, RegExp]> = [
    [{ path: "plan.png" }, /not an absolute path/u],
    [{ path: join(files, "missing.png") }, /No file at/u],
    [{ path: join(root, "connector.json") }, /keeps keys or sessions/u],
    [{ path: join(files, "innocent.pdf") }, /keeps keys or sessions/u],
    [{ path: join(work, "home", ".ssh", "id_ed25519") }, /keeps keys or sessions/u],
    [{ path: join(files, "notes.pdf"), kind: "photo" }, /is not an image/u],
    [{ path: join(files, "hello.ogg"), kind: "voice", caption: "Hi" }, /no caption/u],
    [{ path: join(files, "plan.png"), kind: "hologram" }, /Invalid arguments/u],
  ];
  for (const [args, words] of refusals) {
    const answer = await mcp(first.service, "whatsapp_send_file", { chat: FRIEND, ...args });
    assert.equal(answer.isError, true, JSON.stringify(args));
    assert.match(answer.text, words, JSON.stringify(args));
  }
  assert.equal(linkClient.files.length, 3);
  const sendingFiles = { ok: true, sent: linkClient.files.length, refused: refusals.length };

  // 5. Mark-read sends receipts for the messages after the user's last one.
  const marked = await mcp(first.service, "whatsapp_mark_read", { chat: "Lab team" });
  assert.equal(marked.isError, false, marked.text);
  assert.deepEqual(linkClient.read, [{ chat: GROUP, ids: ["G1"] }]);
  const markRead = { ok: true, receipts: linkClient.read.length };

  // 6. A restart keeps the device, the chats, the switch and the MCP port and bearer.
  const port = new URL(first.service.mcpServer()?.url ?? "").port;
  const bearer = await Effect.runPromise(first.service.mcpAuthorization());
  await Effect.runPromise(first.service.dispose());
  const second = await harness(root, work);
  const restored = second.service.status();
  assert.equal(restored.state, "connected");
  assert.equal(restored.sendingEnabled, true);
  assert.equal(restored.history?.chats, 3);
  assert.equal(new URL(second.service.mcpServer()?.url ?? "").port, port);
  assert.equal(await Effect.runPromise(second.service.mcpAuthorization()), bearer);
  const afterRestart = messagePage.parse(
    JSON.parse((await mcp(second.service, "whatsapp_read_messages", { chat: FRIEND })).text),
  );
  assert.ok(afterRestart.messages.some((message) => message.id === "SENT1"));
  const restart = { ok: true, port, chats: restored.history?.chats };

  // 7. WhatsApp removed the device: the keys and chats go, the tools go, and the user is told.
  const restoredClient = second.clients[0];
  assert.ok(restoredClient);
  restoredClient.events.stopped("logged-out", "");
  await until(
    () => second.service.status().state === "disconnected" && second.accessChanges === 1,
    "the removed device",
  );
  assert.equal(second.service.status().error, sourceText("error.connector.whatsappAccountLoggedOut"));
  assert.equal(second.service.mcpServer(), null);
  assert.equal(second.accessChanges, 1);
  assert.equal(await exists(join(root, "keys.json")), false);
  assert.equal(await exists(join(root, "chats.json")), false);
  const notConnected = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer ?? ""}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "whatsapp_list_chats", arguments: {} },
    }),
  });
  assert.match(await notConnected.text(), /WhatsApp is not connected/u);
  const removed = { ok: true };

  // 8. A link with a phone number: a bad number is refused, a good one gets the pairing code, and
  // the number is masked in every log line.
  await Effect.runPromise(second.service.connect({ method: "phone" }));
  const phoneClient = second.clients.at(-1);
  assert.ok(phoneClient && phoneClient !== restoredClient);
  assert.equal(second.service.status().state, "connecting");
  phoneClient.events.qr("2@ignored");
  assert.equal(second.service.status().state, "phone");
  assert.equal(second.service.status().qrCode, null);
  const bad = await Effect.runPromise(second.service.submit({ field: "phone", value: "12" }));
  assert.equal(bad.error, sourceText("error.connector.whatsappAccountPhoneFormat"));
  const code = await Effect.runPromise(second.service.submit({ field: "phone", value: "+48 600 100 200" }));
  assert.equal(code.state, "code");
  assert.equal(code.pairingCode, "ABCD-1234");
  assert.deepEqual(phoneClient.pairingRequests, ["48600100200"]);
  assert.ok(!redactText("number 48600100200 and +48600100200").includes("48600100200"));
  phoneClient.link();
  await until(() => second.service.status().state === "connected", "the phone link");
  assert.equal(second.service.status().sendingEnabled, false);
  const phoneLink = { ok: true, pairingRequests: phoneClient.pairingRequests.length };

  // 9. Unlink logs the device out at WhatsApp and deletes it here.
  const unlinked = await Effect.runPromise(second.service.disconnect());
  assert.equal(unlinked.state, "disconnected");
  assert.equal(phoneClient.loggedOut, true);
  assert.equal(phoneClient.destroyed, true);
  assert.equal(await exists(join(root, "keys.json")), false);
  assert.equal(second.service.mcpServer(), null);
  const unlink = { ok: true };

  // 10. A cancel stops the link and its client.
  await Effect.runPromise(second.service.connect({ method: "qr" }));
  const cancelled = second.clients.at(-1);
  second.service.cancel();
  assert.equal(second.service.status().state, "disconnected");
  assert.equal(cancelled?.destroyed, true);
  await Effect.runPromise(second.service.dispose());
  const cancel = { ok: true };

  const cases = {
    attachments,
    qrLink,
    mcpChecks,
    reading,
    downloading,
    sending,
    sendingFiles,
    markRead,
    restart,
    removed,
    phoneLink,
    unlink,
    cancel,
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`whatsapp-account-connector-e2e: ${Object.keys(cases).length} cases passed\n`);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
}
