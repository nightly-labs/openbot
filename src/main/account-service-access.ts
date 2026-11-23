import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { app, net } from "electron";
import { CentralAuthManager, readCentralAuthApiUrl, readMobileConnectApiUrl } from "./central-auth-manager";
import type { CompanySignInBrowser } from "./company-sign-in-browser";
import {
  createSecretStorage,
  SECRET_STORAGE_KEY_FILE,
  type SecretStorage,
  type SecretStorageCipher,
} from "./secret-storage-cipher";

const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";

let userDataSecretStorage: SecretStorage | null = null;

function secretStorage(): SecretStorage {
  userDataSecretStorage ??= createSecretStorage({
    keyPath: join(app.getPath("userData"), SECRET_STORAGE_KEY_FILE),
  });
  return userDataSecretStorage;
}

export function safeStorageCipher(
  unavailableKey: "error.app.secretStorageUnavailable" | "error.app.macSecureStorageUnavailable",
): SecretStorageCipher {
  return secretStorage().cipher(() => sourceText(unavailableKey));
}

async function accountServiceFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  try {
    return await net.fetch(input instanceof URL ? input.href : input, {
      ...init,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const code = /^net::(ERR_[A-Z0-9_]+)$/u.exec(error.message)?.[1];
    if (code === undefined) throw error;
    throw new TypeError("fetch failed", { cause: Object.assign(error, { code }) });
  }
}

export function centralAuthApiUrl(): string {
  return readCentralAuthApiUrl(
    process.env.OPENBOT_AUTH_API_URL,
    app.isPackaged ? "https://api.openbot.run" : "http://127.0.0.1:3100",
  );
}

export function createCentralAuthManager(options: {
  companySignInBrowser?: CompanySignInBrowser;
  confirmSessionAtStart: boolean;
}): CentralAuthManager {
  const apiUrl = centralAuthApiUrl();
  return new CentralAuthManager({
    apiUrl,
    mobileConnectApiUrl: readMobileConnectApiUrl(process.env.OPENBOT_MOBILE_AUTH_API_URL, apiUrl),
    storagePath: join(app.getPath("userData"), CENTRAL_AUTH_FILE),
    fetch: accountServiceFetch,
    ...safeStorageCipher("error.app.macSecureStorageUnavailable"),
    keyringChanged: () => secretStorage().madeKeyFile(),
    ...(options.companySignInBrowser ? { companySignInBrowser: options.companySignInBrowser } : {}),
    confirmSessionAtStart: options.confirmSessionAtStart,
  });
}
