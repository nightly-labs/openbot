import { type GoogleConnectionsSnapshot, parseGoogleConnectionsSnapshot } from "@openbot/contracts/ipc";
/** Network boundary: rejects malformed or oversized account metadata before main uses it. */
export function decodeGoogleConnectionsFromHost(value: unknown): GoogleConnectionsSnapshot {
  return parseGoogleConnectionsSnapshot(value);
}
