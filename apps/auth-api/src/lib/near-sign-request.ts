import type { NearOwnerAction, NearOwnerMethod } from "@openbot/contracts/ipc";

/*
 * The request of the NEAR wallet signing page. The desktop app writes it in the URL fragment of
 * `/near/sign` (`src/main/near-wallet-signing.ts`, `SigningFragment`). The fragment stays in the
 * browser: no server, log or analytics gets it. This module only reads and checks it.
 */

/** A value that `JSON.parse` can give. */
export type NearJsonValue = string | number | boolean | null | NearJsonValue[] | NearJsonObject;
export interface NearJsonObject {
  [key: string]: NearJsonValue;
}

/** The typed data of an EIP-712 intent, as the Agent API gives it. */
export interface NearEip712Payload {
  domain: NearJsonObject;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: NearJsonObject;
}

/** The WebAuthn options of a passkey intent, as the Agent API gives them. */
export interface NearWebAuthnPayload {
  challenge: string;
  rpId: string;
  allowCredentials: { id: string; type: "public-key" }[];
  userVerification: "required";
  timeout: number;
}

export type NearSignRequest =
  | {
      kind: "register";
      method: "passkey";
      nonce: string;
      summary: string;
      challenge: string;
      userId: string;
      port: number | null;
    }
  | { kind: "register"; method: "evm"; nonce: string; summary: string; challenge: string; port: number | null }
  | {
      kind: "sign";
      method: "passkey";
      nonce: string;
      action: Exclude<NearOwnerAction, "register">;
      summary: string;
      payload: NearWebAuthnPayload;
      port: number | null;
    }
  | {
      kind: "sign";
      method: "evm";
      nonce: string;
      action: Exclude<NearOwnerAction, "register">;
      summary: string;
      payload: NearEip712Payload;
      address: string;
      port: number | null;
    };

/** The owner actions of `packages/contracts/src/ipc-near-wallet.ts`. */
const OWNER_ACTIONS = {
  register: true,
  create: true,
  grant: true,
  budget: true,
  freeze: true,
  unfreeze: true,
  "auto-pay": true,
  "approve-payment": true,
} as const satisfies Record<NearOwnerAction, true>;

const FRAGMENT_KEYS = new Set([
  "v",
  "nonce",
  "kind",
  "method",
  "action",
  "summary",
  "challenge",
  "userId",
  "intent",
  "address",
  "port",
]);

/** Main makes the nonce from 32 random bytes. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const MAX_FRAGMENT_CHARS = 64 * 1024;
const MAX_SUMMARY_CHARS = 2000;
const MAX_ID_CHARS = 1366;

/** The value as JSON. Undefined when it holds anything that JSON does not have. */
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

function isMethod(value: NearJsonValue | undefined): value is NearOwnerMethod {
  return value === "passkey" || value === "evm";
}

