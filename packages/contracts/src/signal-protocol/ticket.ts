// The remote ticket: the ES256 JWT that authorises one peer to open a Signal socket.
//
// Three parties handle it and none of them ships together. `apps/auth-api` mints it
// (`remote-control-plane.ts`), the Signal service verifies it before it will relay anything
// (`remote/api/src/tokens.ts`), and the desktop host verifies the copy a client presents over the
// data channel (`src/main/central-auth-manager.ts`). Every one of them used to spell the audience
// and the protocol range out as a bare literal, so the issuer and its two verifiers agreed by
// coincidence rather than by construction.
//
// Types and constants only. Each party keeps its own verification - jose with a different key
// source in each - because what they are checking differs; what they may not differ on is the
// shape.

// The `aud` claim. A resume token is a different audience and never leaves the Signal service, so it
// is not here.
export const REMOTE_TICKET_AUDIENCE = "openbot-remote";

// The revision of the Signal-side protocol a ticket vouches for, minted as the `protocolMinimum` and
// `protocolMaximum` range and checked by the service against the one revision it implements. It is
// not `SIGNAL_PROTOCOL_VERSION`: that versions the individual socket frames, this versions what the
// ticket entitles the bearer to, and the two have moved independently.
export const REMOTE_TICKET_PROTOCOL_VERSION = 2;

export type RemoteRole = "host" | "owner" | "admin" | "member";

// The role of a peer that connected as a client. A host holds its own ticket and never appears here.
export type RemoteMemberRole = Exclude<RemoteRole, "host">;

export interface RemoteTicketClaims {
  aud: typeof REMOTE_TICKET_AUDIENCE;
  jti: string;
  sessionId: string;
  hostId: string;
  userId: string;
  membershipId: string;
  role: RemoteRole;
  // Bumped by the control plane whenever a host's access changes. A ticket minted against a stale
  // epoch is refused, which is how a revoked membership takes effect without waiting for `exp`.
  authEpoch: number;
  protocolMinimum: number;
  protocolMaximum: number;
  // Seconds, like `iat` and `exp` - not the milliseconds the account API works in.
  sessionExpiresAt: number;
  // Present only for a client ticket, and only once the client has generated its ed25519 identity:
  // it binds the ticket to the key that signs the handshake on the data channel.
  clientPublicKey?: string;
  iat: number;
  exp: number;
}
