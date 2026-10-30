import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Effect, Schema } from "effect";
import type { RemoteApiConfig } from "./config";

// One real TURN allocation over UDP, as a client makes it (RFC 5766 with the TURN REST credentials
// of `RemoteTokenService.iceServers`). A STUN answer alone does not show that the relay can allocate:
// on 2026-10-30 coturn answered STUN but refused every Allocate with 486 at `total-quota`.

const MAGIC_COOKIE = 0x2112a442;
const ALLOCATE = 0x0003;
const REFRESH = 0x0004;
const SUCCESS_CLASS = 0x0100;
const ERROR_CLASS = 0x0110;
const USERNAME = 0x0006;
const MESSAGE_INTEGRITY = 0x0008;
const ERROR_CODE = 0x0009;
const LIFETIME = 0x000d;
const REALM = 0x0014;
const NONCE = 0x0015;
const REQUESTED_TRANSPORT = 0x0019;
const UDP_PROTOCOL = 17;
const UNAUTHORIZED = 401;
const ALLOCATION_QUOTA_REACHED = 486;
// UDP can lose a datagram, so a request is sent again until it gets an answer.
const RESEND_MILLISECONDS = 500;
const PROBE_TIMEOUT_MILLISECONDS = 5_000;
const REFRESH_TIMEOUT_MILLISECONDS = 1_000;
// The credentials only have to outlive the probe.
const CREDENTIAL_TTL_SECONDS = 60;
const PROBE_USER = "openbot-status-probe";

/** `full`: the relay refused the allocation at its quota. `refused`: another error. `no-answer`: no reply in time. */
class TurnProbeError extends Schema.TaggedError<TurnProbeError>()("TurnProbeError", {
  reason: Schema.Literals(["full", "refused", "no-answer"]),
}) {}

interface Attribute {
  type: number;
  value: Uint8Array;
}

interface StunResponse {
  type: number;
  attributes: Map<number, Uint8Array>;
}

const text = (type: number, value: string): Attribute => ({ type, value: new TextEncoder().encode(value) });
const uint32 = (type: number, value: number): Attribute => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return { type, value: bytes };
};

function encodeAttribute({ type, value }: Attribute) {
  const bytes = new Uint8Array(4 + Math.ceil(value.length / 4) * 4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, type);
  view.setUint16(2, value.length);
  bytes.set(value, 4);
  return bytes;
}

function concat(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function encodeMessage(method: number, transactionId: Uint8Array, attributes: Attribute[], key: Uint8Array | null) {
  const body = concat(attributes.map(encodeAttribute));
  // MESSAGE-INTEGRITY covers the header with a length that already counts its own 24 bytes.
  const header = new Uint8Array(20);
  const view = new DataView(header.buffer);
  view.setUint16(0, method);
  view.setUint16(2, body.length + (key ? 24 : 0));
  view.setUint32(4, MAGIC_COOKIE);
  header.set(transactionId, 8);
  const message = concat([header, body]);
  if (!key) return message;
  const integrity = createHmac("sha1", key).update(message).digest();
  return concat([message, encodeAttribute({ type: MESSAGE_INTEGRITY, value: integrity })]);
}

/** The response to `transactionId`, or null for any other datagram. */
function decodeResponse(bytes: Uint8Array, transactionId: Uint8Array): StunResponse | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4) !== MAGIC_COOKIE) return null;
  if (!bytes.subarray(8, 20).every((byte, index) => byte === transactionId[index])) return null;
  const end = Math.min(bytes.length, 20 + view.getUint16(2));
  const attributes = new Map<number, Uint8Array>();
  for (let offset = 20; offset + 4 <= end; ) {
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    attributes.set(type, bytes.subarray(offset + 4, offset + 4 + length));
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return { type: view.getUint16(0), attributes };
}

function errorCode(response: StunResponse) {
  const value = response.attributes.get(ERROR_CODE);
  if (!value || value.length < 4) return 0;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  return (view.getUint8(2) & 0x07) * 100 + view.getUint8(3);
}

