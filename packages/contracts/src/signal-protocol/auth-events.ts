// The signed webhook body that the account server (`apps/auth-api`) posts to Signal
// (`remote/api`) at `/internal/auth-events`. Signal closes or refreshes the sockets it names.
// Types only: the account server writes these events, and Signal checks them with its own schema.

export type RemoteAuthEvent =
  | { type: "remote-auth-changed"; hostId: string; authEpoch: number }
  | { type: "remote-session-ended"; hostId: string; sessionId: string }
  // Addressed to an account rather than to a host: the device that accepted an invitation already
  // knows, and the user's other devices are the ones with a stale server list. Signal forwards it
  // to every socket that account holds, and each of them re-reads `/v2/remote/hosts/` once.
  | { type: "account-servers-changed"; userId: string }
  // Addressed to an account: its other devices re-read the account profile.
  | { type: "account-profile-changed"; userId: string };
