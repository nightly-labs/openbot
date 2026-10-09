import {
  isRemoteWorkspaceCache,
  isRemoteWorkspaceCachePreference,
  type RemoteWorkspaceCache,
} from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeRemoteWorkspaceCachePreference = guardedDecoder(
  isRemoteWorkspaceCachePreference,
  "saved copy preference",
);

const decodeRemoteWorkspaceCacheCopy = guardedDecoder(isRemoteWorkspaceCache, "saved copy");

/** The saved copy of one server, or null when main keeps none for it. */
export function decodeRemoteWorkspaceCache(value: unknown): RemoteWorkspaceCache | null {
  return value === null ? null : decodeRemoteWorkspaceCacheCopy(value);
}
