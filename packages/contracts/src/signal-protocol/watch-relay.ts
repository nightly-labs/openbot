import { type HostGrantKind, openHostGrant, sealHostGrant } from "../host-grant";
import { isDynamicRecord, isNumber, isString } from "../runtime-values";
import { decodeWatchCommand, type WatchCommand } from "../watch-protocol";
import type { RemoteMemberRole } from "./ticket";

export const WATCH_TICKET_AUDIENCE = "openbot-watch";

export const WATCH_TICKET_TTL_SECONDS = 10 * 60;

export const WATCH_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export const WATCH_RELAY_PATH = "/v1/watch/request";

export const WATCH_RELAY_VERSION = 1;

export const WATCH_RELAY_BODY_BYTES_LIMIT = 16 * 1024;

export const WATCH_RELAY_SEALED_LIMIT = 12 * 1024;

export const WATCH_RELAY_REPLY_SEALED_LIMIT = 60 * 1024;

export const WATCH_RELAY_HOST_TIMEOUT_MS = 20_000;

export const WATCH_RELAY_CLOCK_SKEW_MS = 5 * 60_000;

export const WATCH_RELAY_PENDING_PER_HOST = 8;

export const WATCH_RELAY_CAPABILITY = "watch-relay";

export const WATCH_REQUEST_KIND: HostGrantKind = { version: 1, info: "openbot-watch-request-v1" };

const PROOF_LABEL = "openbot-watch-request-v1";
const TICKET_PROOF_LABEL = "openbot-watch-ticket-v1";
const RESPONSE_KEY_BYTES = 32;
const REPLY_IV_BYTES = 12;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;
const HOST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PROOF_PATTERN = /^[A-Za-z0-9_-]{80,100}$/u;

export interface WatchTicketClaims {
  aud: typeof WATCH_TICKET_AUDIENCE;
  jti: string;
  watchSessionId: string;
  hostId: string;
  userId: string;
  membershipId: string;
  role: RemoteMemberRole;
  authEpoch: number;
  clientPublicKey: string;
  signal?: string;
  iat: number;
  exp: number;
}

export interface WatchRelayHttpRequest {
  v: typeof WATCH_RELAY_VERSION;
  ts: number;
  sealed: string;
  proof: string;
}

export type WatchRelayStatus = 200 | 400 | 401 | 403 | 404 | 413 | 429 | 503 | 504;

export type WatchRelayHostStatus = 200 | 400 | 401 | 403 | 404 | 413 | 429 | 503;

export interface WatchRelayHttpReply {
  v: typeof WATCH_RELAY_VERSION;
  sealed: string;
}

export interface WatchRelayRequest {
  id: string;
  ts: number;
  responseKey: string;
  command: WatchCommand;
}

export interface WatchTicketRequest {
  hostId: string;
  ts: number;
  proof: string;
}

export function watchRequestNonce(hostId: string, ticketId: string): string {
  return `${hostId}\n${ticketId}`;
}

export function watchProofMessage(hostId: string, ticketId: string, sealedDigest: string, ts: number): string {
  return JSON.stringify([PROOF_LABEL, hostId, ticketId, sealedDigest, ts]);
}

export function watchTicketProofMessage(watchSessionId: string, hostId: string, ts: number): string {
  return JSON.stringify([TICKET_PROOF_LABEL, watchSessionId, hostId, ts]);
}

export async function watchSealedDigest(sealed: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sealed)));
  return toBase64Url(digest);
}

