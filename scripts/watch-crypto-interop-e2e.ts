import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHostGrantKeyPair } from "@openbot/contracts/host-grant";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  openWatchRequest,
  sealWatchReply,
  verifyWatchProof,
  watchProofMessage,
  watchSealedDigest,
  watchTicketProofMessage,
} from "@openbot/contracts/signal-protocol/watch-relay";
import type { WatchCommand } from "@openbot/contracts/watch-protocol";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "watch-crypto-interop-e2e");
const BINARY = join(OUT, "watch-crypto-interop");
const SOURCES = [
  join(ROOT, "apps/mobile/targets/watch/WatchCrypto.swift"),
  join(ROOT, "scripts/watch-crypto-interop/main.swift"),
];

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface SwiftSealed {
  publicKey: string;
  restoredPublicKey: string;
  id: string;
  responseKey: string;
  sealed: string;
  digest: string;
  proofMessage: string;
  proof: string;
  ticketProofMessage: string;
  ticketProof: string;
}

interface SealInput {
  watchKey: string;
  hostId: string;
  ticketId: string;
  watchSessionId: string;
  command: string;
  ts: number;
}

interface OpenInput {
  responseKey: string;
  id: string;
  sealed: string;
}

interface StringifyInput {
  values: string[];
}

function swift<T>(mode: string, input: SealInput | OpenInput | StringifyInput, decode: (value: unknown) => T): T {
  const result = spawnSync(BINARY, [mode], { input: JSON.stringify(input), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Swift ${mode} failed: ${result.stderr}`);
  return decode(JSON.parse(result.stdout));
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string from Swift.");
  return value;
}

function decodeSealed(value: unknown): SwiftSealed {
  if (!isDynamicRecord(value)) throw new Error("Swift seal output is invalid.");
  return {
    publicKey: text(value.publicKey),
    restoredPublicKey: text(value.restoredPublicKey),
    id: text(value.id),
    responseKey: text(value.responseKey),
    sealed: text(value.sealed),
    digest: text(value.digest),
    proofMessage: text(value.proofMessage),
    proof: text(value.proof),
    ticketProofMessage: text(value.ticketProofMessage),
    ticketProof: text(value.ticketProof),
  };
}

function decodeOpened(value: unknown): { plaintext: string; openedWithWrongId: boolean } {
  if (!isDynamicRecord(value) || typeof value.openedWithWrongId !== "boolean") {
    throw new Error("Swift open output is invalid.");
  }
  return { plaintext: text(value.plaintext), openedWithWrongId: value.openedWithWrongId };
}

function decodeStrings(value: unknown): string[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.strings)) throw new Error("Swift stringify output is invalid.");
  return value.strings.map(text);
}

async function main() {
  if (process.platform !== "darwin") throw new Error("This check needs macOS and Xcode.");
  mkdirSync(OUT, { recursive: true });
  const compile = spawnSync("xcrun", ["swiftc", "-O", "-o", BINARY, ...SOURCES], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`swiftc failed:\n${compile.stderr}`);

  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(detail ? { detail } : {}) });

  const host = await createHostGrantKeyPair();
  const hostId = "host:Ab_9-é/x";
  const ticketId = "jti-0123456789abcdef";
  const watchSessionId = 'ws_/"quoted"\\ü';
  const ts = Date.now();
  const command: WatchCommand = {
    type: "send",
    serverId: "server-1",
    agentId: "agent/1",
    text: 'Hello "watch" / ü 😀 \n\t\u0001  ',
    messageId: "0b9f4c2e-1d3a-4c5b-8e7f-a1b2c3d4e5f6",
  };

  const sealedOut = swift(
    "seal",
    { watchKey: host.publicKey, hostId, ticketId, watchSessionId, command: JSON.stringify(command), ts },
    decodeSealed,
  );
  const { sealed, publicKey } = sealedOut;
  check("public key is 65-byte raw P-256 base64url", /^B[A-Za-z0-9_-]{86}$/u.test(publicKey));
  check("software key restores to the same public key", sealedOut.restoredPublicKey === publicKey);

  const opened = await openWatchRequest(host.privateKey, hostId, ticketId, sealed);
  check("TS opens a Swift-sealed request", true);
  check("request id matches", opened.id === sealedOut.id);
  check("request ts matches", opened.ts === ts);
  check("response key matches", opened.responseKey === sealedOut.responseKey);
  check("command matches", JSON.stringify(opened.command) === JSON.stringify(command));

  const wrongNonce = await openWatchRequest(host.privateKey, hostId, "other-jti", sealed).then(
    () => true,
    () => false,
  );
  check("wrong jti does not open the request", !wrongNonce);

  const digest = await watchSealedDigest(sealed);
  check("sealed digest matches", digest === sealedOut.digest);
  const proofMessage = watchProofMessage(hostId, ticketId, digest, ts);
  check("proof message bytes match JSON.stringify", proofMessage === sealedOut.proofMessage, proofMessage);
  check("TS verifies the Swift request proof", await verifyWatchProof(publicKey, proofMessage, sealedOut.proof));
  const ticketProofMessage = watchTicketProofMessage(watchSessionId, hostId, ts);
  check(
    "ticket proof message bytes match JSON.stringify",
    ticketProofMessage === sealedOut.ticketProofMessage,
    ticketProofMessage,
  );
  check(
    "TS verifies the Swift ticket proof",
    await verifyWatchProof(publicKey, ticketProofMessage, sealedOut.ticketProof),
  );
  check(
    "TS refuses the proof for another message",
    !(await verifyWatchProof(publicKey, `${proofMessage} `, sealedOut.proof)),
  );

  const reply = JSON.stringify({ ok: true, snapshot: '{"state":"ready","text":"ü 😀 / \\"x\\""}' });
  const sealedReply = await sealWatchReply(opened.responseKey, opened.id, reply);
  const openedOut = swift(
    "open",
    { responseKey: opened.responseKey, id: opened.id, sealed: sealedReply },
    decodeOpened,
  );
  check("Swift opens a TS-sealed reply", openedOut.plaintext === reply);
  check("Swift refuses the reply for another request id", openedOut.openedWithWrongId === false);

  const samples = ["plain", "a/b", 'q"uote', "back\\slash", "\u0000\u0001\u001f\u007f", "\b\f\n\r\t", "ü 😀    "];
  const strings = swift("stringify", { values: samples }, decodeStrings);
  check(
    "Swift JSON strings equal JSON.stringify",
    samples.every((sample, index) => strings[index] === JSON.stringify(sample)),
  );

  const passed = checks.every((item) => item.ok);
  const report = { generatedAt: new Date().toISOString(), passed, checks };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const item of checks) process.stdout.write(`${item.ok ? "PASS" : "FAIL"} ${item.name}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!passed) process.exit(1);
}

await main();
