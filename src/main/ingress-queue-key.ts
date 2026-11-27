import { createOpenBotLogger } from "@openbot/logging";
import type { SecretCipher } from "./provider-credential-store";
import { loadStoredP256Key, type StoredP256Key } from "./stored-p256-key";

const logger = createOpenBotLogger("ingress-queue-key");

export type IngressQueueKey = StoredP256Key;

export function loadIngressQueueKey(path: string, cipher: SecretCipher) {
  return loadStoredP256Key(path, cipher, {
    cannotEncrypt: "The queue key cannot be encrypted. Signal keeps no event for this host while it sleeps.",
    cannotSave: "The queue key could not be saved. Signal keeps no event for this host while it sleeps.",
    warn: (message) => logger.warn(message),
  });
}
