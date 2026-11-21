// Headless secret storage: the file-key fallback of src/main/secret-storage-cipher.ts,
// without Electron safeStorage. Produces the SAME artifacts on disk:
//   ~/.config/OpenBot/secret-storage.key      (base64 32B key, 0600)
//   ~/.config/OpenBot/openbot-central-auth-v1.bin  (base64 "obk1" + IV + GCM tag + ciphertext)
// so the packaged server and this module can read each other's session.
//
// Copy of the audit: on Linux keyFileFallback is true (secret-storage-cipher.ts:44-45);
// keyForWrite (:100-107) prefers userData/secret-storage.key; createKey (:61-98) writes
// a random 32B key with mode 0600. This module always takes the file path — identical
// to --password-store=basic behavior (safeStorage unavailable -> file key).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const PREFIX = "obk1";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface HeadlessSecretStorage {
  cipher(reason: () => string): {
    encrypt(value: string): Promise<string>;
    decrypt(container: string): Promise<string>;
    canPersist: boolean;
    madeKeyFile(): boolean;
  };
  madeKeyFile(): boolean;
}

export function createHeadlessSecretStorage({ keyPath }: { keyPath: string }): HeadlessSecretStorage {
  let madeKeyFile = false;

  function loadOrCreateKey(): Buffer {
    mkdirSync(dirname(keyPath), { recursive: true });
    if (existsSync(keyPath)) {
      const raw = readFileSync(keyPath, "utf8").trim();
      return Buffer.from(raw, "base64");
    }
    const key = randomBytes(32);
    const temp = mkdtempSync(dirname(keyPath));
    const tempPath = join(temp, "key");
    writeFileSync(tempPath, key.toString("base64"));
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, keyPath);
    rmSync(temp, { recursive: true });
    madeKeyFile = true;
    return key;
  }

  // Same container format as secret-storage-cipher.ts: base64(prefix || iv || tag || ct).
  function cipher(reason: () => string) {
    const key = loadOrCreateKey();
    return {
      canPersist: true,
      async encrypt(value: string): Promise<string> {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([Buffer.from(PREFIX, "ascii"), iv, tag, ciphertext]).toString("base64");
      },
      async decrypt(container: string): Promise<string> {
        const raw = Buffer.from(container, "base64");
        if (raw.subarray(0, 4).toString("ascii") !== PREFIX) throw new Error(reason());
        const iv = raw.subarray(4, 4 + IV_LENGTH);
        const tag = raw.subarray(4 + IV_LENGTH, 4 + IV_LENGTH + TAG_LENGTH);
        const ciphertext = raw.subarray(4 + IV_LENGTH + TAG_LENGTH);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      },
      madeKeyFile: () => madeKeyFile,
    };
  }

  return { cipher, madeKeyFile: () => madeKeyFile };
}
