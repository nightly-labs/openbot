// Run: bun scripts/webrtc-file-resume-e2e.ts
// Report: .openbot-build/webrtc-file-resume-e2e.json
//
// A sender resumes on the same connection after one chunk fails to send. The chunks that it sent
// before arrive late, so a periodic ack from the last attempt reaches it after its new `file-open`.
// It then sends again from that ack, before bytes that the receiver already has. The receiver must
// skip that overlap and finish the file.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
} from "@openbot/contracts/team-protocol/v2";
import { Effect, Result } from "effect";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import type { TeamWebRtcBridge } from "../src/main/team-webrtc-bridge";
import { TeamWebRtcFileTransfer } from "../src/main/team-webrtc-file-transfer";

type BridgeEvents = TeamWebRtcBridge extends EventEmitter<infer Events> ? Events : never;

const FILE_BYTES = 3 * 1024 * 1024;
// The chunks before this one hold more than one ack interval (1 MiB), so the receiver sends a periodic
// ack for them.
const FAILED_CHUNK_INDEX = 30;

/** Delivers frames to `target` in order. `hold` keeps frames back until `release`. */
class LinkedBridge extends EventEmitter<BridgeEvents> {
  target: LinkedBridge | null = null;
  #chain: Promise<void> = Promise.resolve();
  #onSend: (data: string | ArrayBuffer) => "fail" | "hold" | "release" | "send" = () => "send";
  #release: () => void = () => {};

  constructor(readonly selfId: string) {
    super();
  }

  setPolicy(onSend: (data: string | ArrayBuffer) => "fail" | "hold" | "release" | "send"): void {
    this.#onSend = onSend;
  }

  readonly send: TeamWebRtcBridge["send"] = (_peerId, channel, data) =>
    Effect.suspend(() => {
      const action = this.#onSend(data);
      if (action === "fail")
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("The channel did not take the frame.") }));
      if (action === "hold") {
        const held = new Promise<void>((resolve) => {
          this.#release = resolve;
        });
        this.#chain = this.#chain.then(() => held);
      }
      this.#chain = this.#chain.then(() => {
        this.target?.emit("data", this.selfId, channel, data);
      });
      if (action === "release") this.#release();
      return Effect.void;
    });

  readonly disconnectPeer: TeamWebRtcBridge["disconnectPeer"] = () => Effect.void;
}

interface ResumeReport {
  status: "failed" | "passed";
  fileBytes: number;
  failedChunkOffset: number | null;
  staleAcknowledgement: number | null;
  resentFrom: number | null;
  deliveredBeforeResume: number | null;
  receivedEqualsSent: boolean;
  error?: string;
}

const report: ResumeReport = {
  status: "failed",
  fileBytes: FILE_BYTES,
  failedChunkOffset: null,
  staleAcknowledgement: null,
  resentFrom: null,
  deliveredBeforeResume: null,
  receivedEqualsSent: false,
};

const directory = await mkdtemp(join(tmpdir(), "openbot-webrtc-file-resume-"));
const clientBridge = new LinkedBridge("client");
const hostBridge = new LinkedBridge("host");
clientBridge.target = hostBridge;
hostBridge.target = clientBridge;
const client = new TeamWebRtcFileTransfer(clientBridge, join(directory, "client"));
const host = new TeamWebRtcFileTransfer(hostBridge, join(directory, "host"));
client.setPeerAuthenticated("host", true);
host.setPeerAuthenticated("client", true);

// The first `file-open` goes through. The chunks after it wait in the channel, one chunk send fails,
// and the next `file-open` lets the waiting frames arrive, in order, before it.
let opens = 0;
let chunks = 0;
let highestSent = 0;
clientBridge.setPolicy((data) => {
  if (typeof data === "string") {
    if (decodeTeamProtocolV2FileControlFrame(data).type !== "file-open") return "send";
    opens += 1;
    if (opens === 1) return "send";
    if (opens === 2) {
      // The held frames arrive before this `file-open`, so the receiver has these bytes when it answers.
      report.deliveredBeforeResume = highestSent;
      return "release";
    }
    return "send";
  }
  const chunk = decodeTeamProtocolV2FileChunk(data);
  chunks += 1;
  if (chunks === FAILED_CHUNK_INDEX + 1) {
    report.failedChunkOffset = chunk.offset;
    return "fail";
  }
  if (opens === 2 && report.resentFrom === null) report.resentFrom = chunk.offset;
  highestSent = Math.max(highestSent, chunk.offset + chunk.bytes.byteLength);
  return opens === 1 && chunk.offset === 0 ? "hold" : "send";
});
hostBridge.setPolicy((data) => {
  if (typeof data === "string" && opens === 2 && report.staleAcknowledgement === null) {
    const frame = decodeTeamProtocolV2FileControlFrame(data);
    if (frame.type === "file-ack") report.staleAcknowledgement = frame.receivedThrough;
  }
  return "send";
});

const bytes = new Uint8Array(randomBytes(FILE_BYTES));
try {
  const sent = await Effect.runPromise(
    Effect.result(client.send("host", { name: "upload", mimeType: "application/zip", bytes })),
  );
  if (Result.isFailure(sent)) throw sent.failure.cause;
  const received = await Effect.runPromise(host.consume("client", sent.success));
  report.receivedEqualsSent = Buffer.from(received.bytes).equals(Buffer.from(bytes));
  const { failedChunkOffset, staleAcknowledgement, resentFrom, deliveredBeforeResume } = report;
  assert.ok(failedChunkOffset !== null, "One chunk send must fail, so the sender resumes.");
  assert.ok(deliveredBeforeResume !== null && resentFrom !== null, "The sender must resume.");
  assert.ok(staleAcknowledgement !== null, "A periodic ack must reach the sender after its new file-open.");
  assert.ok(staleAcknowledgement < deliveredBeforeResume, "That ack must be older than the bytes that arrived.");
  assert.equal(resentFrom, staleAcknowledgement, "The resumed sender must start at that ack.");
  assert.ok(report.receivedEqualsSent, "The host must get the same bytes.");
  report.status = "passed";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
} finally {
  await Effect.runPromise(client.stop());
  await Effect.runPromise(host.stop());
  await rm(directory, { recursive: true, force: true });
  const artifactDirectory = new URL("../.openbot-build/", import.meta.url);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(new URL("webrtc-file-resume-e2e.json", artifactDirectory), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report)}\n`);