const noAnswer = () => new TurnProbeError({ reason: "no-answer" });

const openSocket = (address: string, port: number) => {
  let receive: ((bytes: Uint8Array) => void) | null = null;
  let fail: (() => void) | null = null;
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        Bun.udpSocket({
          connect: { hostname: address, port },
          // When coturn is down, the host answers with ICMP port unreachable and the socket gets
          // ECONNREFUSED. Without this handler Bun reports it as an uncaught error.
          socket: { data: (_socket, bytes) => receive?.(bytes), error: () => fail?.() },
        }),
      catch: noAnswer,
    }),
    (socket) => Effect.sync(() => socket.close()),
  ).pipe(
    Effect.map((socket) => ({
      /** Sends the request until its response arrives. */
      request: (method: number, attributes: Attribute[], key: Uint8Array | null) =>
        Effect.callback<StunResponse, TurnProbeError>((resume) => {
          const transactionId = randomBytes(12);
          const message = encodeMessage(method, transactionId, attributes, key);
          const stop = () => {
            clearInterval(resend);
            receive = null;
            fail = null;
          };
          const end = () => {
            stop();
            resume(Effect.fail(noAnswer()));
          };
          // A send can throw too. In the timer that would stop the process.
          const send = () => {
            try {
              socket.send(message);
            } catch {
              end();
            }
          };
          const resend = setInterval(send, RESEND_MILLISECONDS);
          receive = (bytes) => {
            const response = decodeResponse(bytes, transactionId);
            if (!response) return;
            stop();
            resume(Effect.succeed(response));
          };
          fail = end;
          send();
          return Effect.sync(stop);
        }),
    })),
  );
};

/** Allocates one UDP relay on the TURN server and frees it at once. */
export const probeTurnAllocation = Effect.fn("TurnProbe.allocate")(
  function* (config: Pick<RemoteApiConfig, "turnHost" | "turnPort" | "turnSecret">) {
    const { address } = yield* Effect.tryPromise({
      try: () => lookup(config.turnHost, { family: 4 }),
      catch: noAnswer,
    });
    const socket = yield* openSocket(address, config.turnPort);
    const transport = uint32(REQUESTED_TRANSPORT, UDP_PROTOCOL << 24);

    // The first request has no credentials. The 401 gives the realm and the nonce.
    const challenge = yield* socket.request(ALLOCATE, [transport], null);
    const realm = challenge.attributes.get(REALM);
    const nonce = challenge.attributes.get(NONCE);
    if (challenge.type !== (ALLOCATE | ERROR_CLASS) || errorCode(challenge) !== UNAUTHORIZED || !realm || !nonce) {
      return yield* new TurnProbeError({ reason: "refused" });
    }

    const username = `${Math.floor(Date.now() / 1_000) + CREDENTIAL_TTL_SECONDS}:${PROBE_USER}`;
    const password = createHmac("sha1", config.turnSecret).update(username).digest("base64");
    const key = createHash("md5")
      .update(`${username}:${new TextDecoder().decode(realm)}:${password}`)
      .digest();
    const credentials = [text(USERNAME, username), { type: REALM, value: realm }, { type: NONCE, value: nonce }];

    const allocation = yield* socket.request(ALLOCATE, [transport, ...credentials], key);
    if (allocation.type !== (ALLOCATE | SUCCESS_CLASS)) {
      return yield* new TurnProbeError({
        reason: errorCode(allocation) === ALLOCATION_QUOTA_REACHED ? "full" : "refused",
      });
    }
    // A lifetime of 0 frees the allocation now, so the probe does not hold quota for 10 minutes.
    // The allocation already worked, so a lost answer here does not fail the probe.
    yield* socket
      .request(REFRESH, [uint32(LIFETIME, 0), ...credentials], key)
      .pipe(Effect.timeout(REFRESH_TIMEOUT_MILLISECONDS), Effect.ignore);
  },
  Effect.scoped,
  Effect.timeoutOrElse({
    duration: PROBE_TIMEOUT_MILLISECONDS,
    orElse: () => Effect.fail(noAnswer()),
  }),
);
