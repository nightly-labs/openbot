// The hand-off of the OpenBot Slack app's bot token from the account Worker to one desktop host.
//
// The OpenBot Slack app's client secret lives only on the Worker (`apps/auth-api`), so the Worker
// exchanges the OAuth code. It must not keep the token, and the browser that carries the
// result back to `openbot://` must not be able to read it. So the host makes a P-256 key pair for
// one sign-in and sends only the public key. The Worker seals the grant to it with ECDH, HKDF and
// AES-GCM, and only the host that holds the private key can open it. The host's nonce is the
// additional data, so a grant opens only for the sign-in that asked for it.
//
// WebCrypto only, so the Worker and the Electron main process run the same code.

import { isDynamicRecord, isString } from "./runtime-values";

export const SLACK_WORKSPACE_GRANT_VERSION = 2;

const HKDF_INFO = "openbot-slack-workspace-grant-v2";
const RAW_P256_PUBLIC_KEY_BYTES = 65;

/** What the OpenBot app's OAuth install gives the host: the bot token for one workspace. */
export interface SlackWorkspaceGrant {
  botToken: string;
  botUserId: string;
  appId: string;
  workspaceId: string;
  workspaceName: string;
}

export function isRawP256PublicKey(value: string): boolean {
  try {
    const bytes = fromBase64Url(value);
    return bytes.byteLength === RAW_P256_PUBLIC_KEY_BYTES && bytes[0] === 4;
  } catch {
    return false;
  }
}

export async function createSlackWorkspaceKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) };
}

export async function sealSlackWorkspaceGrant(
  hostPublicKey: string,
  nonce: string,
  grant: SlackWorkspaceGrant,
): Promise<string> {
  const recipient = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(hostPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const key = await contentKey(ephemeral.privateKey, recipient, ephemeralPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(grant));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(nonce) },
      key,
      plaintext,
    ),
  );
  return toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: SLACK_WORKSPACE_GRANT_VERSION,
        epk: toBase64Url(ephemeralPublic),
        iv: toBase64Url(iv),
        ct: toBase64Url(ciphertext),
      }),
    ),
  );
}

/** Throws for a payload that another key sealed, that another sign-in asked for, or that was changed. */
export async function openSlackWorkspaceGrant(
  privateKey: CryptoKey,
  nonce: string,
  payload: string,
): Promise<SlackWorkspaceGrant> {
  const envelope = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  if (
    !isDynamicRecord(envelope) ||
    envelope.v !== SLACK_WORKSPACE_GRANT_VERSION ||
    !isString(envelope.epk) ||
    !isString(envelope.iv) ||
    !isString(envelope.ct)
  ) {
    throw new Error("The Slack workspace grant is invalid.");
  }
  const ephemeralPublic = fromBase64Url(envelope.epk);
  const sender = await crypto.subtle.importKey(
    "raw",
    ephemeralPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const key = await contentKey(privateKey, sender, ephemeralPublic);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(envelope.iv), additionalData: new TextEncoder().encode(nonce) },
    key,
    fromBase64Url(envelope.ct),
  );
  const grant = JSON.parse(new TextDecoder().decode(plaintext));
  if (
    !isDynamicRecord(grant) ||
    !isString(grant.botToken) ||
    !isString(grant.botUserId) ||
    !isString(grant.appId) ||
    !isString(grant.workspaceId) ||
    !isString(grant.workspaceName)
  ) {
    throw new Error("The Slack workspace grant is invalid.");
  }
  return {
    botToken: grant.botToken,
    botUserId: grant.botUserId,
    appId: grant.appId,
    workspaceId: grant.workspaceId,
    workspaceName: grant.workspaceName,
  };
}

async function contentKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(HKDF_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error("The value is not base64url.");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
