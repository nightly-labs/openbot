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
const OVERFLOW = { username: "overflow@example.com", password: "overflow-password" };
const OVERFLOW_2 = { username: "overflow-2@example.com", password: "overflow-2-password" };

type Behavior = "normal" | "silent" | "stall_after_data" | "sender_limit" | "auth_refused";
type Route = "direct" | "relay" | "relay_unreachable" | "relay_crashed";

interface CaseReport {
  name: string;
  result: string;
  connections: number;
  messages: number;
  elapsedMs: number;
}

interface FallbackCaseReport extends CaseReport {
  fallbackSends: number;
  mailFrom: string[];
  events: string[];
}

interface Report {
  passed: boolean;
  cases: CaseReport[];
  failure?: string;
}

async function startRelay(behaviors: Behavior[]) {
  const sockets = new Set<Socket>();
  const mailFrom: string[] = [];
  const stats = { connections: 0, messages: 0, mailFrom };
  const servers = new Map<Behavior, Server>();
  for (const behavior of new Set(behaviors)) {
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

function serveSmtp(
  socket: Socket,
  behavior: Exclude<Behavior, "silent">,
  stats: { messages: number; mailFrom: string[] },
): void {
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
      else if (line.startsWith("AUTH PLAIN") && behavior === "auth_refused") {
        socket.write("535 5.7.8 authentication failed\r\n");
      } else if (line.startsWith("AUTH PLAIN")) socket.write("235 2.7.0 ok\r\n");
      else if (line.startsWith("MAIL FROM")) {
        stats.mailFrom.push(line.slice("MAIL FROM:".length));
        socket.write("250 2.1.0 ok\r\n");
      } else if (line.startsWith("RCPT TO")) socket.write("250 2.1.0 ok\r\n");
      else if (line === "DATA" && behavior === "sender_limit") {
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
  if (route === "relay_crashed") return { fetch: async () => new Response("<html>error</html>", { status: 500 }) };
  const handler = createEmailRelayHandler(connector);
  return {
    fetch: async (request) => {
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

function fakeCloudflare(outcome: "accept" | "daily_limit") {
  const sent: EmailMessageBuilder[] = [];
  const send = async (message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> => {
    assert("subject" in message, "the fallback must use the message builder");
    if (outcome === "daily_limit") {
      throw Object.assign(new Error("Daily sending quota reached for user@example.com"), {
        code: "E_DAILY_LIMIT_EXCEEDED",
      });
    }
    sent.push(message);
    return { messageId: `message-${sent.length}` };
  };
  return { binding: { send }, sent };
}

function describeEvent(event: AccountAnalyticsEvent): string {
  if (event.name === "email_sent") return `${event.name}:${event.result}:${event.mailbox}`;
  return `${event.name}:${"result" in event ? event.result : ""}`;
}

async function runFallbackCase(
  name: string,
  behaviors: Behavior[],
  outcome: "accept" | "daily_limit",
  code = "ABCD-EFGH",
  replyTo?: string,
  overflowMailboxes: 0 | 1 | 2 = 0,
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
      ...(replyTo ? { EMAIL_REPLY_TO: replyTo } : {}),
      ...(overflowMailboxes >= 1
        ? { EMAIL_SMTP_OVERFLOW_USERNAME: OVERFLOW.username, EMAIL_SMTP_OVERFLOW_PASSWORD: OVERFLOW.password }
        : {}),
      ...(overflowMailboxes >= 2
        ? { EMAIL_SMTP_OVERFLOW_2_USERNAME: OVERFLOW_2.username, EMAIL_SMTP_OVERFLOW_2_PASSWORD: OVERFLOW_2.password }
        : {}),
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
      mailFrom: relay.stats.mailFrom,
      events: events.map(describeEvent),
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
  assert.deepEqual(fellBack.events, ["email_sent:rate_limited:primary", "email_fallback_sent:accepted"]);
  const [fallbackMessage] = fallbackMessages;
  assert(fallbackMessage);
  assert.deepEqual(fallbackMessage.from, { name: "OpenBot", email: CONFIG.from });
  assert.equal(fallbackMessage.to, "user@example.com");
  assert(fallbackMessage.text?.includes("ABCD-EFGH"), "the fallback must carry the sign-in code");
  assert(fallbackMessage.html?.includes("ABCD-EFGH"), "the fallback must carry the sign-in code");
  assert.equal(fallbackMessage.headers?.["Auto-Submitted"], "auto-generated");
  assert.equal(fallbackMessage.replyTo, undefined, "with no EMAIL_REPLY_TO, a reply goes to the sender");

  const inbox = "inbox@example.com";
  const withInbox = await runFallbackCase("fallback_reply_to_inbox", ["sender_limit"], "accept", "ABCD-EFGH", inbox);
  const { sent: inboxMessages, ...withInboxReport } = withInbox;
  report.cases.push(withInboxReport);
  assert.equal(withInbox.result, "sent");
  assert.equal(inboxMessages[0]?.replyTo, inbox);

  const bothLimited = await runFallbackCase("fallback_refused", ["sender_limit"], "daily_limit");
  report.cases.push(bothLimited);
  assert.equal(bothLimited.result, RATE_LIMITED_DELIVERY_ERROR);
  assert.deepEqual(bothLimited.events, ["email_sent:rate_limited:primary", "email_fallback_sent:failed"]);

  const noFallbackUnknown = await runFallbackCase("no_fallback_after_unknown", ["stall_after_data"], "accept");
  report.cases.push(noFallbackUnknown);
  assert.equal(noFallbackUnknown.result, "smtp_delivery_unknown");
  assert.equal(noFallbackUnknown.fallbackSends, 0);
  assert.deepEqual(noFallbackUnknown.events, ["email_sent:unknown:primary"]);

  const noFallbackSent = await runFallbackCase("no_fallback_when_sent", ["normal"], "accept");
  report.cases.push(noFallbackSent);
  assert.equal(noFallbackSent.result, "sent");
  assert.equal(noFallbackSent.messages, 1);
  assert.equal(noFallbackSent.fallbackSends, 0);
  assert.deepEqual(noFallbackSent.events, ["email_sent:accepted:primary"]);

  const noFallbackInvalid = await runFallbackCase("no_fallback_for_invalid_code", ["normal"], "accept", "not-a-code");
  report.cases.push(noFallbackInvalid);
  assert.equal(noFallbackInvalid.result, "smtp_invalid_code");
  assert.equal(noFallbackInvalid.connections, 0);
  assert.equal(noFallbackInvalid.fallbackSends, 0);
  assert.deepEqual(noFallbackInvalid.events, ["email_sent:failed:primary"]);

  const noFallbackAfterBudget = await runFallbackCase("no_fallback_after_budget", ["silent"], "accept");
  report.cases.push(noFallbackAfterBudget);
  assert.equal(noFallbackAfterBudget.result, "smtp_timeout");
  assert.equal(noFallbackAfterBudget.connections, 3);
  assert.equal(noFallbackAfterBudget.fallbackSends, 0);
  assert.deepEqual(noFallbackAfterBudget.events, ["email_sent:failed:primary"]);

  const overflowSent = await runFallbackCase(
    "overflow_after_sender_limit",
    ["sender_limit", "normal"],
    "accept",
    "ABCD-EFGH",
    undefined,
    1,
  );
  report.cases.push(overflowSent);
  assert.equal(overflowSent.result, "sent");
  assert.equal(overflowSent.messages, 1);
  assert.equal(overflowSent.fallbackSends, 0);
  assert.deepEqual(overflowSent.mailFrom, [`<${CONFIG.from}>`, `<${OVERFLOW.username}>`]);
  assert.deepEqual(overflowSent.events, ["email_sent:rate_limited:primary", "email_sent:accepted:overflow"]);

  const overflowLimited = await runFallbackCase(
    "fallback_after_overflow_limit",
    ["sender_limit", "sender_limit"],
    "accept",
    "ABCD-EFGH",
    undefined,
    1,
  );
  const { sent: overflowFallbackMessages, ...overflowLimitedReport } = overflowLimited;
  report.cases.push(overflowLimitedReport);
  assert.equal(overflowLimited.result, "sent");
  assert.equal(overflowLimited.connections, 2);
  assert.equal(overflowLimited.fallbackSends, 1);
  assert.deepEqual(overflowFallbackMessages[0]?.from, { name: "OpenBot", email: CONFIG.from });
  assert.deepEqual(overflowLimited.events, [
    "email_sent:rate_limited:primary",
    "email_sent:rate_limited:overflow",
    "email_fallback_sent:accepted",
  ]);

  const noOverflowAfterUnknown = await runFallbackCase(
    "no_overflow_after_unknown",
    ["stall_after_data", "normal"],
    "accept",
    "ABCD-EFGH",
    undefined,
    1,
  );
  report.cases.push(noOverflowAfterUnknown);
  assert.equal(noOverflowAfterUnknown.result, "smtp_delivery_unknown");
  assert.equal(noOverflowAfterUnknown.connections, 1);
  assert.deepEqual(noOverflowAfterUnknown.events, ["email_sent:unknown:primary"]);

  const overflowRefused = await runFallbackCase(
    "overflow_auth_refused",
    ["sender_limit", "auth_refused"],
    "daily_limit",
    "ABCD-EFGH",
    undefined,
    1,
  );
  report.cases.push(overflowRefused);
  assert.equal(overflowRefused.result, RATE_LIMITED_DELIVERY_ERROR);
  assert.equal(overflowRefused.fallbackSends, 0);
  assert.deepEqual(overflowRefused.events, [
    "email_sent:rate_limited:primary",
    "email_sent:failed:overflow",
    "email_fallback_sent:failed",
  ]);

  const helloAfterSigninLimit = await runFallbackCase(
    "overflow_after_signin_limit",
    ["sender_limit", "sender_limit", "normal"],
    "daily_limit",
    "ABCD-EFGH",
    undefined,
    2,
  );
  report.cases.push(helloAfterSigninLimit);
  assert.equal(helloAfterSigninLimit.result, "sent");
  assert.equal(helloAfterSigninLimit.messages, 1);
  assert.equal(helloAfterSigninLimit.fallbackSends, 0);
  assert.deepEqual(helloAfterSigninLimit.mailFrom, [
    `<${CONFIG.from}>`,
    `<${OVERFLOW_2.username}>`,
    `<${OVERFLOW.username}>`,
  ]);
  assert.deepEqual(helloAfterSigninLimit.events, [
    "email_sent:rate_limited:primary",
    "email_sent:rate_limited:overflow_2",
    "email_sent:accepted:overflow",
  ]);

  const signinBeforeHello = await runFallbackCase(
    "signin_before_hello",
    ["sender_limit", "normal"],
    "daily_limit",
    "ABCD-EFGH",
    undefined,
    2,
  );
  report.cases.push(signinBeforeHello);
  assert.equal(signinBeforeHello.result, "sent");
  assert.equal(signinBeforeHello.connections, 2);
  assert.deepEqual(signinBeforeHello.mailFrom, [`<${CONFIG.from}>`, `<${OVERFLOW_2.username}>`]);
  assert.deepEqual(signinBeforeHello.events, ["email_sent:rate_limited:primary", "email_sent:accepted:overflow_2"]);

  const helloAfterSigninRefusal = await runFallbackCase(
    "overflow_after_signin_auth_refused",
    ["sender_limit", "auth_refused", "normal"],
    "daily_limit",
    "ABCD-EFGH",
    undefined,
    2,
  );
  report.cases.push(helloAfterSigninRefusal);
  assert.equal(helloAfterSigninRefusal.result, "sent");
  assert.deepEqual(helloAfterSigninRefusal.events, [
    "email_sent:rate_limited:primary",
    "email_sent:failed:overflow_2",
    "email_sent:accepted:overflow",
  ]);

  const allMailboxesLimited = await runFallbackCase(
    "fallback_after_all_mailboxes_limited",
    ["sender_limit", "sender_limit", "sender_limit"],
    "accept",
    "ABCD-EFGH",
    undefined,
    2,
  );
  report.cases.push(allMailboxesLimited);
  assert.equal(allMailboxesLimited.result, "sent");
  assert.equal(allMailboxesLimited.connections, 3);
  assert.equal(allMailboxesLimited.fallbackSends, 1);
  assert.deepEqual(allMailboxesLimited.events, [
    "email_sent:rate_limited:primary",
    "email_sent:rate_limited:overflow_2",
    "email_sent:rate_limited:overflow",
    "email_fallback_sent:accepted",
  ]);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(resolve(OUT, ".."), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"}: ${OUT}\n`);
}
