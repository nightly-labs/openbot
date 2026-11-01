import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

/**
 * The WhatsApp account connection of this computer: OpenBot links itself to the user's own WhatsApp
 * account as a linked device, as WhatsApp Web does, so agents can read the user's chats and, when the
 * user allows it, send messages as the user. The phone stays the primary device.
 *
 * The keys of the linked device and the chats that WhatsApp sends to it stay in main, encrypted at
 * rest. The renderer gets the status only. A link goes through these states:
 *
 * - `disconnected`: this computer is not linked.
 * - `connecting`: main talks to WhatsApp, between two steps.
 * - `qr`: the user scans `qrCode` with WhatsApp on the phone (Settings > Linked devices > Link a device).
 * - `phone`: the user types the phone number of the account, to link with a code instead of a QR code.
 * - `code`: the user types `pairingCode` on the phone (Link with phone number instead).
 * - `connected`: agents can use the account.
 */
export type WhatsAppAccountConnectorState = "disconnected" | "connecting" | "qr" | "phone" | "code" | "connected";

export const WHATSAPP_ACCOUNT_CONNECTOR_STATES: readonly WhatsAppAccountConnectorState[] = [
  "disconnected",
  "connecting",
  "qr",
  "phone",
  "code",
  "connected",
];

function isWhatsAppAccountConnectorState(value: unknown): value is WhatsAppAccountConnectorState {
  return WHATSAPP_ACCOUNT_CONNECTOR_STATES.some((state) => state === value);
}

/** How the user links: a QR code scanned on the phone, or a code typed on the phone. */
export type WhatsAppAccountLinkMethod = "qr" | "phone";

function isWhatsAppAccountLinkMethod(value: unknown): value is WhatsAppAccountLinkMethod {
  return value === "qr" || value === "phone";
}

/** The linked account, as the user knows it. The phone number has its middle hidden. */
export interface WhatsAppAccount {
  name: string;
  phone: string | null;
}

/** What this computer has received from the phone so far. WhatsApp sends recent history only. */
export interface WhatsAppAccountHistory {
  chats: number;
  messages: number;
}

export interface WhatsAppAccountConnectorStatus {
  state: WhatsAppAccountConnectorState;
  /** The method of the link in progress, or null. */
  method: WhatsAppAccountLinkMethod | null;
  /**
   * The text that the QR code holds, set only in `qr`. It lets a phone link this computer for about
   * 20 seconds; main replaces it before it expires.
   */
  qrCode: string | null;
  /** When `qrCode` expires, in milliseconds since the epoch. */
  qrExpiresAt: number | null;
  /** Set only in `code`: the eight characters that the user types on the phone. */
  pairingCode: string | null;
  /** Set only in `connected`. */
  account: WhatsAppAccount | null;
  /** Set only in `connected`. */
  history: WhatsAppAccountHistory | null;
  /** Whether agents can send messages and mark chats as read. Off until the user turns it on. */
  sendingEnabled: boolean;
  /** The last failure, as a sentence. Null after a success or a cancel. */
  error: string | null;
}

export const DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR: WhatsAppAccountConnectorStatus = {
  state: "disconnected",
  method: null,
  qrCode: null,
  qrExpiresAt: null,
  pairingCode: null,
  account: null,
  history: null,
  sendingEnabled: false,
  error: null,
};

/** Starts a link with `method`. */
export interface WhatsAppAccountConnectInput {
  method: WhatsAppAccountLinkMethod;
}

/** The phone number that the `phone` state asks for, in international form. */
export interface WhatsAppAccountSubmitInput {
  field: "phone";
  value: string;
}

/** The longest value that `submit` accepts. A phone number with spaces and a plus is short. */
export const WHATSAPP_ACCOUNT_SUBMIT_LIMIT = 32;

function parseWhatsAppAccount(value: unknown): WhatsAppAccount | null {
  if (!isDynamicRecord(value) || !isString(value.name) || !(value.phone === null || isString(value.phone))) {
    return null;
  }
  return { name: value.name, phone: value.phone };
}

function parseWhatsAppAccountHistory(value: unknown): WhatsAppAccountHistory | null {
  if (!isDynamicRecord(value) || !isNumber(value.chats) || !isNumber(value.messages)) return null;
  return { chats: value.chats, messages: value.messages };
}

/** Returns null for a value that is not a connector status in the desktop shape. */
export function parseWhatsAppAccountConnectorStatus(value: unknown): WhatsAppAccountConnectorStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isWhatsAppAccountConnectorState(value.state) ||
    !(value.method === null || isWhatsAppAccountLinkMethod(value.method)) ||
    !(value.qrCode === null || isString(value.qrCode)) ||
    !(value.qrExpiresAt === null || isNumber(value.qrExpiresAt)) ||
    !(value.pairingCode === null || isString(value.pairingCode)) ||
    !isBoolean(value.sendingEnabled) ||
    !(value.error === null || isString(value.error))
  ) {
    return null;
  }
  const account = value.account === null ? null : parseWhatsAppAccount(value.account);
  if (value.account !== null && account === null) return null;
  const history = value.history === null ? null : parseWhatsAppAccountHistory(value.history);
  if (value.history !== null && history === null) return null;
  return {
    state: value.state,
    method: value.method,
    qrCode: value.qrCode,
    qrExpiresAt: value.qrExpiresAt,
    pairingCode: value.pairingCode,
    account,
    history,
    sendingEnabled: value.sendingEnabled,
    error: value.error,
  };
}

/**
 * The status of a joined server's connection (`whatsapp-account-connector-v1`), in the desktop shape.
 * A state or method that this build does not know shows as not connected. Throws for a value that is
 * not a host status.
 */
export function decodeHostWhatsAppAccountConnectorStatus(value: unknown): WhatsAppAccountConnectorStatus {
  if (!isDynamicRecord(value) || !isString(value.state)) {
    throw new Error("Invalid WhatsApp account connector response.");
  }
  const known = parseWhatsAppAccountConnectorStatus(value);
  if (known) return known;
  if (!isBoolean(value.sendingEnabled) || !(value.error === null || isString(value.error))) {
    throw new Error("Invalid WhatsApp account connector response.");
  }
  return { ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR, sendingEnabled: value.sendingEnabled, error: value.error };
}
