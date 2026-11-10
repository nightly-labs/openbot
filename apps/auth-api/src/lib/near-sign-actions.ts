import {
  base64urlToBytes,
  bytesToBase64url,
  isNearJsonObject,
  type NearEip712Payload,
  type NearJsonObject,
  type NearSignRequest,
  type NearWebAuthnPayload,
  nearJsonValue,
} from "./near-sign-request";

/*
 * The browser half of the NEAR wallet signature: a passkey (WebAuthn) or an EVM wallet (EIP-1193).
 * Each function runs from one click, because the browser and the wallet ask for a user gesture. The
 * result has the exact shape that `src/main/near-wallet-signing.ts` checks: no other keys.
 */

/** Why a signature did not finish. Each kind has its own sentence on the page. */
export type NearSignFailure =
  | "cancelled"
  | "noPasskey"
  | "noWallet"
  | "walletBusy"
  | "wrongAccount"
  | "wrongSite"
  | "keyType"
  | "chain"
  | "signatureType"
  | "tooLarge"
  | "failed";

export class NearSignError extends Error {
  readonly failure: NearSignFailure;

  constructor(failure: NearSignFailure) {
    super(failure);
    this.failure = failure;
  }
}

/** The text that an EVM owner signs. The same as `evmRegisterMessage` in main. */
function evmRegisterMessage(challenge: string): string {
  return `OpenBot NEAR wallet owner\nNonce: ${challenge}`;
}

const PASSKEY_REGISTER_TIMEOUT_MS = 5 * 60_000;
/** ES256: ECDSA with P-256 and SHA-256, the one key type that the Agent API takes. */
const ES256 = -7;
/** Main refuses a returned link with more data than this. */
const MAX_RESULT_CHARS = 16 * 1024;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const EVM_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/u;
/** Main checks the credential id with this pattern. */
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{16,1366}$/u;

/** EIP-1193: the user rejected the request. */
const EIP1193_USER_REJECTED = 4001;
/** EIP-1193 wallets: a request of the same kind is still open in the wallet. */
const EIP1193_REQUEST_PENDING = -32002;

/** The domain fields of EIP-712, in the order of the standard. */
const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return typeof value === "object" && value !== null && "request" in value && typeof value.request === "function";
}

/** The wallet extension of the browser. It adds itself as `window.ethereum`, which the DOM types do not have. */
function browserWallet(): Eip1193Provider {
  const provider = "ethereum" in window ? window.ethereum : undefined;
  if (!isEip1193Provider(provider)) throw new NearSignError("noWallet");
  return provider;
}

function passkeysAvailable(): boolean {
  return typeof window.PublicKeyCredential === "function" && typeof navigator.credentials?.create === "function";
}

/** A wallet or passkey error, as a failure that the page shows. */
function failureOf(error: unknown): NearSignFailure {
  if (error instanceof NearSignError) return error.failure;
  // WebAuthn: the user closed the prompt, or it timed out. Both mean "nothing was signed".
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return "cancelled";
  }
  if (error instanceof DOMException && error.name === "SecurityError") return "wrongSite";
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === EIP1193_USER_REJECTED) return "cancelled";
  if (code === EIP1193_REQUEST_PENDING) return "walletBusy";
  return "failed";
}

function utf8Hex(text: string): string {
  let hex = "0x";
  for (const byte of new TextEncoder().encode(text)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function chainIdOf(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  try {
    const chainId = BigInt(value);
    return chainId > 0n ? chainId : null;
  } catch {
    return null;
  }
}

async function walletAccounts(wallet: Eip1193Provider): Promise<string[]> {
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts)) throw new NearSignError("failed");
  return accounts.filter((account): account is string => typeof account === "string");
}

async function walletChainId(wallet: Eip1193Provider): Promise<bigint> {
  const chainId = chainIdOf(await wallet.request({ method: "eth_chainId" }));
  if (chainId === null) throw new NearSignError("chain");
  return chainId;
}

