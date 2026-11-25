import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import type { Intent, SignedData } from "@near-intents-agent-api/sdk";
import type { NearOwnerAction, NearPasskeyBackup } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { parseDeepLink } from "./deep-link-router";
import type { NearOwner } from "./near-wallet-store";

export const NEAR_SIGNING_PATH = "/near/sign";
export const NEAR_PASSKEY_WALLET_ORIGIN = "https://nearintents.openbot.run";
export const NEAR_SIGNATURE_DEV_PATH = "/near-signature";
export const NEAR_SIGNING_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_CHARS = 16 * 1024;
const BACKUP_CHECK_TIMEOUT_MS = 5 * 60_000;
const AUTH_DATA_MIN_BYTES = 37;
const FLAGS_BYTE = 32;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;

export type NearIntentToSign = Extract<Intent, { standard: "webauthn" }>;

export type NearSigningRequest =
  | { kind: "register"; action: "register"; summary: string }
  | {
      kind: "sign";
      action: Exclude<NearOwnerAction, "register" | "check-backup">;
      summary: string;
      intent: NearIntentToSign;
    }
  | { kind: "check"; action: "check-backup"; summary: string };

export type NearSignAction = Extract<NearSigningRequest, { kind: "sign" }>["action"];

export type NearSigningResult =
  | { kind: "owner"; owner: NearOwner; backup: NearPasskeyBackup | null }
  | { kind: "backup"; backup: NearPasskeyBackup | null }
  | { kind: "webauthn"; credential: NearWebAuthnCredential };

export type NearWebAuthnCredential = Extract<SignedData, { standard: "webauthn" }>["credential"];

interface SigningFragment {
  v: 1;
  nonce: string;
  kind: "register" | "sign";
  action: NearOwnerAction;
  summary: string;
  challenge?: string;
  userId?: string;
  intent?: NearIntentToSign;
  port?: number;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const randomToken = (size: number) => base64url(randomBytes(size));

const passkeyRegisterSchema = z.object({
  credentialId: z.string().regex(/^[A-Za-z0-9_-]{16,1366}$/u),
  publicKey: z.string().regex(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{85}[AQgw]$/u),
  authenticatorData: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/u)
    .optional(),
});
const clientDataSchema = z.object({ type: z.string(), challenge: z.string(), origin: z.string() });
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

function isP256Key(spki: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spki, "base64url"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();

export function nearBackupState(authenticatorData: string, rpId: string): NearPasskeyBackup | null {
  const data = Buffer.from(authenticatorData, "base64url");
  if (data.length < AUTH_DATA_MIN_BYTES || !data.subarray(0, FLAGS_BYTE).equals(sha256(Buffer.from(rpId)))) {
    return null;
  }
  const flags = data[FLAGS_BYTE] ?? 0;
  const eligible = (flags & FLAG_BACKUP_ELIGIBLE) !== 0;
  const backedUp = (flags & FLAG_BACKED_UP) !== 0;
  if (backedUp && !eligible) return null;
  if (backedUp) return "synced";
  return eligible ? "notSynced" : "deviceOnly";
}

function verifiedBackupState(
  credential: z.infer<typeof webauthnResultSchema>["credential"],
  owner: NearOwner,
  challenge: string,
): NearPasskeyBackup | null {
  if (credential.rawId !== owner.credential_id) throw new Error("credential");
  const clientDataJSON = Buffer.from(credential.response.clientDataJSON, "base64url");
  const clientData = clientDataSchema.parse(JSON.parse(clientDataJSON.toString("utf8")));
  if (clientData.type !== "webauthn.get" || clientData.challenge !== challenge || clientData.origin !== owner.origin) {
    throw new Error("client data");
  }
  const authenticatorData = Buffer.from(credential.response.authenticatorData, "base64url");
  if (authenticatorData.length < AUTH_DATA_MIN_BYTES) throw new Error("authenticator data");
  if (!authenticatorData.subarray(0, FLAGS_BYTE).equals(sha256(Buffer.from(owner.rp_id)))) throw new Error("rp");
  const flags = authenticatorData[FLAGS_BYTE] ?? 0;
  if ((flags & FLAG_USER_PRESENT) === 0 || (flags & FLAG_USER_VERIFIED) === 0) throw new Error("user");
  const key = createPublicKey({ key: Buffer.from(owner.public_key, "base64url"), format: "der", type: "spki" });
  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  if (!verify("sha256", signed, key, Buffer.from(credential.response.signature, "base64url"))) {
    throw new Error("signature");
  }
  return nearBackupState(credential.response.authenticatorData, owner.rp_id);
}

function backupCheckIntent(owner: NearOwner, challenge: string): NearIntentToSign {
  return {
    standard: "webauthn",
    payload: {
      challenge,
      rpId: owner.rp_id,
      allowCredentials: [{ id: owner.credential_id, type: "public-key" }],
      userVerification: "required",
      timeout: BACKUP_CHECK_TIMEOUT_MS,
    },
  };
}

function signingIntent(
  request: NearSigningRequest,
  checkOwner: NearOwner | null,
  challenge: string | null,
): NearIntentToSign | null {
  if (request.kind === "sign") return request.intent;
  if (request.kind === "check" && checkOwner && challenge) return backupCheckIntent(checkOwner, challenge);
  return null;
}

interface Session {
  nonce: string;
  request: NearSigningRequest;
  owner: NearOwner | null;
  challenge: string | null;
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

  async sign(request: NearSigningRequest, owner: NearOwner | null): Promise<NearSigningResult> {
    if (this.#session) throw new Error(sourceText("error.connector.nearSigningBusy"));
    const nonce = randomToken(32);
    const checkOwner = request.kind === "check" ? owner : null;
    if (request.kind === "check" && !checkOwner) throw new Error(sourceText("error.connector.nearSigningInvalid"));
    const challenge = request.kind === "sign" ? null : randomToken(32);
    const intent = signingIntent(request, checkOwner, challenge);
    const port = this.#options.loopback ? await this.#listen() : undefined;
    const fragment: SigningFragment = {
      v: 1,
      nonce,
      kind: request.kind === "register" ? "register" : "sign",
      action: request.action,
      summary: request.summary,
      ...(request.kind === "register" && challenge ? { challenge } : {}),
      ...(request.kind === "register" ? { userId: randomToken(16) } : {}),
      ...(intent ? { intent } : {}),
      ...(port ? { port } : {}),
    };
    const url = `${this.#options.pageOrigin}${NEAR_SIGNING_PATH}#${Buffer.from(JSON.stringify(fragment)).toString("base64url")}`;
    const done = new Promise<NearSigningResult>((resolve, reject) => {
      const timer = setTimeout(
        () => this.#end(nonce, new Error(sourceText("error.connector.nearSigningExpired"))),
        this.#options.timeoutMs ?? NEAR_SIGNING_TIMEOUT_MS,
      );
      this.#session = { nonce, request, owner, challenge, resolve, reject, timer };
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
        backup: result.authenticatorData ? nearBackupState(result.authenticatorData, page.hostname) : null,
      };
    }
    if (request.kind === "check") {
      const owner = session.owner;
      if (!owner || !session.challenge) throw new Error("owner");
      const { credential } = webauthnResultSchema.parse(value);
      return { kind: "backup", backup: verifiedBackupState(credential, owner, session.challenge) };
    }
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
