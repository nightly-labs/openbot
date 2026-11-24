import { createPublicKey, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import type { Intent, SignedData } from "@near-intents-agent-api/sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { NearOwnerAction, NearOwnerMethod } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { parseDeepLink } from "./deep-link-router";
import type { NearOwner } from "./near-wallet-store";

export const NEAR_SIGNING_PATH = "/near/sign";
export const NEAR_SIGNATURE_DEV_PATH = "/near-signature";
export const NEAR_SIGNING_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_CHARS = 16 * 1024;

export type NearIntentToSign = Extract<Intent, { standard: "eip712" | "webauthn" }>;

export type NearSigningRequest =
  | { kind: "register"; method: NearOwnerMethod; action: "register"; summary: string }
  | { kind: "sign"; action: Exclude<NearOwnerAction, "register">; summary: string; intent: NearIntentToSign };

export type NearSigningResult =
  | { kind: "owner"; owner: NearOwner }
  | { kind: "eip712"; signature: string }
  | { kind: "webauthn"; credential: NearWebAuthnCredential };

export type NearWebAuthnCredential = Extract<SignedData, { standard: "webauthn" }>["credential"];

interface SigningFragment {
  v: 1;
  nonce: string;
  kind: "register" | "sign";
  method: NearOwnerMethod;
  action: NearOwnerAction;
  summary: string;
  challenge?: string;
  userId?: string;
  intent?: NearIntentToSign;
  address?: string;
  port?: number;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const randomToken = (size: number) => base64url(randomBytes(size));

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
  address: string | null;
  resolve: (result: NearSigningResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface NearSigningOptions {
  pageOrigin: string;
  openExternal: (url: string) => Promise<void>;
  loopback: boolean;
  timeoutMs?: number;
}

export class NearOwnerSigning {
  readonly #options: NearSigningOptions;
  #session: Session | null = null;
  #url: string | null = null;
  #server: { port: number; close: () => Promise<void> } | null = null;

  constructor(options: NearSigningOptions) {
    this.#options = options;
  }

  busy(): boolean {
    return this.#session !== null;
  }

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

  async reopen(): Promise<void> {
    if (this.#url) await this.#options.openExternal(this.#url);
  }

  cancel(): void {
    const session = this.#session;
    if (session) this.#end(session.nonce, new Error(sourceText("error.connector.nearSigningCanceled")));
  }

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
    const { credential } = webauthnResultSchema.parse(value);
    const { userHandle, ...response } = credential.response;
    const { authenticatorAttachment, response: _response, ...fields } = credential;
    const sent: NearWebAuthnCredential = {
      ...fields,
      response: userHandle === undefined ? response : { ...response, userHandle },
    };
    if (authenticatorAttachment !== undefined) sent.authenticatorAttachment = authenticatorAttachment;
    return { kind: "webauthn", credential: sent };
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

  async #listen(): Promise<number> {
    if (this.#server) return this.#server.port;
    const sockets = new Set<Socket>();
    const server: Server = createServer((request, response) => {
      const link = this.#returnedLink(request.method, request.url);
      const received = link !== null;
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
