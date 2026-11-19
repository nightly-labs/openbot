import { type RemoteHostKeyStore, remoteHostFingerprint } from "@openbot/team-client";
import { accountScope } from "@/shared/lib/account-scope";
import * as LockedKeychain from "@/shared/lib/locked-keychain";

export function trustedHostKeys(apiUrl: string, userId: string): RemoteHostKeyStore {
  const scope = accountScope(apiUrl, userId);
  const key = (hostId: string) => `openbot.host-key.v1.${scope}.${remoteHostFingerprint(hostId)}`;
  return {
    get: (hostId) => LockedKeychain.getItemAsync(key(hostId)),
    set: (hostId, publicKey) => LockedKeychain.setItemAsync(key(hostId), publicKey),
  };
}
