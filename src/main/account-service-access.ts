// The account service access of main: the secret storage of userData and the account manager that
// uses it. The services of the app and the server safe mode (`server-safe-mode.ts`) make the account
// manager in the same way, so both read the same session file and the same host credentials.
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

/** The secret storage of userData. Made at first use, when userData has its final path. */
function secretStorage(): SecretStorage {
  userDataSecretStorage ??= createSecretStorage({
    keyPath: join(app.getPath("userData"), SECRET_STORAGE_KEY_FILE),
  });
  return userDataSecretStorage;
}

/** The cipher that every encrypted file in userData uses: `safeStorage`, or the Linux and macOS key file. */
export function safeStorageCipher(
  unavailableKey: "error.app.secretStorageUnavailable" | "error.app.macSecureStorageUnavailable",
): SecretStorageCipher {
  return secretStorage().cipher(() => sourceText(unavailableKey));
}

/**
 * The account service requests go through Chromium's network stack, which uses the computer's proxy
 * settings as the built-in browser does. Node `fetch` ignores them, so the server list and a
 * connection timed out on a network that needs the system proxy (#10314). The requests carry a
 * bearer token: they send no browser cookie and use no HTTP cache, as with Node `fetch`.
 *
 * A Chromium network failure (`net::ERR_CONNECTION_REFUSED`) is thrown as Node `fetch` throws one,
 * a `TypeError` with the code in `cause.code`, because the account and connection errors read that.
 * An abort rejects with the signal's reason, as in Node.
 */
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

/** The account service address: the released one, or the local one in development. */
export function centralAuthApiUrl(): string {
  return readCentralAuthApiUrl(
    process.env.OPENBOT_AUTH_API_URL,
    app.isPackaged ? "https://api.openbot.run" : "http://127.0.0.1:3100",
  );
}

/** The account manager of userData. The caller initializes and disposes it. */
export function createCentralAuthManager(options: {
  companySignInBrowser?: CompanySignInBrowser;
  /** A hosted server: see `CentralAuthManagerOptions.confirmSessionAtStart`. */
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
