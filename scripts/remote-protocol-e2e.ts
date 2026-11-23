import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QueuedSignalMessage } from "@openbot/contracts/signal-protocol/ingress-queue";
import { createIngressQueueKeyPair } from "@openbot/contracts/signal-protocol/ingress-queue";
import type { RemoteTicketClaims } from "@openbot/contracts/signal-protocol/ticket";
import { Effect } from "effect";
import { createRemoteCommandMailbox, decodeRemoteTeamCommand } from "../packages/team-client/src/remote-peer";
import { encodeTeamWebRtcPayload, TeamWebRtcPayloadDecoder } from "../packages/team-client/src/webrtc-framing";
import { IngressQueue, queueRouteKey } from "../remote/api/src/ingress-queue";
import { SignalService } from "../remote/api/src/signal-service";
import { RemoteTokenError } from "../remote/api/src/tokens";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-protocol-e2e");
const checks: Array<{ name: string; passed: boolean }> = [];

function check(name: string, run: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(run)
    .then(
      () => {
        checks.push({ name, passed: true });
      },
      (error) => {
        checks.push({ name, passed: false });
        throw error;
      },
    );
}

function claim(role: RemoteTicketClaims["role"], jti: string): RemoteTicketClaims {
  const now = Math.floor(Date.now() / 1_000);
  return {
    aud: "openbot-remote",
    jti,
    sessionId: `session-${jti}`,
    hostId: "host-protocol-e2e",
    userId: `user-${jti}`,
    membershipId: `membership-${jti}`,
    role,
    authEpoch: 1,
    protocolMinimum: 2,
    protocolMaximum: 2,
    sessionExpiresAt: now + 3_600,
    iat: now,
    exp: now + 3_600,
  };
}

class FakeSocket {
  readonly frames: string[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(
    readonly id: string,
    readonly ip = "127.0.0.1",
  ) {}

  send(message: string): void {
    this.frames.push(message);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
}

const tokens = {
  verifyTicket: (token: string) => {
    if (token === "bad") return Effect.fail(new RemoteTokenError({ message: "invalid" }));
    if (token === "host-ticket") return Effect.succeed(claim("host", "host-ticket"));
    if (token === "member-ticket") return Effect.succeed(claim("member", "member-ticket"));
    return Effect.fail(new RemoteTokenError({ message: "invalid" }));
  },
  verifyResumeToken: () => Effect.fail(new RemoteTokenError({ message: "invalid" })),
  validateClaims: () => Effect.succeed(true),
  issueResumeToken: (claims: RemoteTicketClaims) => Effect.succeed(`resume-${claims.jti}`),
  iceServers: () => [{ urls: "stun:127.0.0.1:3478" }],
};

const signal = new SignalService(tokens, 4);
const receive = (socket: FakeSocket, message: unknown) =>
  Effect.runPromise(signal.receive(socket, JSON.stringify(message)).pipe(Effect.provide(signal.dependencies)));

await check("Signal rejects an unauthenticated message", async () => {
  const socket = new FakeSocket("invalid");
  signal.connect(socket);
  await receive(socket, { type: "invalid" });
  assert.equal(socket.closed?.code, 1003);
});

await check("Signal authenticates a host and reconnects a member", async () => {
  const host = new FakeSocket("host");
  signal.connect(host);
  await receive(host, { type: "hello", version: 1, peer: "host", token: "host-ticket" });
  assert.equal(JSON.parse(host.frames[0] ?? "{}").type, "ready");
  const member = new FakeSocket("member");
  signal.connect(member);
  await receive(member, { type: "hello", version: 1, peer: "client", token: "member-ticket" });
  assert.equal(JSON.parse(member.frames[0] ?? "{}").type, "ready");
  assert.equal(JSON.parse(host.frames[1] ?? "{}").type, "peer-ready");
  await Effect.runPromise(signal.disconnect(member).pipe(Effect.provide(signal.dependencies)));
  const replacement = new FakeSocket("replacement");
  signal.connect(replacement);
  await receive(replacement, { type: "hello", version: 1, peer: "client", token: "member-ticket" });
  assert.equal(replacement.closed?.code, 1008);
});

await check("Ingress queue preserves order and seals delivery", async () => {
  const keyPair = await createIngressQueueKeyPair();
  const queue = new IngressQueue(() => Effect.succeed({ hostId: "host", state: "starting" }));
  queue.rememberKey("host", keyPair.publicKey);
  const route = { platform: "telegram", botId: "1", chatId: "2" } as const;
  const message = (bodyBase64: string): QueuedSignalMessage => ({
    type: "telegram-delivery",
    version: 1 as const,
    botId: "1",
    chatId: "2",
    bodyBase64,
  });
  assert.equal(
    await Effect.runPromise(queue.keep("host", route, queueRouteKey("telegram", "1:2"), message("one"))),
    "queued",
  );
  assert.equal(
    await Effect.runPromise(queue.keep("host", route, queueRouteKey("telegram", "1:2"), message("two"))),
    "queued",
  );
  const frames = queue.take("host", "socket", () => true);
  assert.equal(frames.length, 2);
  assert.notEqual(frames[0]?.sealed, frames[1]?.sealed);
  queue.acknowledge("host", frames[0]?.id ?? "");
  queue.acknowledge("host", frames[1]?.id ?? "");
  queue.close();
});

await check("Team framing rejects malformed fragments and decodes ordered fragments", () => {
  const payload = JSON.stringify({ type: "request", value: "x".repeat(2_000) });
  const frames = encodeTeamWebRtcPayload(payload, 256, 7);
  const decoder = new TeamWebRtcPayloadDecoder();
  let result: string | ArrayBuffer | undefined;
  for (const frame of frames) result = decoder.push(frame);
  assert.equal(result, payload);
  const malformed = new Uint8Array(17);
  assert.throws(() => new TeamWebRtcPayloadDecoder().push(malformed.buffer));
});

await check("Team command decoding ignores unknown optional fields and rejects malformed bodies", () => {
  const decoded = decodeRemoteTeamCommand({
    id: "request-1",
    type: "request",
    method: "POST",
    path: "/v1/test",
    body: { known: true },
    futureField: "ignored",
  });
  assert.equal(decoded.command?.type, "request");
  assert.equal(
    decodeRemoteTeamCommand({
      id: "request-2",
      type: "request",
      method: "POST",
      path: "/v1/test",
      body: { bad: Symbol() },
    }).command,
    null,
  );
});

await check("Team mailbox resolves pending requests on disconnect", async () => {
  const mailbox = createRemoteCommandMailbox(() => undefined);
  const result = mailbox.send({ id: "request-1", type: "request", method: "GET", path: "/", body: null });
  void mailbox.send({ id: "disconnect", type: "disconnect" });
  mailbox.dispose();
  const answer = await result;
  assert.equal(answer.ok, false);
  assert.equal(mailbox.outstanding().length, 0);
});

signal.close();
mkdirSync(OUT, { recursive: true });
const report = {
  passed: checks.filter((check) => check.passed).length,
  failed: checks.filter((check) => !check.passed).length,
  checks,
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (report.failed > 0) process.exitCode = 1;
