// Checks the media part of the Telegram account connection without Telegram: how a message's
// attachment is described to agents and named on disk (GramJS's own Api classes), which files an
// agent may send, and the two media tools of the real loopback MCP server, called over HTTP by the
// MCP SDK client with tools that stand in for the connection.
//
// Cases: photo, voice, audio, video, round video, GIF, sticker and file attachments; a message with
// no file; file names that try to leave the chat folder; the path checks of telegram_send_file
// (relative, missing, a folder, empty, OpenBot's data, a link into it, a hidden home folder, a
// normal file); telegram_download_media with an image returned inline, a large image and a voice
// message returned as JSON only; telegram_send_file argument decoding.
//
// `bun scripts/telegram-account-media-e2e.ts`. Writes .openbot-build/telegram-account-media-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Exit } from "effect";
import { Api } from "telegram";
import { returnBigInt } from "telegram/Helpers";
import { z } from "zod";
import { telegramFileToSend } from "../src/main/telegram-account-connector-service";
import { TelegramAccountToolError, telegramToolFailure } from "../src/main/telegram-account-effects";
import { attachmentFileName, messageAttachment } from "../src/main/telegram-account-format";
import {
  TelegramAccountMcpServer,
  type TelegramAccountMcpTools,
  type TelegramDownloadedMedia,
} from "../src/main/telegram-account-mcp-server";

const OUT = resolve(import.meta.dirname, "../.openbot-build/telegram-account-media-e2e");
const contentItem = z.object({
  type: z.string(),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
});

const cases: Array<{ name: string; ok: true }> = [];

async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  await run();
  cases.push({ name, ok: true });
  process.stdout.write(`ok - ${name}\n`);
}

function documentMessage(id: number, mimeType: string, size: number, attributes: Api.TypeDocumentAttribute[]) {
  return new Api.Message({
    id,
    peerId: new Api.PeerUser({ userId: returnBigInt(42) }),
    date: 1_790_000_000,
    message: "",
    media: new Api.MessageMediaDocument({
      document: new Api.Document({
        id: returnBigInt(id),
        accessHash: returnBigInt(7),
        fileReference: Buffer.alloc(0),
        date: 1_790_000_000,
        mimeType,
        size: returnBigInt(size),
        dcId: 2,
        attributes,
      }),
    }),
  });
}

function photoMessage(id: number): Api.Message {
  return new Api.Message({
    id,
    peerId: new Api.PeerUser({ userId: returnBigInt(42) }),
    date: 1_790_000_000,
    message: "look",
    media: new Api.MessageMediaPhoto({
      photo: new Api.Photo({
        id: returnBigInt(id),
        accessHash: returnBigInt(7),
        fileReference: Buffer.alloc(0),
        date: 1_790_000_000,
        dcId: 2,
        sizes: [
          new Api.PhotoSize({ type: "m", w: 320, h: 240, size: 18_000 }),
          new Api.PhotoSizeProgressive({ type: "y", w: 1280, h: 960, sizes: [20_000, 90_000, 181_234] }),
        ],
      }),
    }),
  });
}

