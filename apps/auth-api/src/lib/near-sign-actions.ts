import {
  base64urlToBytes,
  bytesToBase64url,
  isNearJsonObject,
  type NearJsonObject,
  type NearSignRequest,
  type NearWebAuthnPayload,
  nearJsonValue,
} from "./near-sign-request";

export type NearSignFailure = "cancelled" | "noPasskey" | "wrongSite" | "keyType" | "tooLarge" | "failed";

export class NearSignError extends Error {
  readonly failure: NearSignFailure;

  constructor(failure: NearSignFailure) {
    super(failure);
    this.failure = failure;
  }
}

const PASSKEY_REGISTER_TIMEOUT_MS = 5 * 60_000;
const ES256 = -7;
const MAX_RESULT_CHARS = 16 * 1024;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{16,1366}$/u;

function passkeysAvailable(): boolean {
  return typeof window.PublicKeyCredential === "function" && typeof navigator.credentials?.create === "function";
}

function failureOf(error: unknown): NearSignFailure {
  if (error instanceof NearSignError) return error.failure;
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return "cancelled";
  }
  if (error instanceof DOMException && error.name === "SecurityError") return "wrongSite";
  return "failed";
}

async function registerPasskey(challenge: string, userId: string, userName: string) {
  if (!passkeysAvailable()) throw new NearSignError("noPasskey");
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64urlToBytes(challenge),
      rp: { id: location.hostname, name: "OpenBot" },
      user: { id: base64urlToBytes(userId), name: userName, displayName: userName },
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: { userVerification: "required", residentKey: "required" },
      attestation: "none",
      timeout: PASSKEY_REGISTER_TIMEOUT_MS,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new NearSignError("failed");
  const response = credential.response;
  if (!(response instanceof AuthenticatorAttestationResponse)) throw new NearSignError("failed");
  const publicKey = response.getPublicKeyAlgorithm() === ES256 ? response.getPublicKey() : null;
  if (!publicKey) throw new NearSignError("keyType");
  const credentialId = bytesToBase64url(credential.rawId);
  if (!CREDENTIAL_ID_PATTERN.test(credentialId)) throw new NearSignError("keyType");
  const authenticatorData =
    typeof response.getAuthenticatorData === "function" ? bytesToBase64url(response.getAuthenticatorData()) : null;
  return {
    credentialId,
    publicKey: bytesToBase64url(publicKey),
    ...(authenticatorData ? { authenticatorData } : {}),
  };
}

function extensionResults(credential: PublicKeyCredential): NearJsonObject {
  const results = nearJsonValue(JSON.parse(JSON.stringify(credential.getClientExtensionResults())));
  return isNearJsonObject(results) ? results : {};
}

async function signWithPasskey(payload: NearWebAuthnPayload) {
  if (!passkeysAvailable()) throw new NearSignError("noPasskey");
  if (payload.rpId !== location.hostname) throw new NearSignError("wrongSite");
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: base64urlToBytes(payload.challenge),
      rpId: payload.rpId,
      allowCredentials: payload.allowCredentials.map((item) => ({ id: base64urlToBytes(item.id), type: item.type })),
      userVerification: payload.userVerification,
      timeout: payload.timeout,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new NearSignError("failed");
  const response = credential.response;
  if (!(response instanceof AuthenticatorAssertionResponse)) throw new NearSignError("failed");
  const attachment = credential.authenticatorAttachment;
  return {
    credential: {
      id: credential.id,
      rawId: bytesToBase64url(credential.rawId),
      type: "public-key" as const,
      response: {
        clientDataJSON: bytesToBase64url(response.clientDataJSON),
        authenticatorData: bytesToBase64url(response.authenticatorData),
        signature: bytesToBase64url(response.signature),
        ...(response.userHandle ? { userHandle: bytesToBase64url(response.userHandle) } : {}),
      },
      clientExtensionResults: extensionResults(credential),
      ...(attachment === "platform" || attachment === "cross-platform" ? { authenticatorAttachment: attachment } : {}),
    },
  };
}

function encodeResult(result: unknown): string {
  const data = bytesToBase64url(new TextEncoder().encode(JSON.stringify(result)));
  if (data.length > MAX_RESULT_CHARS) throw new NearSignError("tooLarge");
  return data;
}

export async function runNearSignature(request: NearSignRequest, passkeyName: string): Promise<string> {
  try {
    if (request.kind === "register") {
      return encodeResult(await registerPasskey(request.challenge, request.userId, passkeyName));
    }
    return encodeResult(await signWithPasskey(request.payload));
  } catch (error) {
    throw new NearSignError(failureOf(error));
  }
}
