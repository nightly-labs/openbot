// The owner's signatures for the NEAR Intents wallet. The owner signs on an OpenBot page in the system
// browser, with a passkey or an EVM wallet. The page gets the request in the URL fragment, which no
// server sees, and sends the signature back as an `openbot://near-signature` link.

import { createPublicKey, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import type { Intent } from "@near-intents-agent-api/sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { NearOwnerAction, NearOwnerMethod } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { parseDeepLink } from "./deep-link-router";
import type { NearOwner } from "./near-wallet-store";

/** The path of the signing page on the account service. */
export const NEAR_SIGNING_PATH = "/near/sign";
/** Where the page returns on a development computer, where `openbot://` opens the installed app. */
export const NEAR_SIGNATURE_DEV_PATH = "/near-signature";
/** After this, the wait ends and the owner starts again. */
export const NEAR_SIGNING_TIMEOUT_MS = 10 * 60_000;
/** A deep link longer than this is not one that the page made. */
const MAX_RESULT_CHARS = 16 * 1024;

/** The intent that the Agent API gave, as the owner's wallet signs it. */
export type NearIntentToSign = Extract<Intent, { standard: "eip712" | "webauthn" }>;

export type NearSigningRequest =
  | { kind: "register"; method: NearOwnerMethod; action: "register"; summary: string }
  | { kind: "sign"; action: Exclude<NearOwnerAction, "register">; summary: string; intent: NearIntentToSign };

/** What the page sends back, after main checked it. */
export type NearSigningResult =
  | { kind: "owner"; owner: NearOwner }
  | { kind: "eip712"; signature: string }
  | { kind: "webauthn"; credential: NearWebAuthnCredential };

/** An `AuthenticationResponseJSON`, as the Agent API takes it. */
export type NearWebAuthnCredential = z.infer<typeof webauthnResultSchema>["credential"];

/** The fragment that the page reads. It has no secret but the nonce, which is used once. */
interface SigningFragment {
  v: 1;
  nonce: string;
  kind: "register" | "sign";
  method: NearOwnerMethod;
  action: NearOwnerAction;
  summary: string;
  /** Register: the random value that the owner signs (EVM) or the passkey challenge. */
  challenge?: string;
  /** Register with a passkey: the random WebAuthn user id. */
  userId?: string;
  intent?: NearIntentToSign;
  /** Sign with an EVM wallet: the owner address, so the page signs with the right account. */
  address?: string;
  /** Development only: the loopback port that takes the result. */
  port?: number;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const randomToken = (size: number) => base64url(randomBytes(size));

/** The text that an EVM owner signs to prove the address. */
export function evmRegisterMessage(challenge: string): string {
  return `OpenBot NEAR wallet owner\nNonce: ${challenge}`;
}

const evmRegisterSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/u),
  chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/u),
});
const passkeyRegisterSchema = z.object({
  credentialId: z.string().regex(/^[A-Za-z0-9_-]{16,1366}$/u),
  publicKey: z.string().regex(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{85}[AQgw]$/u),
});
const eip712ResultSchema = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/u) });
/** An `AuthenticationResponseJSON`. The Agent API checks the signature; main checks the shape. */
const webauthnResultSchema = z.object({
  credential: z
    .object({
      id: z.string().regex(/^[A-Za-z0-9_-]+$/u),
      rawId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
      type: z.literal("public-key"),
      response: z.object({
        clientDataJSON: z.string().regex(/^[A-Za-z0-9_-]+$/u),
        authenticatorData: z.string().regex(/^[A-Za-z0-9_-]+$/u),
        signature: z.string().regex(/^[A-Za-z0-9_-]+$/u),
        userHandle: z
          .string()
          .regex(/^[A-Za-z0-9_-]*$/u)
          .optional(),
      }),
      clientExtensionResults: z.record(z.string(), z.unknown()),
      authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
    })
    .strict(),
});