async function attachments(): Promise<void> {
  await check("a photo is described with its largest size", () => {
    const message = photoMessage(10);
    const attachment = messageAttachment(message);
    assert.deepEqual(attachment, {
      kind: "photo",
      file_name: null,
      mime_type: "image/jpeg",
      size_bytes: 181_234,
      duration_seconds: null,
    });
    assert.equal(attachmentFileName(message, attachment), "10-photo.jpg");
  });

  await check("a voice message, audio, video and round video keep their duration", () => {
    const voice = documentMessage(11, "audio/ogg", 14_000, [
      new Api.DocumentAttributeAudio({ voice: true, duration: 12 }),
    ]);
    const voiceAttachment = messageAttachment(voice);
    assert.equal(voiceAttachment?.kind, "voice");
    assert.equal(voiceAttachment?.duration_seconds, 12);
    assert.equal(voiceAttachment && attachmentFileName(voice, voiceAttachment), "11-voice.ogg");

    const audio = documentMessage(12, "audio/mpeg", 3_000_000, [
      new Api.DocumentAttributeAudio({ duration: 180, title: "Song" }),
      new Api.DocumentAttributeFilename({ fileName: "song.mp3" }),
    ]);
    const audioAttachment = messageAttachment(audio);
    assert.equal(audioAttachment?.kind, "audio");
    assert.equal(audioAttachment?.file_name, "song.mp3");
    assert.equal(audioAttachment && attachmentFileName(audio, audioAttachment), "12-song.mp3");

    const video = documentMessage(13, "video/mp4", 5_000_000, [
      new Api.DocumentAttributeVideo({ duration: 30.4, w: 1280, h: 720 }),
    ]);
    assert.equal(messageAttachment(video)?.kind, "video");
    assert.equal(messageAttachment(video)?.duration_seconds, 30);

    const round = documentMessage(14, "video/mp4", 900_000, [
      new Api.DocumentAttributeVideo({ roundMessage: true, duration: 9, w: 384, h: 384 }),
    ]);
    assert.equal(messageAttachment(round)?.kind, "video_note");
  });

  await check("a GIF, a sticker and a file are told apart", () => {
    // Telegram puts the video attribute of a GIF before the animated one.
    const gif = documentMessage(15, "video/mp4", 200_000, [
      new Api.DocumentAttributeVideo({ duration: 2, w: 320, h: 240 }),
      new Api.DocumentAttributeAnimated(),
    ]);
    assert.equal(messageAttachment(gif)?.kind, "gif");

    const sticker = documentMessage(16, "image/webp", 30_000, [
      new Api.DocumentAttributeSticker({ alt: "🙂", stickerset: new Api.InputStickerSetEmpty() }),
      new Api.DocumentAttributeImageSize({ w: 512, h: 512 }),
    ]);
    assert.equal(messageAttachment(sticker)?.kind, "sticker");

    const file = documentMessage(17, "application/pdf", 120_000, [
      new Api.DocumentAttributeFilename({ fileName: "Faktura 11/2026.pdf" }),
    ]);
    const fileAttachment = messageAttachment(file);
    assert.deepEqual(fileAttachment, {
      kind: "document",
      file_name: "Faktura 11/2026.pdf",
      mime_type: "application/pdf",
      size_bytes: 120_000,
      duration_seconds: null,
    });
    assert.equal(fileAttachment && attachmentFileName(file, fileAttachment), "17-Faktura 11_2026.pdf");
  });

  await check("a file name cannot leave the chat folder", () => {
    for (const fileName of [
      "../../.ssh/authorized_keys",
      "..\\..\\evil.exe",
      "/etc/passwd",
      "....",
      `${"a".repeat(300)}.txt`,
    ]) {
      const message = documentMessage(18, "application/octet-stream", 10, [
        new Api.DocumentAttributeFilename({ fileName }),
      ]);
      const attachment = messageAttachment(message);
      assert.ok(attachment);
      const name = attachmentFileName(message, attachment);
      assert.ok(name.startsWith("18-"), name);
      assert.ok(!name.includes("/") && !name.includes("\\") && !name.slice(3).startsWith("."), name);
      assert.ok(name.length <= 3 + 120, name);
    }
  });

  await check("a message with no file has no attachment", () => {
    const text = new Api.Message({
      id: 19,
      peerId: new Api.PeerUser({ userId: returnBigInt(42) }),
      date: 1_790_000_000,
      message: "hello",
    });
    assert.equal(messageAttachment(text), null);
    const contact = new Api.Message({
      id: 20,
      peerId: new Api.PeerUser({ userId: returnBigInt(42) }),
      date: 1_790_000_000,
      message: "",
      media: new Api.MessageMediaGeo({ geo: new Api.GeoPointEmpty() }),
    });
    assert.equal(messageAttachment(contact), null);
  });
}

async function refusedWith(path: string, folders: { protected: string; home: string }, words: RegExp): Promise<void> {
  const exit = await Effect.runPromiseExit(telegramFileToSend(path, folders));
  assert.ok(Exit.isFailure(exit), `${path} was accepted`);
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  assert.ok(failure && failure._tag === "Fail");
  const { cause } = failure.error;
  assert.ok(cause instanceof TelegramAccountToolError, String(cause));
  assert.match(cause.message, words);
}

async function sendPaths(root: string): Promise<void> {
  const home = join(root, "home");
  const userData = join(root, "userData");
  const documents = join(home, "Documents");
  await mkdir(join(home, ".ssh"), { recursive: true });
  await mkdir(userData, { recursive: true });
  await mkdir(documents, { recursive: true });
  await writeFile(join(home, ".ssh", "id_ed25519"), "secret key");
  await writeFile(join(userData, "openbot-telegram-account-connector-v1.json"), "session");
  await writeFile(join(documents, "report.pdf"), "%PDF-1.7");
  await writeFile(join(documents, "empty.txt"), "");
  await symlink(join(userData, "openbot-telegram-account-connector-v1.json"), join(documents, "innocent.pdf"));
  const folders = { protected: userData, home };
  await check("telegram_send_file refuses paths it must not send", async () => {
    await refusedWith("report.pdf", folders, /not an absolute path/u);
    await refusedWith(join(documents, "missing.pdf"), folders, /No file at/u);
    await refusedWith(documents, folders, /is not a file/u);
    await refusedWith(join(documents, "empty.txt"), folders, /is empty/u);
    await refusedWith(join(userData, "openbot-telegram-account-connector-v1.json"), folders, /keeps keys/u);
    await refusedWith(join(documents, "innocent.pdf"), folders, /keeps keys/u);
    await refusedWith(join(home, ".ssh", "id_ed25519"), folders, /keeps keys/u);
    await refusedWith(join(documents, "..", ".ssh", "id_ed25519"), folders, /keeps keys/u);
  });
  await check("telegram_send_file takes a normal file and answers its real path", async () => {
    const real = await Effect.runPromise(telegramFileToSend(join(documents, ".", "report.pdf"), folders));
    assert.ok(real.endsWith(join("Documents", "report.pdf")), real);
  });
}

