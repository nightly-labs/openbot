import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { PreferenceStore } from "./preference-file";
import type { SecretCipher } from "./provider-credential-store";
import { loadStoredP256Key, type StoredP256Key } from "./stored-p256-key";

const logger = createOpenBotLogger("watch-relay-key");

export type WatchRelayKey = StoredP256Key;

export function loadWatchRelayKey(path: string, cipher: SecretCipher) {
  return loadStoredP256Key(path, cipher, {
    cannotEncrypt: "The watch key cannot be encrypted. The Apple Watch uses the iPhone to reach this host.",
    cannotSave: "The watch key could not be saved. The Apple Watch uses the iPhone to reach this host.",
    warn: (message) => logger.warn(message),
  });
}

export interface WatchRelayWanted {
  wantedUntil: number;
}

export function createWatchRelayWantedStore(path: string): PreferenceStore<WatchRelayWanted> {
  return new PreferenceStore<WatchRelayWanted>({
    path,
    defaultValue: { wantedUntil: 0 },
    decode: (parsed) =>
      isDynamicRecord(parsed) &&
      parsed.version === 1 &&
      isNumber(parsed.wantedUntil) &&
      Number.isSafeInteger(parsed.wantedUntil)
        ? { wantedUntil: parsed.wantedUntil }
        : null,
  });
}
