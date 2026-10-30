// A sign-in email must be sent again when the relay stalls before the message, and must not be sent
// twice when the relay stalls after it. Drives the real `sendPrivateEmailCode` over a local fake
// relay through the injected `SmtpConnector`:
// - a connection with no greeting whose close is never confirmed (production on 2026-10-23 and
//   2026-10-29), then a normal relay: the code is sent on the second connection;
// - a stall after `354`: the result is unknown and there is no second connection;
// - a normal relay: one connection, one message;
// - a relay that never answers: the last error is a timeout inside the delivery budget.
// `bun run test:smtp-stall`. Writes .openbot-build/smtp-stall-e2e.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket, connect as tcpConnect } from "node:net";
import { resolve } from "node:path";
import { Effect, Result } from "effect";
import {
  EMAIL_CODE_DELIVERY_BUDGET_MS,
  type SmtpConnector,
  sendPrivateEmailCode,
} from "../src/server/smtp-email-delivery";

const OUT = resolve(import.meta.dirname, "../../../.openbot-build/smtp-stall-e2e.json");
const CONFIG = {
  host: "relay.example.com",
  port: 465,
  username: "sender@example.com",
  password: "relay-password",
  from: "sender@example.com",
};

type Behavior = "normal" | "silent" | "stall_after_data";

interface CaseReport {
  name: string;
  result: string;
  connections: number;
  messages: number;
  elapsedMs: number;
}

interface Report {
  passed: boolean;
  cases: CaseReport[];
  failure?: string;
}

/**
 * A relay with one listener for each behavior. Connection `n` of the client goes to the listener of
 * `behaviors[n]`; the last item repeats. The client counts its connections, because other local
 * processes can probe a listening port.
 */
async function startRelay(behaviors: Behavior[]) {
  const sockets = new Set<Socket>();
  const stats = { connections: 0, messages: 0 };
  const servers = new Map<Behavior, Server>();
  for (const behavior of new Set(behaviors)) {
    // A half-open server does not end its side when the client ends, so the client close is not
    // confirmed. That is what a Worker socket did when the relay did not answer.
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      if (behavior !== "silent") serveSmtp(socket, behavior, stats);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    servers.set(behavior, server);
  }
  const connector: SmtpConnector = (target) => {
    assert.equal(target.port, 465);
    const behavior = behaviors[Math.min(stats.connections, behaviors.length - 1)];
    stats.connections += 1;
    const address = behavior && servers.get(behavior)?.address();
    assert(address && typeof address === "object");
    const socket = tcpConnect(address.port, "127.0.0.1");
    return {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          socket.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          socket.on("end", () => controller.close());
          socket.on("error", (error) => controller.error(error));
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write: (chunk) => new Promise((done, fail) => socket.write(chunk, (error) => (error ? fail(error) : done()))),
      }),
      opened: new Promise((done, fail) => {
        socket.once("connect", done);
        socket.once("error", fail);
      }),
      close: () =>
        new Promise<void>((done) => {
          socket.once("close", () => done());
          socket.end();
        }),
    };
  };
  const stop = async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([...servers.values()].map((server) => new Promise<void>((done) => server.close(() => done()))));
  };
  return { connector, stats, stop };
}

function serveSmtp(socket: Socket, behavior: Exclude<Behavior, "silent">, stats: { messages: number }): void {
  let buffer = "";
  let inData = false;
  socket.write("220 relay.example.com ESMTP\r\n");
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    while (true) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        buffer = buffer.slice(end + 5);
        inData = false;
        if (behavior === "stall_after_data") return;
        stats.messages += 1;
        socket.write("250 2.0.0 queued\r\n");
        continue;
      }
      const lineEnd = buffer.indexOf("\r\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);
      if (line.startsWith("EHLO")) socket.write("250-relay.example.com\r\n250-PIPELINING\r\n250 AUTH PLAIN LOGIN\r\n");
      else if (line.startsWith("AUTH PLAIN")) socket.write("235 2.7.0 ok\r\n");
      else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 2.1.0 ok\r\n");
      else if (line === "DATA") {
        socket.write("354 go ahead\r\n");
        inData = true;
      } else if (line === "QUIT") socket.end("221 bye\r\n");
      else socket.write("500 unknown\r\n");
    }
  });
}

async function runCase(name: string, behaviors: Behavior[]): Promise<CaseReport> {
  const relay = await startRelay(behaviors);
  const startedAt = Date.now();
  try {
    const result = await Effect.runPromise(
      Effect.result(
        sendPrivateEmailCode(
          CONFIG,
          { email: "user@example.com", code: "ABCD-EFGH", expiresAt: Date.now() + 10 * 60_000 },
          relay.connector,
        ),
      ),
    );
    const report: CaseReport = {
      name,
      result: Result.isSuccess(result) ? "sent" : result.failure.message,
      connections: relay.stats.connections,
      messages: relay.stats.messages,
      elapsedMs: Date.now() - startedAt,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } finally {
    await relay.stop();
  }
}

const report: Report = { passed: false, cases: [] };
try {
  const retried = await runCase("silent_then_normal", ["silent", "normal"]);
  report.cases.push(retried);
  assert.equal(retried.result, "sent");
  assert.equal(retried.connections, 2);
  assert.equal(retried.messages, 1);

  const unknown = await runCase("stall_after_data", ["stall_after_data", "normal"]);
  report.cases.push(unknown);
  assert.equal(unknown.result, "smtp_delivery_unknown");
  assert.equal(unknown.connections, 1);

  const normal = await runCase("normal", ["normal"]);
  report.cases.push(normal);
  assert.equal(normal.result, "sent");
  assert.equal(normal.connections, 1);
  assert.equal(normal.messages, 1);

  const silent = await runCase("always_silent", ["silent"]);
  report.cases.push(silent);
  assert.equal(silent.result, "smtp_timeout");
  assert.equal(silent.connections, 3);
  assert(silent.elapsedMs < EMAIL_CODE_DELIVERY_BUDGET_MS, "the attempts must end inside the delivery budget");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(resolve(OUT, ".."), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"}: ${OUT}\n`);
}
