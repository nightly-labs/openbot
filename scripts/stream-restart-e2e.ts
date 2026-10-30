// Run: bun scripts/stream-restart-e2e.ts
// Report: .openbot-build/stream-restart-e2e.json

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Effect, Result } from "effect";
import { restartActivityGeneration } from "../src/backend/restart-activity";
import type { TeamWebRtcBridge } from "../src/main/team-webrtc-bridge";
import { TeamWebRtcFileTransfer } from "../src/main/team-webrtc-file-transfer";

type BridgeEvents = TeamWebRtcBridge extends EventEmitter<infer Events> ? Events : never;

// No peer traffic is expected before the input stream ends.
class InertBridge extends EventEmitter<BridgeEvents> {
  sends = 0;

  readonly send: TeamWebRtcBridge["send"] = (..._input) => {
    this.sends += 1;
    return Effect.die(new Error("Unexpected peer traffic during disk spooling."));
  };

  readonly disconnectPeer: TeamWebRtcBridge["disconnectPeer"] = (..._input) =>
    Effect.die(new Error("Unexpected peer disconnect during disk spooling."));
}

async function waitForDiskBytes(directory: string, bytes: Buffer, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  let wake = () => {};
  let watcherError: Error | undefined;
  const watcher = watch(directory, () => wake());
  watcher.on("error", (error) => {
    watcherError = error;
    wake();
  });
  const onAbort = () => wake();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      // Register the next wake before reading, so a write during the read is not lost.
      const changed = new Promise<void>((resolve) => {
        wake = resolve;
      });
      signal.throwIfAborted();
      if (watcherError) throw watcherError;
      for (const filename of await readdir(directory)) {
        if (!filename.endsWith(".outgoing")) continue;
        const path = join(directory, filename);
        const written = await readFile(path);
        if (written.equals(bytes)) return path;
      }
      await changed;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    watcher.close();
  }
}

type StreamAction = "failure" | "stop";

interface ScenarioReport {
  action: StreamAction;
  bytesOnDisk: number;
  activeWhileWriting: boolean;
  generationBefore: number;
  generationDuring: number;
  inactiveAfterCleanup: boolean;
  temporaryFileRemoved: boolean;
  peerFrames: number;
}

interface StreamRestartReport {
  status: "failed" | "passed";
  scenarios: ScenarioReport[];
  error?: string;
}

async function checkWriting(directory: string, action: StreamAction): Promise<ScenarioReport> {
  await mkdir(directory);
  const bridge = new InertBridge();
  const service = new TeamWebRtcFileTransfer(bridge, directory);
  const input = new PassThrough();
  const bytes = Buffer.from(`Held stream for ${action}.`);
  const diskWait = new AbortController();
  const signal = AbortSignal.any([diskWait.signal, AbortSignal.timeout(10_000)]);
  const disk = waitForDiskBytes(directory, bytes, signal);
  const generationBefore = restartActivityGeneration();
  assert.equal(service.hasActiveTransfers(), false, "The service must start idle.");
  const sending = Effect.runPromise(
    Effect.result(
      service.sendStream("held-peer", { name: "held.bin", mimeType: "application/octet-stream", body: input }),
    ),
  );
  input.write(bytes);
  try {
    const path = await disk;
    assert.deepEqual(await readFile(path), bytes, "The real temporary file must contain the input bytes.");
    assert.equal(input.readableEnded, false, "The external input must remain open.");
    assert.equal(service.hasActiveTransfers(), true, "Disk spooling must block a service restart.");
    const generationDuring = restartActivityGeneration();
    assert.ok(generationDuring > generationBefore, "Disk spooling must advance restart activity between polls.");
    assert.equal(bridge.sends, 0, "Spooling must not send peer frames.");

    const failure = new Error("External input failed during disk spooling.");
    if (action === "stop") {
      const stopping = Effect.runPromise(service.stop());
      // Release the external producer after stop requests cancellation.
      input.destroy(failure);
      await stopping;
    } else {
      input.destroy(failure);
    }
    const result = await sending;
    assert.ok(Result.isFailure(result), "The unfinished stream must fail.");
    if (action === "failure") assert.equal(result.failure.cause, failure);
    else {
      assert.ok(result.failure.cause instanceof Error, "Stop must report a pipeline error.");
      assert.equal(result.failure.cause.name, "AbortError", "Stop must cancel the disk pipeline.");
    }
    assert.equal(service.hasActiveTransfers(), false, "Cleanup must leave no active transfer.");
    assert.deepEqual(await readdir(directory), [], "Cleanup must remove the temporary outgoing file.");
    assert.equal(bridge.sends, 0);
    assert.equal(restartActivityGeneration(), generationDuring, "Cleanup must preserve the recorded activity.");
    await Effect.runPromise(service.stop());
    assert.equal(bridge.listenerCount("data"), 0);
    assert.equal(bridge.listenerCount("disconnected"), 0);
    return {
      action,
      bytesOnDisk: bytes.length,
      activeWhileWriting: true,
      generationBefore,
      generationDuring,
      inactiveAfterCleanup: true,
      temporaryFileRemoved: true,
      peerFrames: bridge.sends,
    };
  } finally {
    diskWait.abort();
    input.destroy();
    await disk.catch(() => undefined);
    await sending;
    await Effect.runPromise(service.stop());
  }
}

const artifactDirectory = new URL("../.openbot-build/", import.meta.url);
const report: StreamRestartReport = { status: "failed", scenarios: [] };
const directory = await mkdtemp(join(tmpdir(), "openbot-stream-restart-"));
try {
  report.scenarios.push(await checkWriting(join(directory, "failure"), "failure"));
  report.scenarios.push(await checkWriting(join(directory, "stop"), "stop"));
  report.status = "passed";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(new URL("stream-restart-e2e.json", artifactDirectory), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report)}\n`);
