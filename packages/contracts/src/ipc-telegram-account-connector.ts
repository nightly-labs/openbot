import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

/**
 * The Telegram account connection of this computer: OpenBot signs in to the user's own Telegram
 * account, as Telegram Desktop does, so agents can read the user's chats and, when the user allows
 * it, send messages as the user. It is a different thing from the OpenBot Telegram bot (`telegram`),
 * which lets people talk to agents in Telegram chats.
 *
 * The session and the API credentials stay in main, encrypted at rest. The renderer gets the status
 * only. A sign-in goes through these states:
 *
 * - `disconnected`: no session is stored.
 * - `connecting`: main talks to Telegram, between two steps.
 * - `qr`: the user scans `qrUrl` with Telegram on a phone (Settings > Devices > Link Desktop Device).
 * - `phone`: the user types the phone number of the account.
 * - `code`: the user types the code that Telegram sent (`codeViaApp` says where).
 * - `password`: the account has two-step verification. The user types its password.
 * - `connected`: agents can use the account.
 */
export type TelegramAccountConnectorState =
  | "disconnected"
  | "connecting"
  | "qr"
  | "phone"
  | "code"
  | "password"
  | "connected";

export const TELEGRAM_ACCOUNT_CONNECTOR_STATES: readonly TelegramAccountConnectorState[] = [
  "disconnected",
  "connecting",
  "qr",
  "phone",
  "code",
  "password",
  "connected",
];

function isTelegramAccountConnectorState(value: unknown): value is TelegramAccountConnectorState {
  return TELEGRAM_ACCOUNT_CONNECTOR_STATES.some((state) => state === value);
}

/** How the user signs in: a QR code scanned in Telegram on a phone, or the number and a code. */
export type TelegramAccountSignInMethod = "qr" | "phone";

function isTelegramAccountSignInMethod(value: unknown): value is TelegramAccountSignInMethod {
  return value === "qr" || value === "phone";
}

/** The signed-in account, as the user knows it. The phone number has its middle hidden. */
export interface TelegramAccount {
  name: string;
  username: string | null;
  phone: string | null;
}

export interface TelegramAccountConnectorStatus {
  state: TelegramAccountConnectorState;
  /** The method of the sign-in in progress, or null. */
  method: TelegramAccountSignInMethod | null;
  /**
   * The `tg://login` address that the QR code holds, set only in `qr`. It lets a phone sign in to
   * this connection for about 30 seconds; main replaces it before it expires.
   */
  qrUrl: string | null;
  /** When `qrUrl` expires, in milliseconds since the epoch. */
  qrExpiresAt: number | null;
  /** Set only in `code`: true when Telegram sent the code to the Telegram app, false for an SMS. */
  codeViaApp: boolean | null;
  /** Set only in `password`: the hint that the user gave the password, or null. */
  passwordHint: string | null;
  /** Set only in `connected`. */
  account: TelegramAccount | null;
  /** Whether agents can send messages and mark chats as read. Off until the user turns it on. */
  sendingEnabled: boolean;
  /** The last failure, as a sentence. Null after a success or a cancel. */
  error: string | null;
}

export const DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR: TelegramAccountConnectorStatus = {
  state: "disconnected",
  method: null,
  qrUrl: null,
  qrExpiresAt: null,
  codeViaApp: null,
  passwordHint: null,
  account: null,
  sendingEnabled: false,
  error: null,
};

/**
 * Starts a sign-in. `apiId` and `apiHash` are the Telegram app of the user, from my.telegram.org.
 * They are null when this computer already stores them, so a new sign-in does not ask again.
 */
export interface TelegramAccountConnectInput {
  method: TelegramAccountSignInMethod;
  apiId: number | null;
  apiHash: string | null;
}

/** One value that the current state asks for. */
export interface TelegramAccountSubmitInput {
  field: "phone" | "code" | "password";
  value: string;
}

export const TELEGRAM_ACCOUNT_API_HASH_PATTERN = /^[0-9a-f]{32}$/u;
/** The longest value that `submit` accepts. A two-step password can be long; nothing else is. */
export const TELEGRAM_ACCOUNT_SUBMIT_LIMIT = 256;

function parseTelegramAccount(value: unknown): TelegramAccount | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.name) ||
    !(value.username === null || isString(value.username)) ||
    !(value.phone === null || isString(value.phone))
  ) {
    return null;
  }
  return { name: value.name, username: value.username, phone: value.phone };
}

/** Returns null for a value that is not a connector status in the desktop shape. */
export function parseTelegramAccountConnectorStatus(value: unknown): TelegramAccountConnectorStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isTelegramAccountConnectorState(value.state) ||
    !(value.method === null || isTelegramAccountSignInMethod(value.method)) ||
    !(value.qrUrl === null || isString(value.qrUrl)) ||
    !(value.qrExpiresAt === null || isNumber(value.qrExpiresAt)) ||
    !(value.codeViaApp === null || isBoolean(value.codeViaApp)) ||
    !(value.passwordHint === null || isString(value.passwordHint)) ||
    !isBoolean(value.sendingEnabled) ||
    !(value.error === null || isString(value.error))
  ) {
    return null;
  }
  const account = value.account === null ? null : parseTelegramAccount(value.account);
  if (value.account !== null && account === null) return null;
  return {
    state: value.state,
    method: value.method,
    qrUrl: value.qrUrl,
    qrExpiresAt: value.qrExpiresAt,
    codeViaApp: value.codeViaApp,
    passwordHint: value.passwordHint,
    account,
    sendingEnabled: value.sendingEnabled,
    error: value.error,
  };
}

/**
 * The status of a joined server's connection (`telegram-account-connector-v1`), in the desktop shape.
 * A state or method that this build does not know shows as not connected. Throws for a value that is
 * not a host status.
 */
export function decodeHostTelegramAccountConnectorStatus(value: unknown): TelegramAccountConnectorStatus {
  if (!isDynamicRecord(value) || !isString(value.state)) {
    throw new Error("Invalid Telegram account connector response.");
  }
  const known = parseTelegramAccountConnectorStatus(value);
  if (known) return known;
  if (!isBoolean(value.sendingEnabled) || !(value.error === null || isString(value.error))) {
    throw new Error("Invalid Telegram account connector response.");
  }
  return { ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR, sendingEnabled: value.sendingEnabled, error: value.error };
}
