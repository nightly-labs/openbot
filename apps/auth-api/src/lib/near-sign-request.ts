import type { NearOwnerAction } from "@openbot/contracts/ipc";

export type NearJsonValue = string | number | boolean | null | NearJsonValue[] | NearJsonObject;
export interface NearJsonObject {
  [key: string]: NearJsonValue;
}

export interface NearWebAuthnPayload {
  challenge: string;
  rpId: string;
  allowCredentials: { id: string; type: "public-key" }[];
  userVerification: "required";
  timeout: number;
}

export type NearSignRequest =
  | { kind: "register"; nonce: string; summary: string; challenge: string; userId: string; port: number | null }
  | {
      kind: "sign";
      nonce: string;
      action: Exclude<NearOwnerAction, "register">;
      summary: string;
      payload: NearWebAuthnPayload;
      port: number | null;
    };

const OWNER_ACTIONS = {
  register: true,
  create: true,
  grant: true,
  budget: true,
  freeze: true,
  unfreeze: true,
  "auto-pay": true,
  "approve-payment": true,
  "check-backup": true,
} as const satisfies Record<NearOwnerAction, true>;

const FRAGMENT_KEYS = new Set(["v", "nonce", "kind", "action", "summary", "challenge", "userId", "intent", "port"]);

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_FRAGMENT_CHARS = 64 * 1024;
const MAX_SUMMARY_CHARS = 2000;
const MAX_ID_CHARS = 1366;

export function nearJsonValue(value: unknown): NearJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: NearJsonValue[] = [];
    for (const item of value) {
      const checked = nearJsonValue(item);
      if (checked === undefined) return undefined;
      items.push(checked);
    }
    return items;
  }
  if (typeof value !== "object") return undefined;
  const object: NearJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const checked = nearJsonValue(item);
    if (checked === undefined) return undefined;
    object[key] = checked;
  }
  return object;
}

export function isNearJsonObject(value: NearJsonValue | undefined): value is NearJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64url(value: NearJsonValue | undefined, max = MAX_ID_CHARS): value is string {
  return typeof value === "string" && value.length <= max && BASE64URL_PATTERN.test(value);
}

function isOwnerAction(value: NearJsonValue | undefined): value is NearOwnerAction {
  return typeof value === "string" && Object.hasOwn(OWNER_ACTIONS, value);
}

function isSignAction(value: NearJsonValue | undefined): value is Exclude<NearOwnerAction, "register"> {
  return isOwnerAction(value) && value !== "register";
}

function webAuthnPayload(value: NearJsonValue | undefined): NearWebAuthnPayload | null {
  if (!isNearJsonObject(value) || !isBase64url(value.challenge) || typeof value.rpId !== "string") return null;
  if (value.userVerification !== "required" || !Array.isArray(value.allowCredentials)) return null;
  const timeout = value.timeout;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0) return null;
  const allowCredentials: NearWebAuthnPayload["allowCredentials"] = [];
  for (const credential of value.allowCredentials) {
    if (!isNearJsonObject(credential) || !isBase64url(credential.id) || credential.type !== "public-key") return null;
    allowCredentials.push({ id: credential.id, type: "public-key" });
  }
  return { challenge: value.challenge, rpId: value.rpId, allowCredentials, userVerification: "required", timeout };
}

function returnPort(value: NearJsonValue | undefined): number | null | undefined {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : undefined;
}

export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(value)) throw new Error("not base64url");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function parseNearSignFragment(fragment: string): NearSignRequest | null {
  if (fragment.length === 0 || fragment.length > MAX_FRAGMENT_CHARS) return null;
  let value: NearJsonValue | undefined;
  try {
    value = nearJsonValue(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64urlToBytes(fragment))));
  } catch {
    return null;
  }
  if (!isNearJsonObject(value) || Object.keys(value).some((key) => !FRAGMENT_KEYS.has(key))) return null;
  const { v, nonce, kind, action, summary } = value;
  if (v !== 1 || typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) return null;
  if (typeof summary !== "string" || summary.length > MAX_SUMMARY_CHARS) return null;
  const port = returnPort(value.port);
  if (port === undefined) return null;
  if (kind === "register") {
    if (action !== "register" || !isBase64url(value.challenge, 128) || !isBase64url(value.userId, 128)) return null;
    if (value.intent !== undefined) return null;
    return { kind, nonce, summary, challenge: value.challenge, userId: value.userId, port };
  }
  if (kind !== "sign" || !isSignAction(action)) return null;
  if (value.challenge !== undefined || value.userId !== undefined || !isNearJsonObject(value.intent)) return null;
  const { standard, payload } = value.intent;
  if (Object.keys(value.intent).some((key) => key !== "standard" && key !== "payload")) return null;
  const checked = standard === "webauthn" ? webAuthnPayload(payload) : null;
  if (!checked) return null;
  return { kind, nonce, action, summary, payload: checked, port };
}

export function nearSignAction(request: NearSignRequest): NearOwnerAction {
  return request.kind === "register" ? "register" : request.action;
}

export function nearReturnUrl(request: NearSignRequest, data: string): string {
  const query = `nonce=${encodeURIComponent(request.nonce)}&data=${data}`;
  return request.port === null
    ? `openbot://near-signature?${query}`
    : `http://127.0.0.1:${request.port}/near-signature?${query}`;
}
