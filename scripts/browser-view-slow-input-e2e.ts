import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Deferred, Effect } from "effect";
import type { BrowserScreencastFrame, BrowserViewportInput } from "../src/backend/browser-cdp";
import { BrowserViewGateway } from "../src/main/browser-view-gateway";

const OUT = resolve(import.meta.dirname, "../.openbot-build/browser-view-slow-input-e2e");
const FRAME_SPACING_MS = 2;
const FRAMES_WHILE_INPUT_WAITS = 300;
const FRAMES_WHILE_INPUT_HANGS = 5_000;
const REMEMBERED_FRAME_LIMIT = 4096;
const LAG_REASON = "The live view fell too far behind.";

interface ViewRun {
  framesSent: number;
  framesReceived: number;
  closed: { code: number; reason: string } | null;
  dispatched: BrowserViewportInput[];
}

interface Report {
  passed: boolean;
  slowInputWithAcks?: ViewRun;
  noAcks?: ViewRun;
  hungInputWithAcks?: ViewRun;
  queuedClickX?: number;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function runView(options: { ack: boolean; holdFirstInput: boolean; frames?: number }): Promise<ViewRun> {
  const release = Deferred.makeUnsafe<void>();
  const dispatched: BrowserViewportInput[] = [];
  let emit: ((frame: BrowserScreencastFrame) => void) | null = null;
  const gateway = new BrowserViewGateway({
    authenticate: (token) => (token === "member-token" ? { id: "member" } : null),
    browser: {
      startView: (_tabId, onFrame) =>
        Effect.sync(() => {
          emit = onFrame;
          return () => Effect.void;
        }),
      dispatchViewInput: (_tabId, input) =>
        Effect.suspend(() => {
          dispatched.push(input);
          return dispatched.length === 1 && options.holdFirstInput ? Deferred.await(release) : Effect.void;
        }),
      copyViewSelection: () => Effect.succeed(null),
      answerViewDialog: () => Effect.void,
    },
  });
  const view = gateway.createSession({ memberId: "member", teamSessionId: "team-session", tabId: "tab" });
  const server = createServer();
  server.on("upgrade", (request, socket, head) =>
    gateway.handleUpgrade(request, socket, head, new URL(request.url ?? "/", "http://127.0.0.1")),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The test server listens on a port.");
  const client = new WebSocket(`ws://127.0.0.1:${address.port}${view.streamPath}?frameAck=1`, [
    "openbot-token.member-token",
  ]);
  client.binaryType = "arraybuffer";
  const run: ViewRun = { framesSent: 0, framesReceived: 0, closed: null, dispatched };
  let lastSequence = 0;
  let firstFrame: () => void = () => undefined;
  const firstFrameArrived = new Promise<void>((done) => {
    firstFrame = done;
  });
  let ending = false;
  client.addEventListener("close", (event) => {
    if (!ending) run.closed = { code: event.code, reason: event.reason };
  });
  client.addEventListener("message", (event) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    lastSequence = new DataView(event.data).getUint32(4);
    run.framesReceived += 1;
    firstFrame();
    if (options.ack) client.send(JSON.stringify({ type: "ack", sequence: lastSequence }));
  });
  await new Promise<void>((done) => client.addEventListener("open", () => done()));
  while (!emit) await pause(1);
  const sendFrame = (width: number) => {
    run.framesSent += 1;
    emit?.({ sequence: run.framesSent, width, height: 100, image: new Uint8Array(16) });
  };

  sendFrame(100);
  await firstFrameArrived;
  client.send(JSON.stringify({ type: "key", action: "down", key: "Enter", code: "Enter", text: "\r", modifiers: 0 }));
  client.send(
    JSON.stringify({
      type: "pointer",
      action: "down",
      x: 0.5,
      y: 0.5,
      sequence: lastSequence,
      button: "left",
      clickCount: 1,
      modifiers: 0,
    }),
  );
  for (let index = 0; index < (options.frames ?? FRAMES_WHILE_INPUT_WAITS) && !run.closed; index += 1) {
    sendFrame(200);
    await pause(FRAME_SPACING_MS);
  }
  if (!options.ack) {
    const deadline = Date.now() + 180_000;
    while (!run.closed && Date.now() < deadline) {
      sendFrame(200);
      await pause(50);
    }
  }
  Deferred.doneUnsafe(release, Effect.void);
  const settled = Date.now() + 2_000;
  while (options.holdFirstInput && !run.closed && dispatched.length < 2 && Date.now() < settled) await pause(5);
  ending = true;
  client.close();
  server.close();
  return run;
}

const report: Report = { passed: false };
try {
  report.slowInputWithAcks = await runView({ ack: true, holdFirstInput: true });
  assert.equal(report.slowInputWithAcks.closed, null, "A viewer that acknowledges each frame keeps its view open.");
  assert.ok(
    report.slowInputWithAcks.framesReceived > 200,
    "Frames continue to reach the viewer while a key waits for the page.",
  );
  const click = report.slowInputWithAcks.dispatched[1];
  assert.ok(click?.type === "pointer", "The click that waited behind the key reaches the page.");
  report.queuedClickX = click.x;
  assert.equal(click.x, 50, "The click uses the size of the frame that it was made on.");

  report.noAcks = await runView({ ack: false, holdFirstInput: false });
  assert.equal(report.noAcks.closed?.reason, LAG_REASON, "A viewer that stops acknowledging frames is closed.");

  report.hungInputWithAcks = await runView({ ack: true, holdFirstInput: true, frames: FRAMES_WHILE_INPUT_HANGS });
  assert.equal(
    report.hungInputWithAcks.closed?.reason,
    LAG_REASON,
    "A view whose input never reaches the page closes when its frame list is full.",
  );
  assert.equal(
    report.hungInputWithAcks.framesSent,
    REMEMBERED_FRAME_LIMIT + 1,
    "The frame list stops at its limit while an input waits for the page.",
  );

  report.passed = true;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`browser-view-slow-input-e2e passed: ${resolve(OUT, "report.json")}\n`);
