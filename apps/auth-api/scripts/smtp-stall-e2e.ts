// A sign-in email must be sent again when the relay stalls before the message, and must not be sent
// twice when the relay stalls after it. Drives the real `sendPrivateEmail` over a local fake relay
// through the injected `SmtpConnector`:
// - a connection with no greeting whose close is never confirmed (production on 2026-10-23 and
//   2026-10-29), then a normal relay: the code is sent on the second connection;
// - a stall after `354`: the result is unknown and there is no second connection;
// - a normal relay: one connection, one message;
// - a relay that never answers: the last error is a timeout inside the delivery budget.
// The relay cases send through the `EMAIL_RELAY` path of production (#4578): the real relay Worker
// handler takes the request and sends over the same fake relay. A stall after `354` stays unknown
// across the binding. A relay Worker that cannot be reached, or that crashes, is unknown too: it can
// fail after the mail host took the message.
// The fallback cases drive the production sign-in delivery (`createEmailCodeDelivery`) through the
// relay Worker handler and a fake Cloudflare `send_email` binding:
// - a sender limit at `DATA`: Cloudflare sends the code, and the analytics show both sends;
// - a sender limit, and Cloudflare refuses too: the answer stays the SMTP sender limit;
// - a stall after `354` (unknown), a normal send, and an invalid code: Cloudflare sends nothing.
// `bun run test:smtp-stall`. Writes .openbot-build/smtp-stall-e2e.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket, connect as tcpConnect } from "node:net";
import { resolve } from "node:path";
import { Effect, Result } from "effect";
import type { AccountAnalyticsEvent } from "../src/server/account-analytics";
import { createEmailCodeDelivery } from "../src/server/email-delivery";
import { createEmailRelayHandler } from "../src/server/email-relay-handler";
import {
  EMAIL_CODE_DELIVERY_BUDGET_MS,
  prepareEmailCode,
  RATE_LIMITED_DELIVERY_ERROR,
  type SmtpConnector,
  type SmtpEmailConfig,
  sendPrivateEmail,
} from "../src/server/smtp-email-delivery";

const OUT = resolve(import.meta.dirname, "../../../.openbot-build/smtp-stall-e2e.json");
const CONFIG = {
  host: "relay.example.com",
  port: 465,
  username: "sender@example.com",
  password: "relay-password",
  from: "sender@example.com",
};

type Behavior = "normal" | "silent" | "stall_after_data" | "sender_limit";
/** `direct` opens the socket in the caller; `relay` sends through the relay Worker handler. */
type Route = "direct" | "relay" | "relay_unreachable" | "relay_crashed";

interface CaseReport {
  name: string;
  result: string;
  connections: number;
  messages: number;
  elapsedMs: number;
}

interface FallbackCaseReport extends CaseReport {
  /** The messages that the fake Cloudflare binding took. */
  fallbackSends: number;
  /** `<event name>:<result>` of each analytics event, in order. */
  events: string[];
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
      else if (line === "DATA" && behavior === "sender_limit") {
        // The reply of Namecheap Private Email when the hourly quota of the mailbox is spent.
        socket.write(
          "554 5.7.1 <DATA>: Data command rejected: Reject: too many messages from sender in last 60 minutes\r\n",
        );
      } else if (line === "DATA") {
        socket.write("354 go ahead\r\n");
        inData = true;
      } else if (line === "QUIT") socket.end("221 bye\r\n");
      else socket.write("500 unknown\r\n");
    }
  });
}

function relayWorker(route: Route, connector: SmtpConnector): SmtpEmailConfig["relay"] {
  if (route === "direct") return undefined;
  if (route === "relay_unreachable") return { fetch: () => Promise.reject(new Error("relay unreachable")) };
  // A thrown exception in a Worker answers 500 with an HTML page.
  if (route === "relay_crashed") return { fetch: async () => new Response("<html>error</html>", { status: 500 }) };
  const handler = createEmailRelayHandler(connector);
  return {
    fetch: async (request) => {
      // The binding carries the SMTP settings, and never the binding itself.
      const body = await request.clone().text();
      assert(body.includes(`"password":"${CONFIG.password}"`), "the relay request must carry the SMTP settings");
      assert(!body.includes('"relay":'), "the relay request must not carry the binding");
      return handler.fetch(request);
    },
  };
}

