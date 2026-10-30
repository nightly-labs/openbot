// A live check of the WhatsApp client against WhatsApp's real servers. It needs the network.
//
// Stage 1 (always): a new device opens a socket with OpenBot's Signal code and the vendored Baileys,
// and WhatsApp sends a QR code. That proves the Noise handshake, X25519 and the check of WhatsApp's
// server certificate (XEdDSA) against the real servers. No phone is needed and nothing is linked.
//
// Stage 2 (manual, with `--link <peer number>`): the QR code shows in the terminal; scan it with a test
// phone (WhatsApp → Linked devices). The script then waits for a message from the peer phone, answers
// it, sends an image, closes and opens the session again from its store, and waits for one more
// message, which proves that the Signal sessions survive a restart. Use test numbers only.
//
// `bun scripts/whatsapp-live-smoke.ts [--link 48600100200]`
// Writes .openbot-build/whatsapp-live-smoke/report.json. The store is deleted at the end.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { newStoreKey } from "@openbot/whatsapp/auth-store";
import { makeWASocket, type WAMessage } from "@openbot/whatsapp/baileys";
import { makeOpenBotSignalRepository } from "@openbot/whatsapp/signal-repository";
import { Effect } from "effect";
import QRCode from "qrcode";
import { WhatsAppRuntime } from "../src/backend/messaging/whatsapp/whatsapp-runtime";

const logger = createOpenBotLogger("whatsapp-live-smoke");
const OUT = resolve(import.meta.dirname, "../.openbot-build/whatsapp-live-smoke");
const linkIndex = process.argv.indexOf("--link");
const peer = linkIndex > 0 ? (process.argv[linkIndex + 1] ?? "").replace(/[^0-9]/gu, "") : null;
const root = await mkdtemp(join(tmpdir(), "openbot-whatsapp-live-"));
interface LiveReport {
  stages: {
    handshake?: { qr: boolean };
    decrypt?: { text: boolean };
    send?: { text: boolean; image: boolean };
    restart?: { text: boolean };
    logout?: boolean;
  };
  passed: boolean;
}
const report: LiveReport = { stages: {}, passed: false };

const runtime = new WhatsAppRuntime({
  root,
  createSocket: (config) => makeWASocket(config),
  makeSignalRepository: makeOpenBotSignalRepository,
});

function waitFor<T>(subscribe: (done: (value: T) => void) => () => void, label: string, timeoutMs: number) {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`Timed out: ${label}.`));
    }, timeoutMs);
    const stop = subscribe((value) => {
      clearTimeout(timer);
      stop();
      resolvePromise(value);
    });
  });
}

function textOf(message: WAMessage): string {
  return message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? "";
}

try {
  const storeId = "live";
  const key = newStoreKey();
  const handle = runtime.open(storeId, key, true);
  handle.session.start();
  const qr = await waitFor<string>((done) => handle.session.onQr(done), "a QR code from WhatsApp", 60_000);
  report.stages.handshake = { qr: qr.length > 20 };
  logger.info("Stage 1 passed: WhatsApp sent a QR code.");

  if (peer) {
    process.stdout.write(`${await QRCode.toString(qr, { type: "terminal", small: true })}\n`);
    logger.info("Scan the code with the test phone: WhatsApp → Linked devices → Link a device.");
    await waitFor<void>(
      (done) =>
        handle.session.onState((state) => {
          if (state === "open" && handle.store.linked) done();
        }),
      "the link",
      180_000,
    );
    await Effect.runPromise(handle.session.stop());
    runtime.promote(storeId);
    handle.session.start();
    await waitFor<void>((done) => handle.session.onState((state) => state === "open" && done()), "the open", 60_000);
    const peerJid = `${peer}@s.whatsapp.net`;
    logger.info("Linked. Send a text message from the peer phone to the linked number.");
    const first = await waitFor<WAMessage>(
      (done) =>
        handle.session.onUpsert(({ messages }) => {
          const found = messages.find((message) => !message.key.fromMe && textOf(message));
          if (found) done(found);
        }),
      "a message from the peer",
      300_000,
    );
    report.stages.decrypt = { text: textOf(first).length > 0 };
    await Effect.runPromise(handle.session.send(peerJid, { text: "OpenBot live smoke: your message arrived." }));
    const image = Buffer.from(await QRCode.toBuffer("OpenBot live smoke"));
    await Effect.runPromise(handle.session.send(peerJid, { image, mimetype: "image/png", caption: "Image check" }));
    report.stages.send = { text: true, image: true };
    logger.info("Sent a text and an image. Check them on the peer phone.");

    await Effect.runPromise(handle.session.stop());
    runtime.close(storeId);
    const reopened = runtime.open(storeId, key);
    reopened.session.start();
    logger.info("Restarted from the store. Send one more message from the peer phone.");
    const second = await waitFor<WAMessage>(
      (done) =>
        reopened.session.onUpsert(({ messages }) => {
          const found = messages.find((message) => !message.key.fromMe && textOf(message));
          if (found) done(found);
        }),
      "a message after the restart",
      300_000,
    );
    report.stages.restart = { text: textOf(second).length > 0 };
    await Effect.runPromise(reopened.session.logout());
    report.stages.logout = true;
  }
  report.passed = true;
  assert.ok(report.passed);
} finally {
  for (const storeId of ["live"]) {
    const open = runtime.get(storeId);
    if (open) await Effect.runPromise(open.session.stop());
    runtime.delete(storeId);
  }
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
logger.info(`WhatsApp live smoke passed. Report: ${join(OUT, "report.json")}`);
process.exit(0);
