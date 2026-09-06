// The Signal wire protocol: the frames a peer and the Signal service exchange over `WSS /v1/signal`.
//
// Signal (`remote/api`) relays SDP and ICE between a host and its clients and hands out resume
// tokens and TURN credentials. It never sees a chat, a file or a command - those travel on the
// WebRTC data channels it helped negotiate, and their protocol is `../team-protocol` instead.
//
// Three parties speak this and none of them ships together: the service
// (`remote/api/src/signal-service.ts`), the shared client that mobile and the future web client run
// (`packages/team-client/src/remote-peer.ts`), and the desktop's hidden-window peer
// (`src/renderer/src/features/team/team-webrtc.ts`). Each wrote these shapes out by hand, and the
// desktop's copies had degraded into a flat `.loose()` bag of optionals: `sdp`, `candidate` and
// `resumeToken` were `string | undefined` on every branch, so the compiler could not tell a `ready`
// from an `ice-candidate` and every field had to be re-checked at the point of use.
//
// Types and constants only, so a client pays nothing at runtime to import them. Validation is one
// implementation per trust direction and is deliberately not shared: `remote/api` keeps its zod
// schema for the untrusted *client* input it accepts - byte limits, identifier patterns, a closed
// discriminated union - and `./decode.ts` carries the guards a client runs over the *service's*
// output. Neither is the other's mirror, and neither should grow into it.
//
// Unlike `../team-protocol` there are no frozen per-version artifacts here, because this protocol
// has only ever had one version. `version` on these frames is the socket protocol; the app protocol
// negotiated on the data channels is a different number entirely.

import type { RemoteMemberRole } from "./ticket";

export const SIGNAL_PROTOCOL_VERSION = 1;
export type SignalProtocolVersion = typeof SIGNAL_PROTOCOL_VERSION;

// Signal rejects a frame larger than this before it parses it.
export const SIGNAL_MESSAGE_BYTES_LIMIT = 64 * 1024;

// How long the TURN credentials Signal hands out stay usable. `remote/api` mints them for exactly
// this, capped by the session's own expiry.
export const SIGNAL_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

// When a connected peer should ask for replacements: three quarters of the way through, leaving a
// quarter of an hour to retry a refresh that throws or lands on a socket that is reconnecting.
// Derived from the TTL rather than restated beside it because the service and both clients each
// held their own copy of this relationship and nothing linked them - shortening the service's TTL
// would have left both peers refreshing on the old schedule with credentials that had already
// expired, and a peer only notices that when it needs the relay, so the connection would have kept
// working for everyone except the users behind a symmetric NAT.
export const SIGNAL_TURN_REFRESH_INTERVAL_MS = Math.floor(SIGNAL_TURN_CREDENTIAL_TTL_SECONDS * 0.75) * 1_000;

// Which side of the relay a socket is. Only a host may set `multiplex`.
export type SignalPeer = "host" | "client";

// Which negotiation a relayed frame belongs to. One socket carries both.
export type SignalChannel = "team" | "remote-desktop";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const SIGNAL_ERROR_CODES = [
  "authentication_required",
  "invalid_message",
  "host_unavailable",
  "host_busy",
  "permission_denied",
  "rate_limited",
  "session_revoked",
  "protocol_error",
] as const;

// What the service emits. A client must not narrow an incoming code to this - see the `error` frame.
export type SignalErrorCode = (typeof SIGNAL_ERROR_CODES)[number];

// The frames Signal passes through untouched: whatever one peer sends, the other receives exactly
// this. Both unions below include them, which is why they are named once.
export type SignalRelayMessage =
  | {
      type: "offer" | "answer";
      version: SignalProtocolVersion;
      connectionId: string;
      channel: SignalChannel;
      sdp: string;
    }
  | {
      type: "ice-candidate";
      version: SignalProtocolVersion;
      connectionId: string;
      channel: SignalChannel;
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    }
  | { type: "ice-restart"; version: SignalProtocolVersion; connectionId: string; channel: SignalChannel }
  // A null `connectionId` asks for the socket's own credentials rather than one connection's.
  | { type: "turn-refresh"; version: SignalProtocolVersion; connectionId: string | null }
  | { type: "disconnect"; version: SignalProtocolVersion; connectionId: string };

export type SignalClientMessage =
  | {
      type: "hello";
      version: SignalProtocolVersion;
      peer: SignalPeer;
      // A remote ticket on the first connect, a resume token on every reconnect after it.
      token: string;
      multiplex?: boolean;
    }
  | SignalRelayMessage;

export type SignalServerMessage =
  | {
      type: "ready";
      version: SignalProtocolVersion;
      connectionId: string | null;
      resumeToken: string;
      iceServers: IceServer[];
    }
  // A client attached to a multiplexing host. `resumed` distinguishes a reconnect of a session the
  // host already has from a new one it must set up from scratch.
  | {
      type: "peer-ready";
      version: SignalProtocolVersion;
      connectionId: string;
      sessionId: string;
      userId: string;
      membershipId: string;
      role: RemoteMemberRole;
      sessionExpiresAt: number;
      resumed: boolean;
    }
  // `code` is `string` rather than `SignalErrorCode` on purpose: a client decodes this from a
  // service it does not ship with, and a code a newer Signal has added is still a code it has to
  // surface. The service narrows its own emissions where it builds the frame.
  | { type: "error"; version: SignalProtocolVersion; code: string; message: string; connectionId?: string }
  | SignalRelayMessage;