export async function verifyWatchProof(publicKey: string, message: string, proof: string): Promise<boolean> {
  if (!PROOF_PATTERN.test(proof)) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      fromBase64Url(publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromBase64Url(proof),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export function sealWatchRequest(hostWatchKey: string, hostId: string, ticketId: string, request: WatchRelayRequest) {
  return sealHostGrant(
    WATCH_REQUEST_KIND,
    hostWatchKey,
    watchRequestNonce(hostId, ticketId),
    encodeWatchRelayRequest(request),
  );
}

export function openWatchRequest(
  privateKey: CryptoKey,
  hostId: string,
  ticketId: string,
  sealed: string,
): Promise<WatchRelayRequest> {
  return openHostGrant(
    WATCH_REQUEST_KIND,
    privateKey,
    watchRequestNonce(hostId, ticketId),
    sealed,
    decodeWatchRelayRequest,
  );
}

export function decodeWatchRelayRequest(value: unknown): WatchRelayRequest {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !ID_PATTERN.test(value.id) ||
    !isNumber(value.ts) ||
    !Number.isSafeInteger(value.ts) ||
    !isString(value.responseKey) ||
    !isString(value.command)
  ) {
    throw new Error("The watch request is invalid.");
  }
  if (fromBase64Url(value.responseKey).byteLength !== RESPONSE_KEY_BYTES)
    throw new Error("The watch request is invalid.");
  const command = decodeWatchCommand(value.command);
  if (!command) throw new Error("The watch command is invalid.");
  return { id: value.id, ts: value.ts, responseKey: value.responseKey, command };
}

export interface EncodedWatchRelayRequest {
  id: string;
  ts: number;
  responseKey: string;
  command: string;
}

export function encodeWatchRelayRequest(request: WatchRelayRequest): EncodedWatchRelayRequest {
  return { id: request.id, ts: request.ts, responseKey: request.responseKey, command: JSON.stringify(request.command) };
}

export async function sealWatchReply(responseKey: string, requestId: string, reply: string): Promise<string> {
  const key = await replyKey(responseKey);
  const iv = crypto.getRandomValues(new Uint8Array(REPLY_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(requestId) },
      key,
      new TextEncoder().encode(reply),
    ),
  );
  const sealed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  sealed.set(iv, 0);
  sealed.set(ciphertext, iv.byteLength);
  return toBase64Url(sealed);
}

export async function openWatchReply(responseKey: string, requestId: string, sealed: string): Promise<string> {
  const bytes = fromBase64Url(sealed);
  if (bytes.byteLength <= REPLY_IV_BYTES) throw new Error("The watch reply is invalid.");
  const key = await replyKey(responseKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, REPLY_IV_BYTES), additionalData: new TextEncoder().encode(requestId) },
    key,
    bytes.slice(REPLY_IV_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}

export function decodeWatchRelayHttpRequest(value: unknown): WatchRelayHttpRequest | null {
  if (
    !isDynamicRecord(value) ||
    value.v !== WATCH_RELAY_VERSION ||
    !isNumber(value.ts) ||
    !Number.isSafeInteger(value.ts) ||
    !isString(value.sealed) ||
    value.sealed.length === 0 ||
    value.sealed.length > WATCH_RELAY_SEALED_LIMIT ||
    !BASE64URL_PATTERN.test(value.sealed) ||
    !isString(value.proof) ||
    !PROOF_PATTERN.test(value.proof)
  ) {
    return null;
  }
  return { v: WATCH_RELAY_VERSION, ts: value.ts, sealed: value.sealed, proof: value.proof };
}

export function decodeWatchTicketRequest(value: unknown): WatchTicketRequest | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.hostId) ||
    !HOST_ID_PATTERN.test(value.hostId) ||
    !isNumber(value.ts) ||
    !Number.isSafeInteger(value.ts) ||
    !isString(value.proof) ||
    !PROOF_PATTERN.test(value.proof)
  ) {
    return null;
  }
  return { hostId: value.hostId, ts: value.ts, proof: value.proof };
}

export function watchClockAccepts(ts: number, now: number): boolean {
  return Math.abs(now - ts) <= WATCH_RELAY_CLOCK_SKEW_MS;
}

export function isWatchRelaySealed(value: unknown, limit: number): value is string {
  return isString(value) && value.length > 0 && value.length <= limit && BASE64URL_PATTERN.test(value);
}

async function replyKey(responseKey: string): Promise<CryptoKey> {
  const raw = fromBase64Url(responseKey);
  if (raw.byteLength !== RESPONSE_KEY_BYTES) throw new Error("The watch response key is invalid.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