async function runCase(name: string, behaviors: Behavior[], route: Route = "direct"): Promise<CaseReport> {
  const relay = await startRelay(behaviors);
  const worker = relayWorker(route, relay.connector);
  const startedAt = Date.now();
  try {
    const result = await Effect.runPromise(
      Effect.result(
        prepareEmailCode({ email: "user@example.com", code: "ABCD-EFGH", expiresAt: Date.now() + 10 * 60_000 }).pipe(
          Effect.flatMap((message) =>
            sendPrivateEmail(
              worker ? { ...CONFIG, relay: worker } : CONFIG,
              message,
              worker ? undefined : relay.connector,
            ),
          ),
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

/** A Cloudflare `send_email` binding that takes each message, or refuses it with a daily limit. */
function fakeCloudflare(outcome: "accept" | "daily_limit") {
  const sent: EmailMessageBuilder[] = [];
  const send = async (message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => {
    assert("subject" in message, "the fallback must use the message builder");
    if (outcome === "daily_limit") {
      // The binding throws an `Error` with a `code`, and a text that can name the recipient.
      throw Object.assign(new Error("Daily sending quota reached for user@example.com"), {
        code: "E_DAILY_LIMIT_EXCEEDED",
      });
    }
    sent.push(message);
    return { messageId: `message-${sent.length}` };
  };
  return { binding: { send }, sent };
}

async function runFallbackCase(
  name: string,
  behaviors: Behavior[],
  outcome: "accept" | "daily_limit",
  code = "ABCD-EFGH",
): Promise<FallbackCaseReport & { sent: EmailMessageBuilder[] }> {
  const relay = await startRelay(behaviors);
  const handler = createEmailRelayHandler(relay.connector);
  const cloudflare = fakeCloudflare(outcome);
  const events: AccountAnalyticsEvent[] = [];
  const delivery = createEmailCodeDelivery(
    {
      EMAIL_SMTP_HOST: CONFIG.host,
      EMAIL_SMTP_PORT: String(CONFIG.port),
      EMAIL_SMTP_USERNAME: CONFIG.username,
      EMAIL_SMTP_PASSWORD: CONFIG.password,
      EMAIL_FROM: CONFIG.from,
      EMAIL_RELAY: {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
        connect: () => {
          throw new Error("the relay binding must not open a socket");
        },
      },
      EMAIL_FALLBACK: cloudflare.binding,
    },
    { track: (_account, event) => events.push(event) },
  );
  assert(delivery, "a complete SMTP configuration must give a delivery");
  const startedAt = Date.now();
  try {
    const result = await Effect.runPromise(
      Effect.result(delivery.send({ email: "user@example.com", code, expiresAt: Date.now() + 10 * 60_000 })),
    );
    const report: FallbackCaseReport = {
      name,
      result: Result.isSuccess(result) ? "sent" : result.failure.message,
      connections: relay.stats.connections,
      messages: relay.stats.messages,
      elapsedMs: Date.now() - startedAt,
      fallbackSends: cloudflare.sent.length,
      events: events.map((event) => `${event.name}:${"result" in event ? event.result : ""}`),
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return { ...report, sent: cloudflare.sent };
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

  const relayed = await runCase("relay_normal", ["normal"], "relay");
  report.cases.push(relayed);
  assert.equal(relayed.result, "sent");
  assert.equal(relayed.connections, 1);
  assert.equal(relayed.messages, 1);

  const relayedUnknown = await runCase("relay_stall_after_data", ["stall_after_data", "normal"], "relay");
  report.cases.push(relayedUnknown);
  assert.equal(relayedUnknown.result, "smtp_delivery_unknown");
  assert.equal(relayedUnknown.connections, 1);

  // The relay's own timeout must reach the caller: the code was not sent, so the user can ask again.
  const relayedSilent = await runCase("relay_always_silent", ["silent"], "relay");
  report.cases.push(relayedSilent);
  assert.equal(relayedSilent.result, "smtp_timeout");
  assert.equal(relayedSilent.connections, 3);

  const unreachable = await runCase("relay_unreachable", ["normal"], "relay_unreachable");
  report.cases.push(unreachable);
  assert.equal(unreachable.result, "smtp_delivery_unknown");
  assert.equal(unreachable.connections, 0);

  const crashed = await runCase("relay_crashed", ["normal"], "relay_crashed");
  report.cases.push(crashed);
  assert.equal(crashed.result, "smtp_delivery_unknown");
  assert.equal(crashed.connections, 0);

  const fellBack = await runFallbackCase("fallback_after_sender_limit", ["sender_limit"], "accept");
  const { sent: fallbackMessages, ...fellBackReport } = fellBack;
  report.cases.push(fellBackReport);
  assert.equal(fellBack.result, "sent");
  assert.equal(fellBack.messages, 0);
  assert.equal(fellBack.fallbackSends, 1);
  assert.deepEqual(fellBack.events, ["email_sent:rate_limited", "email_fallback_sent:accepted"]);
  const [fallbackMessage] = fallbackMessages;
  assert(fallbackMessage);
  assert.deepEqual(fallbackMessage.from, { name: "OpenBot", email: CONFIG.from });
  assert.equal(fallbackMessage.to, "user@example.com");
  assert(fallbackMessage.text?.includes("ABCD-EFGH"), "the fallback must carry the sign-in code");
  assert(fallbackMessage.html?.includes("ABCD-EFGH"), "the fallback must carry the sign-in code");
  assert.equal(fallbackMessage.headers?.["Auto-Submitted"], "auto-generated");

  const bothLimited = await runFallbackCase("fallback_refused", ["sender_limit"], "daily_limit");
  report.cases.push(bothLimited);
  assert.equal(bothLimited.result, RATE_LIMITED_DELIVERY_ERROR);
  assert.deepEqual(bothLimited.events, ["email_sent:rate_limited", "email_fallback_sent:failed"]);

  // The recipient can already have the message, so a second sender must not send it again.
  const noFallbackUnknown = await runFallbackCase("no_fallback_after_unknown", ["stall_after_data"], "accept");
  report.cases.push(noFallbackUnknown);
  assert.equal(noFallbackUnknown.result, "smtp_delivery_unknown");
  assert.equal(noFallbackUnknown.fallbackSends, 0);
  assert.deepEqual(noFallbackUnknown.events, ["email_sent:unknown"]);

  const noFallbackSent = await runFallbackCase("no_fallback_when_sent", ["normal"], "accept");
  report.cases.push(noFallbackSent);
  assert.equal(noFallbackSent.result, "sent");
  assert.equal(noFallbackSent.messages, 1);
  assert.equal(noFallbackSent.fallbackSends, 0);
  assert.deepEqual(noFallbackSent.events, ["email_sent:accepted"]);

  const noFallbackInvalid = await runFallbackCase("no_fallback_for_invalid_code", ["normal"], "accept", "not-a-code");
  report.cases.push(noFallbackInvalid);
  assert.equal(noFallbackInvalid.result, "smtp_invalid_code");
  assert.equal(noFallbackInvalid.connections, 0);
  assert.equal(noFallbackInvalid.fallbackSends, 0);
  assert.deepEqual(noFallbackInvalid.events, ["email_sent:failed"]);

  // Three SMTP timeouts spend the delivery budget of a sign-in code, so no time is left for Cloudflare.
  const noFallbackAfterBudget = await runFallbackCase("no_fallback_after_budget", ["silent"], "accept");
  report.cases.push(noFallbackAfterBudget);
  assert.equal(noFallbackAfterBudget.result, "smtp_timeout");
  assert.equal(noFallbackAfterBudget.connections, 3);
  assert.equal(noFallbackAfterBudget.fallbackSends, 0);
  assert.deepEqual(noFallbackAfterBudget.events, ["email_sent:failed"]);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(resolve(OUT, ".."), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"}: ${OUT}\n`);
}
