import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { app, safeStorage } from "electron";
import { configureLinuxPasswordStore } from "../src/main/linux-password-store";
import {
  createSecretStorage,
  SECRET_STORAGE_KEY_FILE,
  type SecretStorageCipher,
} from "../src/main/secret-storage-cipher";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";

interface StepReport {
  backend: string;
  keyringAvailable: boolean;
  canPersistBeforeReady: boolean;
  keyFileBeforeReady: boolean;
  canPersist?: boolean;
  format?: string;
  value?: string;
  error?: string;
  madeKeyFile?: boolean;
  keyFileMode?: string | null;
  vaultStatus?: string;
  vaultStatusAfterReset?: string;
  vaultLogins?: number;
  vaultFile?: string | null;
}

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

const KEYCHAIN_FORMAT_RECORD = Buffer.concat([Buffer.from("v10", "latin1"), Buffer.alloc(32, 7)]);

function vaultFileHash(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

async function runVaultStep(step: string, path: string, cipher: SecretStorageCipher, result: StepReport) {
  const store = new VaultStore(path, cipher);
  if (step === "vault-seed") {
    writeFileSync(path, JSON.stringify({ version: 1, record: KEYCHAIN_FORMAT_RECORD.toString("base64") }));
  } else if (step === "vault-save") {
    const login = { id: "e2e", website: "https://example.com", username: "e2e", password: "vault-e2e", notes: "" };
    await Effect.runPromise(store.update((record) => ({ ...record, logins: [login] })));
  } else {
    const vault = new VaultService({ store, canPersist: cipher.canPersist });
    result.vaultStatus = await Effect.runPromise(vault.load());
    result.vaultLogins = store.read().logins.length;
    if (process.argv.includes("--try-reset"))
      result.vaultStatusAfterReset = (await Effect.runPromise(vault.reset())).status;
  }
  result.vaultFile = vaultFileHash(path);
}

process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
app.setPath("userData", argument("user-data"));
configureLinuxPasswordStore();
const keyPath = join(app.getPath("userData"), SECRET_STORAGE_KEY_FILE);
const platformArgument = process.argv.find((item) => item.startsWith("--platform="));
const storage = createSecretStorage({
  keyPath,
  ...(platformArgument === "--platform=darwin" ? { platform: "darwin" as const } : {}),
});
const cipher = storage.cipher(() => "No secret storage.");
const canPersistBeforeReady = cipher.canPersist();
const keyFileBeforeReady = existsSync(keyPath);
void app.whenReady().then(async () => {
  const blobPath = argument("blob");
  const step = argument("step");
  const result: StepReport = {
    backend: safeStorage.getSelectedStorageBackend(),
    keyringAvailable: safeStorage.isEncryptionAvailable(),
    canPersistBeforeReady,
    keyFileBeforeReady,
  };
  try {
    if (step.startsWith("vault-")) {
      await runVaultStep(step, blobPath, cipher, result);
    } else if (step === "legacy-write") {
      writeFileSync(blobPath, safeStorage.encryptString(argument("value")));
      result.format = readFileSync(blobPath).subarray(0, 3).toString("latin1");
    } else if (step === "write") {
      result.canPersist = cipher.canPersist();
      const blob = cipher.encrypt(argument("value"));
      writeFileSync(blobPath, blob);
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
