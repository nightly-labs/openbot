import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { app, safeStorage } from "electron";
import { isMissingFileError } from "../backend/file-errors";

export const SECRET_STORAGE_KEY_FILE = "secret-storage.key";

const KEY_FILE_FORMAT = Buffer.from("obk1", "ascii");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const logger = createOpenBotLogger("secret-storage");

export interface SecretStorageCipher {
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export interface SecretStorage {
  cipher: (unavailableMessage: () => string) => SecretStorageCipher;
  madeKeyFile: () => boolean;
}

function isExistingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

export function createSecretStorage(options: { keyPath: string; platform?: NodeJS.Platform }): SecretStorage {
  const platform = options.platform ?? process.platform;
  const linux = platform === "linux";
  const windows = platform === "win32";
  const keyFileFallback = linux || windows || platform === "darwin";
  let madeKeyFile = false;

  function readKey(): Buffer | null {
    let text: string;
    try {
      text = readFileSync(options.keyPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
    const value = Buffer.from(text.trim(), "base64");
    if (value.length !== KEY_BYTES) throw new Error("The secret storage key file is not valid.");
    return value;
  }

  function createKey(reason: "unavailable" | "decrypt"): Buffer {
    const existing = readKey();
    if (existing) return existing;
    const folder = dirname(options.keyPath);
    mkdirSync(folder, { recursive: true });
    const temporaryPath = `${options.keyPath}.${randomUUID()}.tmp`;
    try {
      const file = openSync(temporaryPath, "wx", 0o600);
      try {
        writeSync(file, `${randomBytes(KEY_BYTES).toString("base64")}\n`);
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      chmodSync(temporaryPath, 0o600);
      try {
        linkSync(temporaryPath, options.keyPath);
      } catch (error) {
        if (!isExistingFile(error)) throw error;
      }
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    if (!windows) {
      const folderHandle = openSync(folder, "r");
      try {
        fsyncSync(folderHandle);
      } finally {
        closeSync(folderHandle);
      }
    }
    const created = readKey();
    if (!created) throw new Error("The secret storage key file was not made.");
    madeKeyFile = true;
    logger.warn("The system keyring did not keep the secrets. OpenBot keeps new secrets in its own key file.", {
      reason,
      backend: linux ? safeStorage.getSelectedStorageBackend() : platform,
    });
    return created;
  }

  function keyForWrite(): Buffer | null {
    if (!keyFileFallback) return null;
    if (!linux && safeStorage.isEncryptionAvailable()) return null;
    const existing = readKey();
    if (existing) return existing;
    if (!app.isReady() || safeStorage.isEncryptionAvailable()) return null;
    return createKey("unavailable");
  }

  const canPersist = () => {
    try {
      return keyForWrite() !== null || safeStorage.isEncryptionAvailable();
    } catch (error) {
      logger.warn("The secret storage key file could not be used.", {
        error: error instanceof Error ? error.name : typeof error,
      });
      return false;
    }
  };

  const encrypt = (value: string, unavailableMessage: () => string): Buffer => {
    let fileKey: Buffer | null;
    try {
      fileKey = keyForWrite();
    } catch (error) {
      logger.warn("The secret storage key file could not be used.", {
        error: error instanceof Error ? error.name : typeof error,
      });
      throw new Error(unavailableMessage());
    }
    if (!fileKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error(unavailableMessage());
      return safeStorage.encryptString(value);
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", fileKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([KEY_FILE_FORMAT, iv, cipher.getAuthTag(), encrypted]);
  };

  const decrypt = (value: Buffer): string => {
    if (keyFileFallback && value.subarray(0, KEY_FILE_FORMAT.length).equals(KEY_FILE_FORMAT)) {
      const fileKey = readKey();
      if (!fileKey) throw new Error("The secret storage key file is missing.");
      const body = value.subarray(KEY_FILE_FORMAT.length);
      const decipher = createDecipheriv("aes-256-gcm", fileKey, body.subarray(0, IV_BYTES));
      decipher.setAuthTag(body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([decipher.update(body.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    }
    try {
      return safeStorage.decryptString(value);
    } catch (error) {
      if (linux && app.isReady()) {
        try {
          createKey("decrypt");
        } catch (keyError) {
          logger.warn("The secret storage key file could not be made.", {
            error: keyError instanceof Error ? keyError.name : typeof keyError,
          });
        }
      }
      throw error;
    }
  };

  return {
    cipher: (unavailableMessage) => ({
      canPersist,
      encrypt: (value) => encrypt(value, unavailableMessage),
      decrypt,
    }),
    madeKeyFile: () => madeKeyFile,
  };
}