/** Recovers the uncompressed public key, without the `04` prefix, of an EIP-191 `personal_sign`. */
export function recoverPersonalSignKey(message: string, signatureHex: string): Uint8Array {
  const text = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${text.length}`);
  const hash = keccak_256(new Uint8Array([...prefix, ...text]));
  const signature = Buffer.from(signatureHex.slice(2), "hex");
  const v = signature[64] ?? 0;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) throw new Error("bad recovery id");
  const point = secp256k1.Signature.fromBytes(signature.subarray(0, 64), "compact")
    .addRecoveryBit(recovery)
    .recoverPublicKey(hash);
  return point.toBytes(false).subarray(1);
}

export function evmAddressOf(publicKey: Uint8Array): string {
  return `0x${Buffer.from(keccak_256(publicKey).subarray(-20)).toString("hex")}`;
}

/** True when the base64url SPKI is an ECDSA P-256 key, the one kind that the Agent API takes. */
function isP256Key(spki: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spki, "base64url"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

interface Session {
  nonce: string;
  request: NearSigningRequest;
  method: NearOwnerMethod;
  challenge: string | null;
  /** The owner address for an EVM signature. */
  address: string | null;
  resolve: (result: NearSigningResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface NearSigningOptions {
  /** The account service, such as `https://api.openbot.run`. */
  pageOrigin: string;
  openExternal: (url: string) => Promise<void>;
  /** Development: the page returns to a loopback listener, not to `openbot://`. */
  loopback: boolean;
  timeoutMs?: number;
}

/**
 * One signature at a time. The nonce in the fragment is the only proof that a returned link belongs
 * to this request: it is 32 random bytes, used once, and compared before anything else is read.
 */
export class NearOwnerSigning {
  readonly #options: NearSigningOptions;
  #session: Session | null = null;
  /** The URL of the page for the current signature, to open it again. */
  #url: string | null = null;
  #server: { port: number; close: () => Promise<void> } | null = null;

  constructor(options: NearSigningOptions) {
    this.#options = options;
  }

  busy(): boolean {
    return this.#session !== null;
  }