function evmSignature(value: unknown): string {
  if (typeof value !== "string" || !EVM_SIGNATURE_PATTERN.test(value)) throw new NearSignError("signatureType");
  return value;
}

async function registerPasskey(challenge: string, userId: string, userName: string) {
  if (!passkeysAvailable()) throw new NearSignError("noPasskey");
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64urlToBytes(challenge),
      rp: { id: location.hostname, name: "OpenBot" },
      user: { id: base64urlToBytes(userId), name: userName, displayName: userName },
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
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
  return { credentialId, publicKey: bytesToBase64url(publicKey) };
}

/** The extension results as JSON. The round trip drops values that are not JSON, such as an `ArrayBuffer`. */
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

async function registerEvmWallet(challenge: string) {
  const wallet = browserWallet();
  const [address] = await walletAccounts(wallet);
  if (!address || !EVM_ADDRESS_PATTERN.test(address)) throw new NearSignError("failed");
  const chainId = await walletChainId(wallet);
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new NearSignError("chain");
  const signature = evmSignature(
    await wallet.request({ method: "personal_sign", params: [utf8Hex(evmRegisterMessage(challenge)), address] }),
  );
  return { address, chainId: Number(chainId), signature };
}

/** The types of the typed data, with `EIP712Domain` made from the domain fields when it is missing. */
function typesWithDomain(payload: NearEip712Payload): NearEip712Payload["types"] {
  if (Object.hasOwn(payload.types, "EIP712Domain")) return payload.types;
  const domain = EIP712_DOMAIN_FIELDS.filter(
    (field) => payload.domain[field.name] !== undefined && payload.domain[field.name] !== null,
  ).map((field) => ({ name: field.name, type: field.type }));
  return { EIP712Domain: domain, ...payload.types };
}

async function signTypedData(payload: NearEip712Payload, owner: string) {
  const wallet = browserWallet();
  const accounts = await walletAccounts(wallet);
  const address = accounts.find((account) => account.toLowerCase() === owner.toLowerCase());
  if (!address) throw new NearSignError("wrongAccount");
  const wanted = payload.domain.chainId === undefined ? null : chainIdOf(payload.domain.chainId);
  if (payload.domain.chainId !== undefined && wanted === null) throw new NearSignError("chain");
  if (wanted !== null && (await walletChainId(wallet)) !== wanted) {
    try {
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${wanted.toString(16)}` }] });
    } catch (error) {
      throw new NearSignError(failureOf(error) === "cancelled" ? "cancelled" : "chain");
    }
    if ((await walletChainId(wallet)) !== wanted) throw new NearSignError("chain");
  }
  const typedData = {
    domain: payload.domain,
    types: typesWithDomain(payload),
    primaryType: payload.primaryType,
    message: payload.message,
  };
  const signature = evmSignature(
    await wallet.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typedData)] }),
  );
  return { signature };
}

function encodeResult(result: unknown): string {
  const data = bytesToBase64url(new TextEncoder().encode(JSON.stringify(result)));
  if (data.length > MAX_RESULT_CHARS) throw new NearSignError("tooLarge");
  return data;
}

/**
 * Asks the passkey or the wallet for the signature, and returns it as the `data` of the return link.
 * Throws a `NearSignError`. Each failure can be tried again with a new click.
 *
 * @param passkeyName The name of a new passkey in the visitor's password manager.
 */
export async function runNearSignature(request: NearSignRequest, passkeyName: string): Promise<string> {
  try {
    if (request.kind === "register") {
      return encodeResult(
        request.method === "passkey"
          ? await registerPasskey(request.challenge, request.userId, passkeyName)
          : await registerEvmWallet(request.challenge),
      );
    }
    return encodeResult(
      request.method === "passkey"
        ? await signWithPasskey(request.payload)
        : await signTypedData(request.payload, request.address),
    );
  } catch (error) {
    throw new NearSignError(failureOf(error));
  }
}
