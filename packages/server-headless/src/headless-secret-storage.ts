// Headless secret storage: the file-key fallback of src/main/secret-storage-cipher.ts,
// without Electron safeStorage. Produces the SAME artifacts on disk:
//   <userData>/secret-storage.key           (base64 32B key, 0600)
//   <userData>/openbot-central-auth-v1.bin   (base64("obk1" + IV + GCM tag + ciphertext), 0600)
// so the packaged server and this module can read each other's session.
//
// Contract copied from src/main/secret-storage-cipher.ts (SecretStorageCipher):
//   encrypt: (value: string) => Buffer   — returns raw obk1 container bytes
//   decrypt: (value: Buffer) => string   — takes raw obk1 container bytes
//   canPersist: boolean
// The CentralAuthManager does the base64 dance itself when reading/writing the file
// (central-auth-manager.ts:2378-2417 write, :1538-1560 restore).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const KEY_FILE_FORMAT = Buffer.from("obk1", "ascii");
const IV_LENGTH = 12;

export interface HeadlessSecretStorageCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
  canPersist: boolean;
}

export function createHeadlessSecretStorage({ keyPath }: { keyPath: string }): {
  cipher: (unavailableMessage: () => string) => HeadlessSecretStorageCipher;
  madeKeyFile(): boolean;
} {
  let madeKeyFile = false;

  function loadOrCreateKey(): Buffer {
    mkdirSync(dirname(keyPath), { recursive: true });
    if (existsSync(keyPath)) return Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    const key = randomBytes(32);
    const tempDir = mkdtempSync(join(dirname(keyPath), ".key-"));
    const tempPath = join(tempDir, "key");
    writeFileSync(tempPath, key.toString("base64"));
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, keyPath);
    rmSync(tempDir, { recursive: true, force: true });
    madeKeyFile = true;
    return key;
  }

  return {
    madeKeyFile: () => madeKeyFile,
    cipher(unavailableMessage: () => string) {
      const key = loadOrCreateKey();
      return {
        canPersist: true,
        encrypt(value: string): Buffer {
          const iv = randomBytes(IV_LENGTH);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
          return Buffer.concat([KEY_FILE_FORMAT, iv, cipher.getAuthTag(), encrypted]);
        },
        decrypt(container: Buffer): string {
          if (!container.subarray(0, KEY_FILE_FORMAT.length).equals(KEY_FILE_FORMAT)) {
            throw new Error(unavailableMessage());
          }
          const iv = container.subarray(KEY_FILE_FORMAT.length, KEY_FILE_FORMAT.length + IV_LENGTH);
          const tagStart = KEY_FILE_FORMAT.length + IV_LENGTH;
          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(container.subarray(tagStart, tagStart + 16));
          return Buffer.concat([
            decipher.update(container.subarray(tagStart + 16)),
            decipher.final(),
          ]).toString("utf8");
        },
      };
    },
  };
}