  /**
   * Opens the page and waits for the signature. Rejects with a sentence on cancel, timeout or a result
   * that does not check out.
   */
  async sign(
    request: NearSigningRequest,
    method: NearOwnerMethod,
    owner: NearOwner | null,
  ): Promise<NearSigningResult> {
    if (this.#session) throw new Error(sourceText("error.connector.nearSigningBusy"));
    const nonce = randomToken(32);
    const challenge = request.kind === "register" ? randomToken(32) : null;
    const address = owner?.type === "evm" ? owner.address : null;
    const port = this.#options.loopback ? await this.#listen() : undefined;
    const fragment: SigningFragment = {
      v: 1,
      nonce,
      kind: request.kind,
      method,
      action: request.action,
      summary: request.summary,
      ...(challenge ? { challenge } : {}),
      ...(request.kind === "register" && method === "passkey" ? { userId: randomToken(16) } : {}),
      ...(request.kind === "sign" ? { intent: request.intent } : {}),
      ...(address ? { address } : {}),
      ...(port ? { port } : {}),
    };
    const url = `${this.#options.pageOrigin}${NEAR_SIGNING_PATH}#${Buffer.from(JSON.stringify(fragment)).toString("base64url")}`;
    const done = new Promise<NearSigningResult>((resolve, reject) => {
      const timer = setTimeout(
        () => this.#end(nonce, new Error(sourceText("error.connector.nearSigningExpired"))),
        this.#options.timeoutMs ?? NEAR_SIGNING_TIMEOUT_MS,
      );
      this.#session = { nonce, request, method, challenge, address, resolve, reject, timer };
    });
    this.#url = url;
    await this.#options.openExternal(url).catch(() => undefined);
    return done;
  }

  /** Opens the page of the current signature again, when the owner closed the tab. */
  async reopen(): Promise<void> {
    if (this.#url) await this.#options.openExternal(this.#url);
  }

  cancel(): void {
    const session = this.#session;
    if (session) this.#end(session.nonce, new Error(sourceText("error.connector.nearSigningCanceled")));
  }

  /**
   * Takes the result of a returned link. False when no signature waits for this nonce; the link is
   * then ignored. A result that waits but does not check out ends the wait with an error.
   */
  receive(nonce: string, data: string): boolean {
    const session = this.#session;
    if (!session || !timingSafeEqualText(session.nonce, nonce)) return false;
    try {
      this.#end(session.nonce, null, this.#check(session, data));
    } catch {
      this.#end(session.nonce, new Error(sourceText("error.connector.nearSigningInvalid")));
    }
    return true;
  }

  async dispose(): Promise<void> {
    this.cancel();
    await this.#closeServer();
  }

  #check(session: Session, data: string): NearSigningResult {
    if (data.length > MAX_RESULT_CHARS) throw new Error("too large");
    const value = z.json().parse(JSON.parse(Buffer.from(data, "base64url").toString("utf8")));
    const request = session.request;
    if (request.kind === "register") {
      if (session.method === "evm") {
        const result = evmRegisterSchema.parse(value);
        const challenge = session.challenge ?? "";
        const publicKey = recoverPersonalSignKey(evmRegisterMessage(challenge), result.signature);
        const address = evmAddressOf(publicKey);
        if (address !== result.address.toLowerCase()) throw new Error("address");
        return {
          kind: "owner",
          owner: {
            type: "evm",
            address,
            chain_id: result.chainId,
            public_key: `0x${Buffer.from(publicKey).toString("hex")}`,
          },
        };
      }
      const result = passkeyRegisterSchema.parse(value);
      if (!isP256Key(result.publicKey)) throw new Error("key");
      const page = new URL(this.#options.pageOrigin);
      return {
        kind: "owner",
        owner: {
          type: "passkey",
          credential_id: result.credentialId,
          public_key: result.publicKey,
          rp_id: page.hostname,
          origin: page.origin,
        },
      };
    }
    if (request.intent.standard === "eip712") return { kind: "eip712", ...eip712ResultSchema.parse(value) };
    const result = webauthnResultSchema.parse(value);
    return { kind: "webauthn", credential: result.credential };
  }

  #end(nonce: string, error: Error | null, result?: NearSigningResult): void {
    const session = this.#session;
    if (!session || session.nonce !== nonce) return;
    this.#session = null;
    this.#url = null;
    clearTimeout(session.timer);
    void this.#closeServer();
    if (error || !result) session.reject(error ?? new Error(sourceText("error.connector.nearSigningInvalid")));
    else session.resolve(result);
  }

  /** Development only: a loopback listener that lives while one signature waits. */
  async #listen(): Promise<number> {
    if (this.#server) return this.#server.port;
    const sockets = new Set<Socket>();
    const server: Server = createServer((request, response) => {
      const link = this.#returnedLink(request.method, request.url);
      const received = link !== null;
      // The result is taken after the answer is sent: taking it ends the wait and closes this listener.
      if (link) response.once("finish", () => this.receive(link.nonce, link.data));
      response
        .writeHead(received ? 200 : 404, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        })
        .end(
          received ? sourceText("status.agent.nearSignatureReceived") : sourceText("status.agent.nearSignatureUnknown"),
        );
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.#server = {
      port,
      close: () =>
        new Promise((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    };
    return port;
  }

  /** The returned link of a loopback request, when its nonce is the one of the waiting signature. */
  #returnedLink(method: string | undefined, url: string | undefined): { nonce: string; data: string } | null {
    if (method !== "GET" || !url?.startsWith(`${NEAR_SIGNATURE_DEV_PATH}?`)) return null;
    const link = parseDeepLink(`openbot://${url.replace(/^\/+/u, "")}`);
    const session = this.#session;
    if (link?.kind !== "near-signature" || !session || !timingSafeEqualText(session.nonce, link.nonce)) return null;
    return { nonce: link.nonce, data: link.data };
  }

  async #closeServer(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    await server?.close();
  }
}

function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
