// Electron side of `scripts/linux-secret-storage-e2e.ts`. It runs one step with the secret storage of
// `src/main/secret-storage-cipher.ts`, writes the result to `--ready-file` and quits.
// Steps: `write` encrypts `--value=` into `--blob=`; `read` decrypts `--blob=`; `legacy-write` encrypts
// with `safeStorage` only, as a release before the key file did.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { configureLinuxPasswordStore } from "../src/main/linux-password-store";
import { createSecretStorage, SECRET_STORAGE_KEY_FILE } from "../src/main/secret-storage-cipher";

/** What one step writes to `--ready-file`. */
interface StepReport {
  backend: string;
  keyringAvailable: boolean;
  /** `canPersist()` before `ready`, and whether it made the key file. */
  canPersistBeforeReady: boolean;
  keyFileBeforeReady: boolean;
  canPersist?: boolean;
  format?: string;
  value?: string;
  error?: string;
  madeKeyFile?: boolean;
  keyFileMode?: string | null;
}

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
app.setPath("userData", argument("user-data"));
configureLinuxPasswordStore();
const keyPath = join(app.getPath("userData"), SECRET_STORAGE_KEY_FILE);
const storage = createSecretStorage({ keyPath });
const cipher = storage.cipher(() => "No secret storage.");
const canPersistBeforeReady = cipher.canPersist();
const keyFileBeforeReady = existsSync(keyPath);
// No top-level await: Electron does not get ready until an ESM main module has run to its end.
void app.whenReady().then(() => {
  const blobPath = argument("blob");
  const step = argument("step");
  const result: StepReport = {
    backend: safeStorage.getSelectedStorageBackend(),
    keyringAvailable: safeStorage.isEncryptionAvailable(),
    canPersistBeforeReady,
    keyFileBeforeReady,
  };
  try {
    if (step === "legacy-write") {
      writeFileSync(blobPath, safeStorage.encryptString(argument("value")));
      result.format = readFileSync(blobPath).subarray(0, 3).toString("latin1");
    } else if (step === "write") {
      result.canPersist = cipher.canPersist();
      const blob = cipher.encrypt(argument("value"));
      writeFileSync(blobPath, blob);
      // The key file prefix is `obk1`; a `safeStorage` prefix is `v10` or `v11`.
      const prefix = blob.subarray(0, 4).toString("latin1");
      result.format = prefix === "obk1" ? prefix : prefix.slice(0, 3);
    } else {
      result.value = cipher.decrypt(readFileSync(blobPath));
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.madeKeyFile = storage.madeKeyFile();
  result.keyFileMode = existsSync(keyPath) ? (statSync(keyPath).mode & 0o777).toString(8) : null;
  writeFileSync(argument("ready-file"), JSON.stringify(result));
  app.quit();
});