async function mcpTools(root: string): Promise<void> {
  const media = join(root, "media");
  await mkdir(media, { recursive: true });
  // A 1×1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(media, "1-photo.png"), png);
  await writeFile(join(media, "2-voice.ogg"), "OggS");
  const downloads: Record<number, TelegramDownloadedMedia> = {
    1: {
      path: join(media, "1-photo.png"),
      attachment: {
        kind: "photo",
        file_name: null,
        mime_type: "image/png",
        size_bytes: png.length,
        duration_seconds: null,
      },
    },
    2: {
      path: join(media, "2-voice.ogg"),
      attachment: { kind: "voice", file_name: null, mime_type: "audio/ogg", size_bytes: 4, duration_seconds: 3 },
    },
    3: {
      path: join(media, "1-photo.png"),
      attachment: {
        kind: "photo",
        file_name: null,
        mime_type: "image/jpeg",
        size_bytes: 9_000_000,
        duration_seconds: null,
      },
    },
  };
  const asked: Array<{ chat: string; messageId: number; maxBytes: number }> = [];
  const sent: Array<Parameters<TelegramAccountMcpTools["sendFile"]>[0]> = [];
  const tools: TelegramAccountMcpTools = {
    listChats: () => Effect.succeed({ chats: [] }),
    readMessages: () => Effect.succeed({ messages: [] }),
    searchMessages: () => Effect.succeed({ messages: [] }),
    sendMessage: () => Effect.succeed({}),
    markRead: () => Effect.succeed({}),
    downloadMedia: (options) => {
      asked.push(options);
      const found = downloads[options.messageId];
      return found ? Effect.succeed(found) : Effect.fail(telegramToolFailure("No such message."));
    },
    sendFile: (options) => {
      sent.push(options);
      return Effect.succeed({ chat: { id: options.chat }, message: { id: 99 } });
    },
  };
  const secret = "test-bearer-0123456789";
  const server = new TelegramAccountMcpServer({ secret: () => secret, tools, version: "0.0.0-test" });
  const port = await Effect.runPromise(server.start(null));
  const client = new Client({ name: "telegram-media-e2e", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport);
  try {
    await check("the MCP server lists the two media tools", async () => {
      const { tools: listed } = await client.listTools();
      const names = listed.map((tool) => tool.name);
      assert.ok(names.includes("telegram_download_media"));
      assert.ok(names.includes("telegram_send_file"));
      assert.equal(names.length, 7);
      const download = listed.find((tool) => tool.name === "telegram_download_media");
      assert.equal(download?.annotations?.readOnlyHint, true);
      const send = listed.find((tool) => tool.name === "telegram_send_file");
      assert.equal(send?.annotations?.readOnlyHint, false);
    });

    await check("a small image comes back as JSON and as an image", async () => {
      const result = await client.callTool({
        name: "telegram_download_media",
        arguments: { chat: "me", message_id: 1 },
      });
      assert.equal(result.isError, undefined);
      const content = z.array(contentItem).parse(result.content);
      assert.equal(content.length, 2);
      assert.equal(content[0]?.type, "text");
      assert.equal(content[1]?.type, "image");
      assert.equal(content[1]?.mimeType, "image/png");
      assert.equal(content[1]?.data, png.toString("base64"));
      assert.deepEqual(asked.at(-1), { chat: "me", messageId: 1, maxBytes: 50 * 1024 * 1024 });
    });

    await check("a voice message and a large image come back as JSON only", async () => {
      for (const id of [2, 3]) {
        const result = await client.callTool({
          name: "telegram_download_media",
          arguments: { chat: "-100123", message_id: id, max_mb: 20 },
        });
        const content = z.array(contentItem).parse(result.content);
        assert.equal(content.length, 1);
        const answer = z.object({ path: z.string() }).parse(JSON.parse(content[0]?.text ?? "null"));
        assert.equal(answer.path, downloads[id]?.path);
      }
      assert.equal(asked.at(-1)?.maxBytes, 20 * 1024 * 1024);
    });

    await check("telegram_send_file decodes its arguments", async () => {
      await client.callTool({ name: "telegram_send_file", arguments: { chat: "me", path: "/tmp/a.png" } });
      assert.deepEqual(sent.at(-1), { chat: "me", path: "/tmp/a.png", caption: null, kind: "auto", replyToId: null });
      await client.callTool({
        name: "telegram_send_file",
        arguments: { chat: "@anna", path: "/tmp/v.ogg", caption: "Hi", kind: "voice", reply_to_id: 5 },
      });
      assert.deepEqual(sent.at(-1), { chat: "@anna", path: "/tmp/v.ogg", caption: "Hi", kind: "voice", replyToId: 5 });
      const wrong = await client.callTool({
        name: "telegram_send_file",
        arguments: { chat: "me", path: "/tmp/a.png", kind: "hologram" },
      });
      assert.equal(wrong.isError, true);
      assert.equal(sent.length, 2);
    });
  } finally {
    await client.close();
    await Effect.runPromise(server.stop());
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-telegram-media-"));
try {
  await attachments();
  await sendPaths(root);
  await mcpTools(root);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`\n${cases.length} cases passed. Report: ${join(OUT, "report.json")}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