function eip712Payload(value: NearJsonValue | undefined): NearEip712Payload | null {
  if (
    !isNearJsonObject(value) ||
    !isNearJsonObject(value.domain) ||
    !isNearJsonObject(value.types) ||
    !isNearJsonObject(value.message)
  )
    return null;
  const primaryType = value.primaryType;
  if (typeof primaryType !== "string" || !Object.hasOwn(value.types, primaryType)) return null;
  const types: NearEip712Payload["types"] = {};
  for (const [name, fields] of Object.entries(value.types)) {
    if (!Array.isArray(fields)) return null;
    const checked: { name: string; type: string }[] = [];
    for (const field of fields) {
      if (!isNearJsonObject(field) || typeof field.name !== "string" || typeof field.type !== "string") return null;
      checked.push({ name: field.name, type: field.type });
    }
    types[name] = checked;
  }
  return { domain: value.domain, types, primaryType, message: value.message };
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

/** The loopback port of a development app. Null when the page returns with `openbot://`. */
function returnPort(value: NearJsonValue | undefined): number | null | undefined {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : undefined;
}

/** Decodes base64url text to bytes. Throws on text that is not base64url. */
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

/**
 * Reads the request from the URL fragment (without `#`). Null for any fragment that the desktop app
 * did not make: an unknown version, an unknown key, or a field that has the wrong shape.
 */
export function parseNearSignFragment(fragment: string): NearSignRequest | null {
  if (fragment.length === 0 || fragment.length > MAX_FRAGMENT_CHARS) return null;
  let value: NearJsonValue | undefined;
  try {
    value = nearJsonValue(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64urlToBytes(fragment))));
  } catch {
    return null;
  }
  if (!isNearJsonObject(value) || Object.keys(value).some((key) => !FRAGMENT_KEYS.has(key))) return null;
  const { v, nonce, kind, method, action, summary } = value;
  if (v !== 1 || typeof nonce !== "string" || !NONCE_PATTERN.test(nonce) || !isMethod(method)) return null;
  if (typeof summary !== "string" || summary.length > MAX_SUMMARY_CHARS) return null;
  const port = returnPort(value.port);
  if (port === undefined) return null;
  if (kind === "register") {
    if (action !== "register" || !isBase64url(value.challenge, 128)) return null;
    if (value.intent !== undefined || value.address !== undefined) return null;
    if (method === "evm") {
      if (value.userId !== undefined) return null;
      return { kind, method, nonce, summary, challenge: value.challenge, port };
    }
    if (!isBase64url(value.userId, 128)) return null;
    return { kind, method, nonce, summary, challenge: value.challenge, userId: value.userId, port };
  }
  if (kind !== "sign" || !isSignAction(action)) return null;
  if (value.challenge !== undefined || value.userId !== undefined || !isNearJsonObject(value.intent)) return null;
  const { standard, payload } = value.intent;
  if (Object.keys(value.intent).some((key) => key !== "standard" && key !== "payload")) return null;
  if (method === "passkey") {
    const checked = standard === "webauthn" ? webAuthnPayload(payload) : null;
    if (!checked || value.address !== undefined) return null;
    return { kind, method, nonce, action, summary, payload: checked, port };
  }
  const checked = standard === "eip712" ? eip712Payload(payload) : null;
  const address = value.address;
  if (!checked || typeof address !== "string" || !EVM_ADDRESS_PATTERN.test(address)) return null;
  return { kind, method, nonce, action, summary, payload: checked, address, port };
}

/** The action that the request asks the owner to approve. */
export function nearSignAction(request: NearSignRequest): NearOwnerAction {
  return request.kind === "register" ? "register" : request.action;
}

/** One readable field of the EIP-712 message: its path and its value as text. */
export interface NearTypedField {
  path: string;
  value: string;
}

const MAX_TYPED_FIELDS = 64;
const MAX_TYPED_DEPTH = 6;

/** The fields of the EIP-712 message, flat, in the order of the payload. The page shows them as text. */
export function nearTypedFields(message: NearJsonObject): NearTypedField[] {
  const fields: NearTypedField[] = [];
  const visit = (value: NearJsonValue, path: string, depth: number) => {
    if (fields.length >= MAX_TYPED_FIELDS) return;
    if (depth < MAX_TYPED_DEPTH && (isNearJsonObject(value) || Array.isArray(value))) {
      const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item] as const)
        : Object.entries(value);
      if (entries.length === 0) fields.push({ path, value: Array.isArray(value) ? "[]" : "{}" });
      for (const [key, item] of entries) visit(item, path ? `${path}.${key}` : key, depth + 1);
      return;
    }
    fields.push({ path, value: typeof value === "string" ? value : JSON.stringify(value) });
  };
  visit(message, "", 0);
  return fields;
}

/** The address that the signing page returns the result to. */
export function nearReturnUrl(request: NearSignRequest, data: string): string {
  const query = `nonce=${encodeURIComponent(request.nonce)}&data=${data}`;
  return request.port === null
    ? `openbot://near-signature?${query}`
    : `http://127.0.0.1:${request.port}/near-signature?${query}`;
}
