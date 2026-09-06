// The client half of the Signal protocol's validation: what a peer runs over the frames the service
// sends it. The service's own half - the untrusted client input it accepts - stays in
// `remote/api/src/protocol.ts` as zod, with byte limits and identifier patterns this does not need.
// One validator per trust direction; see `./messages.ts` for why they are not shared.
//
// Guards rather than a schema library because `@openbot/contracts` has one runtime dependency and is
// in the graph of a Cloudflare Worker, a React Native app and an Electron renderer. Adding zod here
// would push it into all three.

import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { type IceServer, SIGNAL_PROTOCOL_VERSION, type SignalChannel, type SignalServerMessage } from "./messages";

/**
 * Returns `null` for a frame whose `type` this version does not know: a newer Signal service may add
 * one, and a client already installed on a phone has to ignore it rather than drop the connection.
 * Throws for anything that is not a frame at all, or for a known type whose payload does not match -
 * both mean the peer cannot trust what follows.
 */
export function decodeSignalServerMessage(value: unknown): SignalServerMessage | null {
  if (!isDynamicRecord(value) || value.version !== SIGNAL_PROTOCOL_VERSION || !isString(value.type)) invalid();
  const version = SIGNAL_PROTOCOL_VERSION;
  const kind = value.type;
  switch (kind) {
    case "ready":
      return {
        type: kind,
        version,
        connectionId: value.connectionId === null ? null : identifier(value.connectionId),
        resumeToken: identifier(value.resumeToken),
        iceServers: iceServers(value.iceServers),
      };
    case "peer-ready":
      return {
        type: kind,
        version,
        connectionId: identifier(value.connectionId),
        sessionId: identifier(value.sessionId),
        userId: identifier(value.userId),
        membershipId: identifier(value.membershipId),
        role: memberRole(value.role),
        sessionExpiresAt: integer(value.sessionExpiresAt),
        resumed: flag(value.resumed),
      };
    case "error":
      return {
        type: kind,
        version,
        code: identifier(value.code),
        message: text(value.message),
        ...(value.connectionId === undefined ? {} : { connectionId: identifier(value.connectionId) }),
      };
    case "offer":
    case "answer":
      return {
        type: kind,
        version,
        connectionId: identifier(value.connectionId),
        channel: channel(value.channel),
        sdp: identifier(value.sdp),
      };
    case "ice-candidate":
      return {
        type: kind,
        version,
        connectionId: identifier(value.connectionId),
        channel: channel(value.channel),
        candidate: identifier(value.candidate),
        sdpMid: value.sdpMid === null ? null : identifier(value.sdpMid),
        sdpMLineIndex: value.sdpMLineIndex === null ? null : integer(value.sdpMLineIndex),
      };
    case "ice-restart":
      return { type: kind, version, connectionId: identifier(value.connectionId), channel: channel(value.channel) };
    case "turn-refresh":
      return {
        type: kind,
        version,
        connectionId: value.connectionId === null ? null : identifier(value.connectionId),
      };
    case "disconnect":
      return { type: kind, version, connectionId: identifier(value.connectionId) };
    default:
      return null;
  }
}

function invalid(): never {
  throw new Error("Signal returned an invalid message.");
}

function text(value: unknown): string {
  if (!isString(value)) invalid();
  return value;
}

// Every identifier, token and SDP blob on this wire: the service rejects an empty one on the way in,
// so an empty one on the way out is a frame the peer cannot act on either.
function identifier(value: unknown): string {
  const candidate = text(value);
  if (candidate.length === 0) invalid();
  return candidate;
}

function integer(value: unknown): number {
  if (!isNumber(value) || !Number.isInteger(value)) invalid();
  return value;
}

function flag(value: unknown): boolean {
  if (!isBoolean(value)) invalid();
  return value;
}

function channel(value: unknown): SignalChannel {
  if (value !== "team" && value !== "remote-desktop") invalid();
  return value;
}

function memberRole(value: unknown): "owner" | "admin" | "member" {
  if (value !== "owner" && value !== "admin" && value !== "member") invalid();
  return value;
}

// Deliberately tolerant of an empty list. A deployment with no TURN configured is a decision its
// operator gets to make, and refusing the frame here would take that decision away from every
// client at once.
function iceServers(value: unknown): IceServer[] {
  if (!Array.isArray(value)) invalid();
  return value.map(iceServer);
}

function iceServer(value: unknown): IceServer {
  if (!isDynamicRecord(value)) invalid();
  return {
    urls: isString(value.urls) ? value.urls : urlList(value.urls),
    ...(value.username === undefined ? {} : { username: text(value.username) }),
    ...(value.credential === undefined ? {} : { credential: text(value.credential) }),
  };
}

function urlList(value: unknown): string[] {
  if (!Array.isArray(value)) invalid();
  return value.map(text);
}
