// Runs the NEAR Intents wallet of the main process end to end against a fake Agent API on 127.0.0.1.
// The real Agent API has no testnet, so it is never called and no funds move. The real
// `NearWalletService`, `NearWalletStore` and `NearOwnerSigning` (loopback mode) run; this script acts as
// the signing page in the browser and signs with a real secp256k1 key: EIP-191 for the owner
// registration and EIP-712 for each owner intent. The fake API checks every signature, the grant token
// commitment, the daily budget, the owner approval and the idempotency keys.
// The IPC handlers bind to Electron's `ipcMain`, so they do not run here; inputs go through the same
// contract parsers that the handlers use.
// `bun scripts/near-wallet-e2e.ts`. Writes .openbot-build/near-wallet-e2e/report.json.
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  type NearWalletStatus,
  parseNearAllowPaymentInput,
  parseNearPartnerKey,
  parseNearRuleInput,
  parseNearWalletCreateInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { z } from "zod";
import type { NearPaymentPlan, NearPaymentRequest, NearPaymentResult } from "../src/backend/near-wallet";
import { NearWalletService } from "../src/main/near-wallet-service";
import { evmAddressOf, evmRegisterMessage, NEAR_SIGNING_PATH, NearOwnerSigning } from "../src/main/near-wallet-signing";
import { NearWalletStore } from "../src/main/near-wallet-store";
import type { SecretCipher } from "../src/main/provider-credential-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/near-wallet-e2e");
const PAGE_ORIGIN = "https://accounts.e2e.invalid";
const PARTNER_KEY = `nia_e2e_${randomBytes(24).toString("hex")}`;
const WRONG_KEY = `nia_e2e_wrong_${randomBytes(12).toString("hex")}`;
const USDC = "nep141:usdc.e2e.near";
const USDC_DECIMALS = 6;
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const DOMAIN = "api.example.com";
const MERCHANT = "merchant.near";
const SHOP = "shop.near";
/** A guard only: each wait ends on a status, a store write or a promise. */
const WAIT_MS = 20_000;

const jsonSchema = z.json();
type Json = z.infer<typeof jsonSchema>;
type JsonObject = { [key: string]: Json };
const jsonObjectSchema = z.record(z.string(), jsonSchema);

function toJson(value: unknown): Json {
  const text = JSON.stringify(value);
  return text === undefined ? null : jsonSchema.parse(JSON.parse(text));
}

// --- Output capture -------------------------------------------------------------------------------

/** All that the process writes. The main-process logger writes through these two streams. */
const captured: string[] = [];
type WriteCallback = (error?: Error | null) => void;
function tee(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream);
  stream.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    if (typeof encoding === "function") return original(chunk, encoding);
    return encoding === undefined ? original(chunk, callback) : original(chunk, encoding, callback);
  };
}
tee(process.stdout);
tee(process.stderr);

// --- Hex, hashes and EVM signatures ---------------------------------------------------------------

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (value: string) => new Uint8Array(Buffer.from(value.replace(/^0x/u, ""), "hex"));
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const utf8 = (value: string) => new TextEncoder().encode(value);
const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

interface EvmKey {
  secret: Uint8Array;
  address: string;
}

function newEvmKey(): EvmKey {
  const secret = secp256k1.utils.randomSecretKey();
  return { secret, address: evmAddressOf(secp256k1.getPublicKey(secret, false).subarray(1)) };
}

/** `r || s || v` with `v` 27 or 28, as a wallet returns it. */
function signDigest(key: EvmKey, digest: Uint8Array): string {
  const recovered = secp256k1.sign(digest, key.secret, { prehash: false, format: "recovered" });
  return `0x${hex(concat(recovered.subarray(1, 65), new Uint8Array([27 + (recovered[0] ?? 0)])))}`;
}

function recoverAddress(digest: Uint8Array, signature: string): string | null {
  try {
    const bytes = fromHex(signature);
    if (bytes.length !== 65) return null;
    const point = secp256k1.Signature.fromBytes(bytes.subarray(0, 64), "compact")
      .addRecoveryBit((bytes[64] ?? 0) - 27)
      .recoverPublicKey(digest);
    return evmAddressOf(point.toBytes(false).subarray(1));
  } catch {
    return null;
  }
}

function personalSignDigest(message: string): Uint8Array {
  const text = utf8(message);
  return keccak_256(concat(utf8(`\x19Ethereum Signed Message:\n${text.length}`), text));
}

// EIP-712, for the types that the fake API sends: structs, arrays, string, bytes, bytesN, address,
// bool, uintN and intN.
const typedFieldsSchema = z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() })));
type TypedFields = z.infer<typeof typedFieldsSchema>;
const typedPayloadSchema = z.object({
  domain: jsonObjectSchema,
  types: typedFieldsSchema,
  primaryType: z.string(),
  message: jsonObjectSchema,
});
type TypedPayload = z.infer<typeof typedPayloadSchema>;

const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

/** As the signing page does: `EIP712Domain` made from the domain fields when the payload has none. */
function typesWithDomain(payload: TypedPayload): TypedFields {
  if (Object.hasOwn(payload.types, "EIP712Domain")) return payload.types;
  const domain = EIP712_DOMAIN_FIELDS.filter(
    (field) => payload.domain[field.name] !== undefined && payload.domain[field.name] !== null,
  );
  return { EIP712Domain: domain, ...payload.types };
}

function dependencies(type: string, types: TypedFields, found: Set<string>): Set<string> {
  const base = type.replace(/\[\d*\]$/u, "");
  if (found.has(base) || !types[base]) return found;
  found.add(base);
  for (const field of types[base] ?? []) dependencies(field.type, types, found);
  return found;
}

function encodeType(primary: string, types: TypedFields): string {
  const [first, ...rest] = [...dependencies(primary, types, new Set())];
  return [first ?? primary, ...rest.sort()]
    .map((name) => `${name}(${(types[name] ?? []).map((field) => `${field.type} ${field.name}`).join(",")})`)
    .join("");
}

function word(value: bigint): Uint8Array {
  const unsigned = value < 0n ? (1n << 256n) + value : value;
  return fromHex(unsigned.toString(16).padStart(64, "0"));
}

function integer(value: Json | undefined): bigint {
  if (typeof value === "string" || typeof value === "number") return BigInt(value);
  throw new Error(`EIP-712 integer expected, got ${JSON.stringify(value)}`);
}

function encodeValue(type: string, value: Json | undefined, types: TypedFields): Uint8Array {
  if (types[type]) return hashStruct(type, jsonObjectSchema.parse(value), types);
  const array = /^(.*)\[\d*\]$/u.exec(type);
  if (array) {
    const items = Array.isArray(value) ? value : [];
    return keccak_256(concat(...items.map((item) => encodeValue(array[1] ?? "", item, types))));
  }
  if (type === "string") return keccak_256(utf8(String(value)));
  if (type === "bytes") return keccak_256(fromHex(String(value)));
  if (type === "bool") return word(value === true ? 1n : 0n);
  if (type === "address") return word(integer(value));
  if (/^bytes\d+$/u.test(type)) {
    const out = new Uint8Array(32);
    out.set(fromHex(String(value)).subarray(0, 32));
    return out;
  }
  if (/^u?int\d*$/u.test(type)) return word(integer(value));
  throw new Error(`EIP-712 type ${type} is not supported by this script`);
}

function hashStruct(type: string, value: JsonObject, types: TypedFields): Uint8Array {
  const fields = types[type] ?? [];
  return keccak_256(
    concat(
      keccak_256(utf8(encodeType(type, types))),
      ...fields.map((field) => encodeValue(field.type, value[field.name], types)),
    ),
  );
}

function eip712Digest(payload: TypedPayload): Uint8Array {
  const types = typesWithDomain(payload);
  return keccak_256(
    concat(
      new Uint8Array([0x19, 0x01]),
      hashStruct("EIP712Domain", payload.domain, types),
      hashStruct(payload.primaryType, payload.message, types),
    ),
  );
}

// --- The encrypted store ----------------------------------------------------------------------------

const writtenRecordSchema = z.object({ payments: z.array(z.object({ idempotencyKey: z.string() })) });

/** AES-256-GCM, as a stand-in for the operating system's encryption. Each record write is reported. */
class RecordingCipher implements SecretCipher {
  readonly #key = randomBytes(32);
  readonly #listeners = new Set<(paymentKeys: string[]) => void>();

  encrypt = (value: string): Buffer => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const keys = writtenRecordSchema.parse(JSON.parse(value)).payments.map((item) => item.idempotencyKey);
    queueMicrotask(() => {
      for (const listener of [...this.#listeners]) listener(keys);
    });
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };

  decrypt = (value: Buffer): string => {
    const decipher = createDecipheriv("aes-256-gcm", this.#key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
  };

  /** Resolves on the next record write whose stored payment keys match. */
  nextWrite(label: string, matches: (paymentKeys: string[]) => boolean): Promise<string[]> {
    return withDeadline(
      label,
      new Promise((done) => {
        const listener = (keys: string[]) => {
          if (!matches(keys)) return;
          this.#listeners.delete(listener);
          done(keys);
        };
        this.#listeners.add(listener);
      }),
    );
  }
}

// --- The fake Agent API -----------------------------------------------------------------------------

interface RecordedRequest {
  method: string;
  path: string;
  query: { [key: string]: string };
  /** `<partner-key>`, `<other>` or absent. The value is never recorded. */
  apiKey: string | null;
  /** `<grant-token>`, `<other>` or absent. */
  grantToken: string | null;
  idempotencyKey: string | null;
  body: Json;
  answered: number | "dropped";
}

type Answered = "answered";

const policySchema = z.object({
  frozen: z.boolean(),
  owner_approval: z.boolean(),
  budget: z.object({ daily_usd: z.string().nullable() }),
});
const generateSchema = z.object({
  type: z.string(),
  agent_id: z.string().optional(),
  owner: z.object({ address: z.string() }).optional(),
});
const submitSchema = z.object({
  type: z.string(),
  correlation_id: z.string(),
  signed_data: z.object({ standard: z.string(), payload: jsonSchema, signature: z.string() }),
});
const grantIssueSchema = z.object({ credential: z.string(), expires_at: z.string(), label: z.string() });
const policyUpdateSchema = z.object({ policy: jsonObjectSchema, expected_revision: z.number() });
const approvalVoteSchema = z.object({ approval_id: z.string(), verdict: z.string() });
const executionSchema = z.object({
  asset: z.string(),
  amount: z.string().regex(/^[1-9]\d*$/u),
  recipient: z.string(),
  chain: z.string().optional(),
});

interface FakeIntent {
  correlationId: string;
  type: string;
  agentId: string;
  request: JsonObject;
  payload: TypedPayload;
  signer: string;
  status: "PENDING_SIGNATURE" | "SUCCESS";
  createdAt: string;
  updatedAt: string;
}

interface FakeAgent {
  id: string;
  ownerAddress: string;
  owner: Json;
  status: "PENDING" | "ACTIVE";
  policy: JsonObject;
  revision: number;
  grants: { grantId: string; commitment: string; expiresAt: string; label: string }[];
  spentCents: number;
  createdAt: string;
}

interface FakeExecution {
  correlationId: string;
  type: "transfer" | "withdraw";
  agentId: string;
  idempotencyKey: string;
  bodyText: string;
  amountRaw: bigint;
  usdCents: number;
  status: "PENDING_APPROVAL" | "SUCCESS";
  approvalId: string | null;
  grantId: string;
  createdAt: string;
  updatedAt: string;
  settlements: number;
}

function policyOf(agent: FakeAgent) {
  return policySchema.parse(agent.policy);
}

class FakeAgentApi {
  readonly requests: RecordedRequest[] = [];
  /** URL and body of each request, for the secret checks. Never written to the report. */
  readonly rawRequests: string[] = [];
  readonly agents = new Map<string, FakeAgent>();
  readonly intents = new Map<string, FakeIntent>();
  readonly executions = new Map<string, FakeExecution>();
  readonly executionsByKey = new Map<string, string>();
  balanceRaw = 1_000n * 10n ** BigInt(USDC_DECIMALS);
  /** The next execution is accepted and settled, then the connection drops before the answer. */
  dropNextExecution = false;
  #server: Server | null = null;
  port = 0;

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        this.#send(response, 500, errorDocument("fake_crash", "api", String(error), false));
      });
    });
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => done());
    });
    const address = server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
    this.#server = server;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  spentUsd(agentId: string): string {
    return ((this.agents.get(agentId)?.spentCents ?? 0) / 100).toFixed(2);
  }

  #knownGrant(token: string): boolean {
    return this.#grantOf(token) !== null;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<Answered> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url ?? "/", this.baseUrl);
    const header = (name: string) => {
      const value = request.headers[name];
      return typeof value === "string" ? value : null;
    };
    const apiKey = header("x-api-key");
    const grantToken = header("x-grant-token");
    this.rawRequests.push(`${request.url ?? ""}\n${bodyText}`);
    const recorded: RecordedRequest = {
      method: request.method ?? "",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      apiKey: apiKey === null ? null : apiKey === PARTNER_KEY ? "<partner-key>" : "<other>",
      grantToken: grantToken === null ? null : this.#knownGrant(grantToken) ? "<grant-token>" : "<other>",
      idempotencyKey: header("idempotency-key"),
      body: bodyText ? jsonSchema.parse(JSON.parse(bodyText)) : null,
      answered: 0,
    };
    this.requests.push(recorded);
    const answer = (status: number, body: Json): Answered => {
      recorded.answered = status;
      return this.#send(response, status, body);
    };
    const drop = (): Answered => {
      recorded.answered = "dropped";
      request.socket.destroy();
      return "answered";
    };
    if (apiKey !== PARTNER_KEY)
      return answer(401, errorDocument("unauthorized", "auth", "The API key is not valid.", false));
    return this.#route(recorded, url, bodyText, grantToken, answer, drop);
  }

  #route(
    recorded: RecordedRequest,
    url: URL,
    bodyText: string,
    grantToken: string | null,
    answer: (status: number, body: Json) => Answered,
    drop: () => Answered,
  ): Answered {
    const { method, path } = recorded;
    const bad = (detail: string) => answer(400, errorDocument("bad_request", "request", detail, false));
    if (method === "GET" && path === "/v1/whoami")
      return answer(200, { api_key_id: "key-e2e", tenant_id: "tenant-e2e" });
    if (method === "GET" && path === "/v1/tokens") return answer(200, { data: [tokenView()] });
    if (method === "POST" && path === "/v1/generate-intent") {
      const raw = jsonObjectSchema.safeParse(recorded.body);
      const facts = generateSchema.safeParse(recorded.body);
      if (!raw.success || !facts.success) return bad("generate-intent body");
      const generated = this.#generate(raw.data, facts.data);
      return generated ? answer(200, generated) : bad("generate-intent agent");
    }
    if (method === "POST" && path === "/v1/submit-intent") {
      const body = submitSchema.safeParse(recorded.body);
      if (!body.success) return bad("submit-intent body");
      return this.#submit(body.data, answer);
    }
    if (method === "GET" && path === "/v1/status") {
      const status = this.#statusOf(url.searchParams.get("correlation_id") ?? "");
      return status ? answer(200, status) : answer(404, errorDocument("not_found", "request", "No such id.", false));
    }
    const agentPath = /^\/v1\/agents\/([0-9a-f]{64})(?:\/(balances|policy|transfer|withdraw))?$/u.exec(path);
    const agent = agentPath ? this.agents.get(agentPath[1] ?? "") : undefined;
    if (!agentPath || !agent) return answer(404, errorDocument("not_found", "request", "No such agent.", false));
    const sub = agentPath[2];
    if (method === "GET" && sub === undefined) return answer(200, agentView(agent));
    if (method === "GET" && sub === "balances")
      return answer(200, {
        near_account_id: agent.id,
        source: "public",
        balances: [
          {
            ...tokenView(),
            balance_raw: this.balanceRaw.toString(),
            balance: atomicToDecimal(this.balanceRaw),
            available_raw: this.balanceRaw.toString(),
            available: atomicToDecimal(this.balanceRaw),
          },
        ],
      });
    if (method === "GET" && sub === "policy") return answer(200, this.#policyView(agent));
    if (method === "POST" && (sub === "transfer" || sub === "withdraw"))
      return this.#execute(sub, agent, recorded, bodyText, grantToken, answer, drop);
    return answer(404, errorDocument("not_found", "request", "No such route.", false));
  }

  #generate(raw: JsonObject, facts: z.infer<typeof generateSchema>): JsonObject | null {
    const now = new Date().toISOString();
    let agentId = facts.agent_id ?? "";
    if (facts.type === "agent_create") {
      if (!facts.owner) return null;
      agentId = hex(randomBytes(32));
      this.agents.set(agentId, {
        id: agentId,
        ownerAddress: facts.owner.address.toLowerCase(),
        owner: raw.owner ?? null,
        status: "PENDING",
        policy: jsonObjectSchema.parse(raw.policy),
        revision: 0,
        grants: [],
        spentCents: 0,
        createdAt: now,
      });
    }
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const correlationId = randomUUID();
    const payload: TypedPayload = {
      domain: { name: "NEAR Intents Agent API (e2e fake)", version: "1", chainId: 1 },
      types: {
        OwnerIntent: [
          { name: "intent_type", type: "string" },
          { name: "agent_id", type: "bytes32" },
          { name: "correlation_id", type: "string" },
          { name: "request", type: "RequestDigest" },
          { name: "expires_at", type: "uint256" },
        ],
        RequestDigest: [
          { name: "hash", type: "bytes32" },
          { name: "fields", type: "string[]" },
        ],
      },
      primaryType: "OwnerIntent",
      message: {
        intent_type: facts.type,
        agent_id: `0x${agentId}`,
        correlation_id: correlationId,
        request: { hash: `0x${hex(keccak_256(utf8(JSON.stringify(raw))))}`, fields: Object.keys(raw).sort() },
        expires_at: String(Math.floor(Date.now() / 1000) + 3600),
      },
    };
    this.intents.set(correlationId, {
      correlationId,
      type: facts.type,
      agentId,
      request: raw,
      payload,
      signer: agent.ownerAddress,
      status: "PENDING_SIGNATURE",
      createdAt: now,
      updatedAt: now,
    });
    return {
      correlation_id: correlationId,
      type: facts.type,
      agent_id: agentId,
      status: "PENDING_SIGNATURE",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      signer: agent.owner,
      intent: { standard: "eip712", payload },
      preview: { summary: `${facts.type} (e2e)` },
    };
  }

  #submit(body: z.infer<typeof submitSchema>, answer: (status: number, body: Json) => Answered): Answered {
    const intent = this.intents.get(body.correlation_id);
    if (!intent) return answer(404, errorDocument("not_found", "request", "No such intent.", false));
    if (intent.status === "SUCCESS") return answer(202, this.#statusOf(intent.correlationId));
    const signed = body.signed_data;
    if (signed.standard !== "eip712" || JSON.stringify(signed.payload) !== JSON.stringify(intent.payload))
      return answer(400, errorDocument("payload_mismatch", "request", "The payload changed.", false));
    if (recoverAddress(eip712Digest(intent.payload), signed.signature) !== intent.signer)
      return answer(400, errorDocument("invalid_signature", "auth", "The owner did not sign this.", false));
    const refused = this.#apply(intent);
    if (refused) return answer(409, errorDocument(refused, "policy", refused, false));
    intent.status = "SUCCESS";
    intent.updatedAt = new Date().toISOString();
    return answer(202, this.#statusOf(intent.correlationId));
  }

  /** Applies a signed intent. Returns an error code when the API refuses it. */
  #apply(intent: FakeIntent): string | null {
    const agent = this.agents.get(intent.agentId);
    if (!agent) return "not_found";
    if (intent.type === "agent_create") {
      agent.status = "ACTIVE";
      agent.revision = 1;
    } else if (intent.type === "grant_issue") {
      const request = grantIssueSchema.parse(intent.request);
      agent.grants.push({
        grantId: randomUUID(),
        commitment: request.credential,
        expiresAt: request.expires_at,
        label: request.label,
      });
    } else if (intent.type === "policy_update") {
      const request = policyUpdateSchema.parse(intent.request);
      if (request.expected_revision !== agent.revision) return "revision_conflict";
      policySchema.parse(request.policy);
      agent.policy = request.policy;
      agent.revision += 1;
    } else if (intent.type === "agent_freeze" || intent.type === "agent_unfreeze") {
      agent.policy = { ...agent.policy, frozen: intent.type === "agent_freeze" };
    } else if (intent.type === "approval_vote") {
      const request = approvalVoteSchema.parse(intent.request);
      const execution = [...this.executions.values()].find((item) => item.approvalId === request.approval_id);
      if (!execution) return "approval_unknown";
      if (request.verdict === "approve") this.#settle(execution);
    } else {
      return "unsupported_intent";
    }
    return null;
  }

  #grantOf(token: string): { agent: FakeAgent; grantId: string } | null {
    const commitment = sha256Hex(token);
    for (const agent of this.agents.values()) {
      const grant = agent.grants.find((item) => item.commitment === commitment);
      if (grant && Date.parse(grant.expiresAt) > Date.now()) return { agent, grantId: grant.grantId };
    }
    return null;
  }

  #execute(
    type: "transfer" | "withdraw",
    agent: FakeAgent,
    recorded: RecordedRequest,
    bodyText: string,
    grantToken: string | null,
    answer: (status: number, body: Json) => Answered,
    drop: () => Answered,
  ): Answered {
    const grant = grantToken ? this.#grantOf(grantToken) : null;
    if (!grant || grant.agent.id !== agent.id)
      return answer(403, errorDocument("grant_invalid", "grant", "No valid grant.", false));
    const key = recorded.idempotencyKey;
    if (!key) return answer(400, errorDocument("idempotency_key_required", "request", "Send a key.", false));
    const known = this.executionsByKey.get(key);
    if (known) {
      if (this.executions.get(known)?.bodyText !== bodyText)
        return answer(409, errorDocument("idempotency_conflict", "request", "Another body.", false));
      return answer(202, this.#statusOf(known));
    }
    const body = executionSchema.safeParse(recorded.body);
    if (!body.success) return answer(400, errorDocument("bad_request", "request", `${type} body`, false));
    const policy = policyOf(agent);
    if (policy.frozen) return answer(403, errorDocument("agent_frozen", "policy", "The agent is frozen.", false));
    const amountRaw = BigInt(body.data.amount);
    const usdCents = Number((amountRaw * 100n) / 10n ** BigInt(USDC_DECIMALS));
    const reserved = [...this.executions.values()]
      .filter((item) => item.agentId === agent.id && item.status === "PENDING_APPROVAL")
      .reduce((sum, item) => sum + item.usdCents, 0);
    const daily = policy.budget.daily_usd;
    if (daily !== null && agent.spentCents + reserved + usdCents > Math.round(Number(daily) * 100))
      return answer(403, errorDocument("budget_exceeded", "budget", "The daily budget is used.", false));
    if (amountRaw > this.balanceRaw)
      return answer(403, errorDocument("insufficient_balance", "balance", "Not enough funds.", false));
    const now = new Date().toISOString();
    const execution: FakeExecution = {
      correlationId: randomUUID(),
      type,
      agentId: agent.id,
      idempotencyKey: key,
      bodyText,
      amountRaw,
      usdCents,
      status: "PENDING_APPROVAL",
      approvalId: policy.owner_approval ? randomUUID() : null,
      grantId: grant.grantId,
      createdAt: now,
      updatedAt: now,
      settlements: 0,
    };
    this.executions.set(execution.correlationId, execution);
    this.executionsByKey.set(key, execution.correlationId);
    if (!policy.owner_approval) this.#settle(execution);
    if (this.dropNextExecution) {
      this.dropNextExecution = false;
      return drop();
    }
    return answer(202, this.#statusOf(execution.correlationId));
  }

  #settle(execution: FakeExecution): void {
    if (execution.status === "SUCCESS") return;
    execution.status = "SUCCESS";
    execution.settlements += 1;
    execution.updatedAt = new Date().toISOString();
    this.balanceRaw -= execution.amountRaw;
    const agent = this.agents.get(execution.agentId);
    if (agent) agent.spentCents += execution.usdCents;
  }

  #statusOf(correlationId: string): JsonObject | null {
    const intent = this.intents.get(correlationId);
    if (intent) {
      const agent = this.agents.get(intent.agentId);
      const grant = intent.type === "grant_issue" && intent.status === "SUCCESS" ? agent?.grants.at(-1) : undefined;
      const revision = agent?.revision ?? null;
      return {
        correlation_id: intent.correlationId,
        agent_id: intent.agentId,
        status: intent.status,
        failure_code: null,
        created_at: intent.createdAt,
        updated_at: intent.updatedAt,
        dispatch_committed_at: null,
        grant: null,
        type: intent.type,
        details:
          intent.type === "grant_issue"
            ? {
                grant: grant
                  ? {
                      grant_id: grant.grantId,
                      agent_id: intent.agentId,
                      wallet_id: `wallet-${intent.agentId.slice(0, 8)}`,
                      label: grant.label,
                      issued_at: intent.updatedAt,
                      expires_at: grant.expiresAt,
                      revoked_at: null,
                      revoked_reason: null,
                      owner_epoch: 1,
                    }
                  : null,
              }
            : { revision, policy_hash: null, transaction_hash: null },
      };
    }
    const execution = this.executions.get(correlationId);
    if (!execution) return null;
    return {
      correlation_id: execution.correlationId,
      agent_id: execution.agentId,
      status: execution.status,
      failure_code: null,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      dispatch_committed_at: execution.createdAt,
      grant: { id: execution.grantId, label: "OpenBot" },
      type: execution.type,
      details: { action: execution.type, approval_id: execution.approvalId },
    };
  }

  #policyView(agent: FakeAgent): JsonObject {
    const daily = policyOf(agent).budget.daily_usd;
    const none = { limit_usd: null, spent_usd: null, remaining_usd: null, resets_at: null };
    return {
      wallet_id: `wallet-${agent.id.slice(0, 8)}`,
      revision: agent.revision,
      policy_hash: null,
      status: "APPLIED",
      applied_at: agent.createdAt,
      transaction_hash: null,
      provider_policy_synced: true,
      cooldowns: { policy_change_available_at: null, unfreeze_available_at: null },
      policy: agent.policy,
      usage: {
        budget: {
          daily: {
            limit_usd: daily,
            spent_usd: this.spentUsd(agent.id),
            remaining_usd: daily === null ? null : (Number(daily) - agent.spentCents / 100).toFixed(2),
            resets_at: null,
          },
          weekly: none,
          monthly: none,
        },
        timelock: { delay_ms: 0, scheduled_count: 0 },
      },
    };
  }

  #send(response: ServerResponse, status: number, body: Json): Answered {
    if (!response.headersSent && !response.destroyed)
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    return "answered";
  }
}

function tokenView(): JsonObject {
  return {
    asset_id: USDC,
    symbol: "USDC",
    decimals: USDC_DECIMALS,
    blockchain: "near",
    price: 1,
    price_updated_at: null,
    price_expires_at: null,
  };
}

function errorDocument(code: string, layer: string, detail: string, retryable: boolean): JsonObject {
  return { errors: [{ code, layer, title: code, detail, meta: { retryable } }], meta: { request_id: randomUUID() } };
}

function agentView(agent: FakeAgent): JsonObject {
  return {
    id: agent.id,
    name: "OpenBot",
    external_user_id: null,
    status: agent.status,
    archived: false,
    deleted: false,
    owner: agent.owner,
    owner_account: null,
    wallet:
      agent.status === "ACTIVE"
        ? {
            wallet_id: `wallet-${agent.id.slice(0, 8)}`,
            near_account_id: agent.id,
            evm_account_id: null,
            solana_account_id: null,
          }
        : null,
    created_at: agent.createdAt,
    cooldowns: { policy_change_available_at: null, unfreeze_available_at: null },
  };
}

function atomicToDecimal(raw: bigint): string {
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const fraction = (raw % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/u, "");
  return fraction ? `${raw / scale}.${fraction}` : `${raw / scale}`;
}

// --- The signing page ----------------------------------------------------------------------------

const fragmentSchema = z.object({
  v: z.literal(1),
  nonce: z.string(),
  kind: z.enum(["register", "sign"]),
  method: z.string(),
  action: z.string(),
  summary: z.string(),
  challenge: z.string().optional(),
  intent: z.object({ standard: z.literal("eip712"), payload: typedPayloadSchema }).optional(),
  address: z.string().optional(),
  port: z.number().int().optional(),
});
type Fragment = z.infer<typeof fragmentSchema>;

type PageMode =
  | { kind: "honest" }
  /** Signs with another key. For the registration it still claims the owner's address. */
  | { kind: "other-key" }
  /** Returns the right result under a wrong nonce. */
  | { kind: "wrong-nonce" };

interface PageReturn {
  nonce: "right" | "wrong";
  /** What the loopback listener answered, or the network error. */
  status: number | null;
  text: string | null;
  error: string | null;
}

interface PageVisit {
  fragment: Fragment;
  returns: PageReturn[];
}

/** Acts as the OpenBot signing page in the browser: reads the fragment, signs, and returns the result. */
class SigningPage {
  readonly visits: PageVisit[] = [];
  mode: PageMode = { kind: "honest" };
  readonly owner: EvmKey;
  readonly other = newEvmKey();
  readonly #listeners = new Set<(visit: PageVisit) => void>();
  readonly #pending = new Set<Promise<void>>();

  constructor(owner: EvmKey) {
    this.owner = owner;
  }

  readonly openExternal = async (url: string): Promise<void> => {
    const prefix = `${PAGE_ORIGIN}${NEAR_SIGNING_PATH}#`;
    assert.ok(url.startsWith(prefix), `the signing page URL starts with ${prefix}`);
    const fragment = fragmentSchema.parse(
      JSON.parse(Buffer.from(url.slice(prefix.length), "base64url").toString("utf8")),
    );
    const visit: PageVisit = { fragment, returns: [] };
    this.visits.push(visit);
    const run = this.#respond(visit).finally(() => {
      this.#pending.delete(run);
      for (const listener of [...this.#listeners]) listener(visit);
    });
    this.#pending.add(run);
  };

  /** Resolves when the page made its return for the next visit. */
  nextVisit(label: string): Promise<PageVisit> {
    return withDeadline(
      label,
      new Promise((done) => {
        const listener = (visit: PageVisit) => {
          this.#listeners.delete(listener);
          done(visit);
        };
        this.#listeners.add(listener);
      }),
    );
  }

  async settle(): Promise<void> {
    await Promise.all([...this.#pending]);
  }

  /** The signed result, encoded as the page encodes it. */
  result(fragment: Fragment, key: EvmKey): string {
    if (fragment.kind === "register") {
      const signature = signDigest(key, personalSignDigest(evmRegisterMessage(fragment.challenge ?? "")));
      return base64url(JSON.stringify({ address: this.owner.address, chainId: 1, signature }));
    }
    assert.ok(fragment.intent, "the owner signs an eip712 intent");
    assert.equal(fragment.address, this.owner.address, "the fragment names the owner address");
    return base64url(JSON.stringify({ signature: signDigest(key, eip712Digest(fragment.intent.payload)) }));
  }

  async #respond(visit: PageVisit): Promise<void> {
    const { fragment } = visit;
    if (this.mode.kind === "wrong-nonce") {
      const forgedNonce = randomBytes(32).toString("base64url");
      visit.returns.push(await this.#return(fragment, forgedNonce, this.result(fragment, this.owner), "wrong"));
      return;
    }
    const key = this.mode.kind === "other-key" ? this.other : this.owner;
    visit.returns.push(await this.#return(fragment, fragment.nonce, this.result(fragment, key), "right"));
  }

  async #return(fragment: Fragment, nonce: string, data: string, label: "right" | "wrong"): Promise<PageReturn> {
    assert.ok(fragment.port, "the development fragment names the loopback port");
    // As `nearReturnUrl` of the page builds it.
    const url = `http://127.0.0.1:${fragment.port}/near-signature?nonce=${encodeURIComponent(nonce)}&data=${data}`;
    try {
      const response = await fetch(url);
      return { nonce: label, status: response.status, text: await response.text(), error: null };
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
      return { nonce: label, status: null, text: null, error: `${String(error)}${cause}` };
    }
  }
}

// --- Harness ---------------------------------------------------------------------------------------

class Details {
  readonly values: { [key: string]: Json } = {};

  set(key: string, value: unknown): void {
    this.values[key] = toJson(value);
  }
}

interface Scenario {
  name: string;
  passed: boolean;
  details: { [key: string]: Json };
  error?: string;
}

const scenarios: Scenario[] = [];
const statuses: NearWalletStatus[] = [];
const agentAnswers: Json[] = [];

function withDeadline<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`timed out: ${label}`)), WAIT_MS);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function scenario(name: string, run: (details: Details) => Promise<void>): Promise<void> {
  const details = new Details();
  try {
    await run(details);
    scenarios.push({ name, passed: true, details: details.values });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    scenarios.push({ name, passed: false, details: details.values, error: message });
    process.stderr.write(`FAIL ${name}\n${message}\n`);
  }
}

type PrepareAnswer = NearPaymentPlan | { error: string };

async function attempt<A, E extends { readonly message: string }>(
  effect: Effect.Effect<A, E>,
): Promise<{ value: A; error: null } | { value: null; error: string }> {
  const result = await Effect.runPromise(Effect.result(effect));
  return Result.isSuccess(result)
    ? { value: result.success, error: null }
    : { value: null, error: result.failure.message };
}

class Wallet {
  readonly service: NearWalletService;
  readonly signing: NearOwnerSigning;
  readonly store: NearWalletStore;

  constructor(path: string, cipher: RecordingCipher, page: SigningPage, api: FakeAgentApi) {
    this.store = new NearWalletStore(path, cipher);
    this.signing = new NearOwnerSigning({ pageOrigin: PAGE_ORIGIN, openExternal: page.openExternal, loopback: true });
    this.service = new NearWalletService({ store: this.store, signing: this.signing, baseUrl: api.baseUrl });
    this.service.onChanged((status) => statuses.push(structuredClone(status)));
  }

  status(): NearWalletStatus {
    const status = this.service.status();
    statuses.push(structuredClone(status));
    return status;
  }

  /** Resolves on the first status, now or emitted, that matches. */
  waitFor(label: string, matches: (status: NearWalletStatus) => boolean): Promise<NearWalletStatus> {
    return withDeadline(
      label,
      new Promise((done) => {
        const now = this.status();
        if (matches(now)) return done(now);
        const stop = this.service.onChanged((status) => {
          if (!matches(status)) return;
          stop();
          done(status);
        });
      }),
    );
  }

  async prepare(request: NearPaymentRequest): Promise<PrepareAnswer> {
    const result = await attempt(this.service.prepare(request));
    const answer: PrepareAnswer = result.error === null ? result.value : { error: result.error };
    agentAnswers.push(toJson(answer));
    return answer;
  }

  /** Pays a prepared request. A refusal fails the scenario. */
  async pay(requestId: string): Promise<NearPaymentResult> {
    const result = await attempt(this.service.pay(requestId));
    agentAnswers.push(toJson(result.value ?? { error: result.error }));
    if (result.error !== null) throw new Error(`pay(${requestId}) was refused: ${result.error}`);
    return result.value;
  }
}

function payment(requestId: string, overrides: Partial<NearPaymentRequest> = {}): NearPaymentRequest {
  return {
    agentId: AGENT_A,
    threadId: "thread-1",
    requestId,
    domain: DOMAIN,
    recipient: MERCHANT,
    asset: "USDC",
    amount: "1",
    reason: "An API call for the e2e test",
    ...overrides,
  };
}

function decoded<T>(value: T | null, name: string): T {
  assert.ok(value !== null, `the contract parser takes the ${name}`);
  return value;
}

const typedBodySchema = z.object({ type: z.string() });
function intentType(body: Json): string | null {
  return typedBodySchema.safeParse(body).data?.type ?? null;
}

function sent(api: FakeAgentApi, from: number) {
  return api.requests.slice(from).map(({ method, path, idempotencyKey, answered }) => ({
    method,
    path: path.replace(/[0-9a-f]{64}/u, ":agent"),
    idempotencyKey,
    answered,
  }));
}

const isTransfer = (request: RecordedRequest) => request.path.endsWith("/transfer");

// --- Scenarios -------------------------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "openbot-near-wallet-e2e-"));
  const storePath = join(dir, "near-wallet.json");
  const api = new FakeAgentApi();
  await api.start();
  const cipher = new RecordingCipher();
  const owner = newEvmKey();
  const page = new SigningPage(owner);
  let wallet = new Wallet(storePath, cipher, page, api);
  await Effect.runPromise(wallet.service.load());
  /** Kept after disconnect, to check that the report does not hold it. */
  let grantToken = "";

  try {
    await scenario("a wrong partner key is refused and not stored", async (details) => {
      const mark = api.requests.length;
      const result = await attempt(wallet.service.setKey(decoded(parseNearPartnerKey(WRONG_KEY), "key")));
      const status = wallet.status();
      details.set("result", { error: result.error, state: result.value?.state, statusError: result.value?.error });
      details.set("requests", sent(api, mark));
      assert.equal(status.state, "no-key");
      assert.equal(result.error ?? result.value?.error, sourceText("error.connector.nearKeyRejected"));
      assert.ok(!JSON.stringify(status).includes(WRONG_KEY), "the status holds no part of the key");
      await assert.rejects(stat(storePath), "no store file is written");
    });

    await scenario("setKey checks the key with whoami and stores it", async (details) => {
      const mark = api.requests.length;
      const status = await Effect.runPromise(wallet.service.setKey(decoded(parseNearPartnerKey(PARTNER_KEY), "key")));
      details.set("status", { state: status.state, error: status.error });
      details.set("requests", sent(api, mark));
      assert.equal(status.state, "no-wallet");
      assert.equal(status.error, null);
      assert.deepEqual(
        api.requests.slice(mark).map((request) => [request.method, request.path, request.apiKey]),
        [["GET", "/v1/whoami", "<partner-key>"]],
      );
      assert.equal(wallet.store.read().partnerKey, PARTNER_KEY);
    });

    await scenario("create registers the EVM owner, makes the account and issues the grant", async (details) => {
      const mark = api.requests.length;
      const input = decoded(
        parseNearWalletCreateInput({ ownerMethod: "evm", dailyBudgetUsd: "50", agentIds: [AGENT_A] }),
        "setup",
      );
      await Effect.runPromise(wallet.service.create(input));
      const status = await wallet.waitFor(
        "create ends",
        (current) =>
          (current.state === "ready" && current.balances.length > 0 && current.signing === null) ||
          current.error !== null,
      );
      await page.settle();
      const record = wallet.store.read();
      const actions = page.visits.map((visit) => visit.fragment.action);
      details.set("status", {
        state: status.state,
        account: status.account,
        balances: status.balances,
        error: status.error,
      });
      details.set("signedActions", actions);
      details.set("requests", sent(api, mark));
      assert.equal(status.error, null);
      assert.equal(status.state, "ready");
      assert.equal(wallet.service.ready(), true);
      assert.deepEqual(actions, ["register", "create", "grant"]);
      assert.equal(record.owner?.type === "evm" ? record.owner.address : null, owner.address);
      const agentId = record.wallet?.agentId ?? "";
      const fakeAgent = api.agents.get(agentId);
      assert.ok(fakeAgent, "the fake API has the agent account");
      assert.equal(policyOf(fakeAgent).owner_approval, true);
      assert.equal(policyOf(fakeAgent).budget.daily_usd, "50");
      assert.equal(status.account?.accountId, agentId);
      assert.equal(status.account?.dailyBudgetUsd, "50");
      assert.equal(status.account?.ownerApproval, true);
      assert.deepEqual(status.agentIds, [AGENT_A]);
      assert.equal(status.balances[0]?.amount, "1000");
      const grant = record.wallet?.grant;
      assert.equal(grant?.active, true);
      assert.equal(grant?.grantId, fakeAgent.grants[0]?.grantId);
      assert.match(grant?.token ?? "", /^ngt_[A-Za-z0-9_-]{43}$/u);
      assert.equal(fakeAgent.grants[0]?.commitment, sha256Hex(grant?.token ?? ""), "the API got the token commitment");
      const requests = api.requests.slice(mark);
      assert.ok(
        requests.every((request) => request.grantToken === null),
        "no setup request carries the grant token",
      );
      const generated = requests.filter((request) => request.path === "/v1/generate-intent");
      assert.deepEqual(
        generated.map((request) => intentType(request.body)),
        ["agent_create", "grant_issue"],
      );
      assert.ok(
        generated.every((request) => request.idempotencyKey !== null),
        "each generate-intent has an idempotency key",
      );
    });

    await scenario("the loopback listener answers the signing page", async (details) => {
      const returns = page.visits.flatMap((visit) => visit.returns);
      details.set("returns", returns);
      assert.ok(returns.length > 0, "the page returned at least one result");
      for (const item of returns) {
        assert.equal(item.error, null, `the page gets an answer, not a network error (${item.error})`);
        assert.equal(item.status, 200);
        assert.equal(item.text, sourceText("status.agent.nearSignatureReceived"));
      }
    });

    await scenario("prepare asks for a chosen agent and refuses another agent", async (details) => {
      const ask = await wallet.prepare(payment("pay-ask-1", { amount: "1.5" }));
      const refused = await wallet.prepare(payment("pay-refused", { agentId: AGENT_B }));
      const status = wallet.status();
      details.set("ask", ask);
      details.set("refused", refused);
      details.set("pending", status.payments);
      assert.deepEqual(ask, { kind: "ask", amount: "1.5", symbol: "USDC" });
      assert.deepEqual(refused, { error: sourceText("error.connector.nearAgentNotAllowed") });
      assert.equal(status.payments.length, 1);
      assert.equal(status.payments[0]?.requestId, "pay-ask-1");
      assert.equal(status.payments[0]?.amountUsd, 1.5);
      assert.equal(status.payments[0]?.overLimit, false);
    });

    await scenario("pay after approval: the owner votes, the payment is paid and counted", async (details) => {
      const mark = api.requests.length;
      const visits = page.visits.length;
      const result = await wallet.pay("pay-ask-1");
      const status = wallet.status();
      const agentId = wallet.store.read().wallet?.agentId ?? "";
      const transfers = api.requests.slice(mark).filter(isTransfer);
      details.set("result", result);
      details.set("requests", sent(api, mark));
      details.set("spentTodayUsd", status.account?.spentTodayUsd);
      assert.equal(result.status, "paid");
      assert.equal(transfers.length, 1);
      const transfer = transfers[0];
      assert.match(transfer?.idempotencyKey ?? "", /^openbot-[0-9a-f-]{36}$/u);
      assert.equal(transfer?.grantToken, "<grant-token>");
      assert.equal(transfer?.apiKey, "<partner-key>");
      assert.deepEqual(transfer?.body, { asset: USDC, amount: "1500000", recipient: MERCHANT });
      assert.deepEqual(
        page.visits.slice(visits).map((visit) => visit.fragment.action),
        ["approve-payment"],
      );
      assert.equal(api.spentUsd(agentId), "1.50");
      assert.equal(status.account?.spentTodayUsd, "1.50");
      assert.equal(status.payments.length, 0);
      assert.equal(wallet.store.read().payments.length, 0, "the stored payment is removed when paid");
    });

    await scenario("a payment over the API daily budget fails", async (details) => {
      const mark = api.requests.length;
      const ask = await wallet.prepare(payment("pay-budget", { recipient: "big.near", amount: "60" }));
      details.set("ask", ask);
      assert.deepEqual(ask, { kind: "ask", amount: "60", symbol: "USDC" });
      const result = await wallet.pay("pay-budget");
      details.set("result", result);
      details.set("requests", sent(api, mark));
      assert.equal(result.status, "failed");
      assert.ok(result.detail, "the agent gets a sentence");
      assert.equal(wallet.store.read().payments.length, 0);
      assert.equal(api.spentUsd(wallet.store.read().wallet?.agentId ?? ""), "1.50");
    });

    await scenario(
      "saveRule turns off the owner approval once; rule payments are auto up to the limit",
      async (details) => {
        const visits = page.visits.length;
        const mark = api.requests.length;
        const rule = decoded(parseNearRuleInput({ domain: DOMAIN, recipients: [MERCHANT], dailyUsd: 5 }), "rule");
        const saved = await Effect.runPromise(wallet.service.saveRule(rule));
        const actions = page.visits.slice(visits).map((visit) => visit.fragment.action);
        details.set("saved", { error: saved.error, rules: saved.rules, ownerApproval: saved.account?.ownerApproval });
        details.set("signedActions", actions);
        assert.equal(saved.error, null);
        assert.deepEqual(actions, ["auto-pay"]);
        const agentId = wallet.store.read().wallet?.agentId ?? "";
        const fakeAgent = api.agents.get(agentId);
        assert.ok(fakeAgent);
        assert.equal(policyOf(fakeAgent).owner_approval, false);
        assert.equal(wallet.store.read().wallet?.ownerApproval, false);
        const update = api.requests
          .slice(mark)
          .map((request) => policyUpdateSchema.safeParse(request.body).data)
          .find((body) => body !== undefined);
        assert.equal(update?.expected_revision, 1);

        const auto = await wallet.prepare(payment("pay-auto-1", { amount: "2" }));
        assert.deepEqual(auto, { kind: "auto" });
        assert.equal((await wallet.pay("pay-auto-1")).status, "paid");
        const after = wallet.status();
        details.set("rules", after.rules);
        assert.equal(after.rules[0]?.spentTodayUsd, 2);

        const over = await wallet.prepare(payment("pay-over-1", { amount: "4" }));
        details.set("over", over);
        assert.deepEqual(over, { kind: "ask", amount: "4", symbol: "USDC" });
        assert.equal(wallet.status().payments.find((item) => item.requestId === "pay-over-1")?.overLimit, true);
        wallet.service.drop("pay-over-1");
        assert.equal(wallet.status().payments.length, 0);
      },
    );

    await scenario("allowPayment adds the recipient; the next payment under the limit is auto", async (details) => {
      const visits = page.visits.length;
      const ask = await wallet.prepare(payment("pay-shop-1", { recipient: SHOP, amount: "1" }));
      assert.deepEqual(ask, { kind: "ask", amount: "1", symbol: "USDC" });
      assert.equal(wallet.status().payments[0]?.overLimit, false);
      const allowed = await Effect.runPromise(
        wallet.service.allowPayment(
          decoded(parseNearAllowPaymentInput({ requestId: "pay-shop-1", dailyUsd: 10 }), "allow"),
        ),
      );
      details.set("rules", allowed.rules);
      assert.equal(allowed.error, null);
      assert.deepEqual(allowed.rules[0]?.recipients, [MERCHANT, SHOP]);
      assert.equal(allowed.rules[0]?.dailyUsd, 10);
      assert.equal(page.visits.length, visits, "no signature: auto-pay is already on");
      assert.equal((await wallet.pay("pay-shop-1")).status, "paid");
      assert.equal(wallet.status().rules[0]?.spentTodayUsd, 3, "the approved payment counts under the rule");

      const auto = await wallet.prepare(payment("pay-shop-2", { recipient: SHOP, amount: "1" }));
      assert.deepEqual(auto, { kind: "auto" });
      assert.equal((await wallet.pay("pay-shop-2")).status, "paid");
      const over = await wallet.prepare(payment("pay-shop-3", { recipient: SHOP, amount: "7" }));
      details.set("over", over);
      assert.deepEqual(over, { kind: "ask", amount: "7", symbol: "USDC" });
      assert.equal(wallet.status().payments.find((item) => item.requestId === "pay-shop-3")?.overLimit, true);
      wallet.service.drop("pay-shop-3");
    });

    await scenario("a lost answer is uncertain; a restart sends it again with the same key, once", async (details) => {
      const mark = api.requests.length;
      const balanceBefore = api.balanceRaw;
      const auto = await wallet.prepare(payment("pay-lost", { amount: "1" }));
      assert.deepEqual(auto, { kind: "auto" });
      api.dropNextExecution = true;
      const result = await wallet.pay("pay-lost");
      details.set("result", result);
      assert.equal(result.status, "uncertain");
      assert.equal(result.correlationId, null);
      const stored = wallet.store.read().payments;
      assert.equal(stored.length, 1, "the payment stays stored");
      const key = stored[0]?.idempotencyKey ?? "";
      assert.equal(stored[0]?.correlationId, null);
      const first = api.requests.slice(mark).filter(isTransfer);
      assert.deepEqual(
        first.map((request) => [request.idempotencyKey, request.answered]),
        [[key, "dropped"]],
      );
      assert.equal(api.balanceRaw, balanceBefore - 1_000_000n, "the API settled it before the answer was lost");

      await Effect.runPromise(wallet.service.dispose());
      const restarted = new Wallet(storePath, cipher, page, api);
      const cleared = cipher.nextWrite("the restart removes the stored payment", (keys) => !keys.includes(key));
      await Effect.runPromise(restarted.service.load());
      await cleared;
      // Store writes run one at a time; this one ends after the write that the cipher reported.
      await Effect.runPromise(restarted.store.update((record) => record));
      wallet = restarted;
      const transfers = api.requests.slice(mark).filter(isTransfer);
      details.set(
        "transfers",
        sent(api, mark).filter((request) => request.path.endsWith("/transfer")),
      );
      assert.deepEqual(
        transfers.map((request) => request.idempotencyKey),
        [key, key],
        "the replay uses the same idempotency key",
      );
      assert.deepEqual(transfers[1]?.body, transfers[0]?.body, "the replay sends the same body");
      const executions = [...api.executions.values()].filter((item) => item.idempotencyKey === key);
      assert.equal(executions.length, 1);
      assert.equal(executions[0]?.settlements, 1, "paid once");
      assert.equal(api.balanceRaw, balanceBefore - 1_000_000n, "no second debit");
      assert.equal(wallet.store.read().payments.length, 0);
      assert.equal(wallet.status().rules[0]?.spentTodayUsd, 5, "the spend of the lost payment is kept");
    });

    await scenario("freeze stops payments; unfreeze starts them again", async (details) => {
      const visits = page.visits.length;
      const agentId = wallet.store.read().wallet?.agentId ?? "";
      const fakeAgent = api.agents.get(agentId);
      assert.ok(fakeAgent);
      const frozen = await Effect.runPromise(wallet.service.freeze());
      details.set("frozen", { state: frozen.state, error: frozen.error });
      assert.equal(frozen.error, null);
      assert.equal(frozen.state, "frozen");
      assert.equal(wallet.service.ready(), false);
      assert.equal(policyOf(fakeAgent).frozen, true);
      const refused = await wallet.prepare(payment("pay-frozen"));
      details.set("refused", refused);
      assert.deepEqual(refused, { error: sourceText("error.connector.nearFrozen") });
      const unfrozen = await Effect.runPromise(wallet.service.unfreeze());
      details.set("unfrozen", { state: unfrozen.state, error: unfrozen.error });
      assert.equal(unfrozen.error, null);
      assert.equal(unfrozen.state, "ready");
      assert.equal(wallet.service.ready(), true);
      assert.equal(policyOf(fakeAgent).frozen, false);
      assert.deepEqual(
        page.visits.slice(visits).map((visit) => visit.fragment.action),
        ["freeze", "unfreeze"],
      );
    });

    await scenario("forged signature returns are refused", async (details) => {
      // A wrong nonce: the listener ignores it and the signature still waits.
      const wrongNoncePage = new SigningPage(owner);
      wrongNoncePage.mode = { kind: "wrong-nonce" };
      const signing = new NearOwnerSigning({
        pageOrigin: PAGE_ORIGIN,
        openExternal: wrongNoncePage.openExternal,
        loopback: true,
      });
      const visited = wrongNoncePage.nextVisit("the wrong-nonce page returns");
      const outcome = signing
        .sign({ kind: "register", method: "evm", action: "register", summary: "" }, "evm", null)
        .then(
          () => "resolved",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      const visit = await visited;
      details.set("wrongNonce", visit.returns);
      assert.equal(visit.returns[0]?.status, 404, "the listener does not take a wrong nonce");
      assert.equal(signing.busy(), true, "the signature still waits");
      assert.equal(signing.receive("not-the-nonce", "e30"), false);
      // The right nonce, but the registration is signed by another key than the claimed address.
      const forged = wrongNoncePage.result(visit.fragment, wrongNoncePage.other);
      assert.equal(signing.receive(visit.fragment.nonce, forged), true);
      const registerOutcome = await outcome;
      details.set("otherKeyRegister", registerOutcome);
      assert.equal(registerOutcome, sourceText("error.connector.nearSigningInvalid"));
      assert.equal(signing.busy(), false);
      assert.equal(signing.receive(visit.fragment.nonce, forged), false, "a used nonce is not taken again");
      await signing.dispose();

      // The right nonce, but the intent is signed by another key: the API refuses it and nothing changes.
      const agentId = wallet.store.read().wallet?.agentId ?? "";
      const fakeAgent = api.agents.get(agentId);
      assert.ok(fakeAgent);
      const revision = fakeAgent.revision;
      page.mode = { kind: "other-key" };
      try {
        const result = await attempt(wallet.service.setBudget("20"));
        const status = wallet.status();
        details.set("otherKeyIntent", {
          refused: result.error,
          error: status.error,
          budget: status.account?.dailyBudgetUsd,
        });
        assert.ok(result.error ?? status.error, "the change is refused with a sentence");
        assert.equal(status.account?.dailyBudgetUsd, "50");
        assert.equal(policyOf(fakeAgent).budget.daily_usd, "50");
        assert.equal(fakeAgent.revision, revision);
      } finally {
        page.mode = { kind: "honest" };
      }
      assert.equal(wallet.service.receiveSignature("no-such-nonce", "e30"), false);
    });

    await scenario("setBudget with the owner's signature changes the API budget", async (details) => {
      const status = await Effect.runPromise(wallet.service.setBudget("20"));
      const fakeAgent = api.agents.get(wallet.store.read().wallet?.agentId ?? "");
      assert.ok(fakeAgent);
      details.set("status", { error: status.error, budget: status.account?.dailyBudgetUsd });
      assert.equal(status.error, null);
      assert.equal(status.account?.dailyBudgetUsd, "20");
      assert.equal(policyOf(fakeAgent).budget.daily_usd, "20");
      assert.equal(policyOf(fakeAgent).owner_approval, false, "the change keeps auto-pay");
    });

    await scenario("secrets stay out of the store file, statuses, answers, logs and requests", async (details) => {
      const token = wallet.store.read().wallet?.grant?.token ?? "";
      grantToken = token;
      assert.ok(token, "a grant token exists to look for");
      const file = await readFile(storePath, "utf8");
      const secrets = { partnerKey: PARTNER_KEY, grantToken: token };
      const forms = (value: string) => [value, Buffer.from(value).toString("base64"), encodeURIComponent(value)];
      const places = {
        storeFile: file,
        statuses: JSON.stringify(statuses),
        agentAnswers: JSON.stringify(agentAnswers),
        output: captured.join("\n"),
        signingPages: JSON.stringify(page.visits),
        requestUrlsAndBodies: api.rawRequests.join("\n"),
      };
      const found: string[] = [];
      for (const [place, text] of Object.entries(places)) {
        for (const [name, value] of Object.entries(secrets)) {
          if (forms(value).some((form) => text.includes(form))) found.push(`${name} in ${place}`);
        }
      }
      const tokenRequests = api.requests.filter((request) => request.grantToken !== null);
      details.set("statusCount", statuses.length);
      details.set("outputChunks", captured.length);
      details.set("grantTokenPaths", [
        ...new Set(tokenRequests.map((request) => request.path.replace(/[0-9a-f]{64}/u, ":agent"))),
      ]);
      details.set("found", found);
      assert.deepEqual(found, []);
      assert.ok(
        tokenRequests.every((request) => /\/(transfer|withdraw)$/u.test(request.path)),
        "the grant token goes to payment endpoints only",
      );
      assert.ok(
        tokenRequests.every((request) => request.grantToken === "<grant-token>"),
        "the grant token header is the stored token",
      );
      // By design the encrypted record keeps both; the file holds them only encrypted.
      const fileRecord = z.object({ record: z.string() }).parse(JSON.parse(file));
      const decrypted = cipher.decrypt(Buffer.from(fileRecord.record, "base64"));
      assert.ok(decrypted.includes(PARTNER_KEY) && decrypted.includes(token), "the encrypted record keeps both");
    });

    await scenario("disconnect forgets the wallet and clears the store file", async (details) => {
      const status = await Effect.runPromise(wallet.service.disconnect());
      details.set("status", { state: status.state, error: status.error, account: status.account });
      assert.equal(status.state, "no-key");
      assert.equal(status.account, null);
      assert.equal(status.error, null);
      assert.equal(wallet.service.ready(), false);
      await assert.rejects(stat(storePath), "the store file is removed");
      const refused = await wallet.prepare(payment("pay-after-disconnect"));
      assert.deepEqual(refused, { error: sourceText("error.connector.nearNoWallet") });
    });
  } finally {
    await Effect.runPromise(wallet.service.dispose()).catch(() => undefined);
    await page.settle();
    await api.stop();
    await rm(dir, { recursive: true, force: true });
  }

  const report = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      passed: scenarios.every((item) => item.passed),
      scenarios,
      requests: api.requests.map((request) => ({ ...request, path: request.path.replace(/[0-9a-f]{64}/u, ":agent") })),
    },
    null,
    2,
  );
  if (report.includes(PARTNER_KEY) || (grantToken !== "" && report.includes(grantToken)))
    throw new Error("The report would hold a secret; it is not written.");
  await writeFile(join(OUT, "report.json"), `${report}\n`);
  const failed = scenarios.filter((item) => !item.passed);
  process.stdout.write(
    `${scenarios.length - failed.length}/${scenarios.length} scenarios passed. Report: ${join(OUT, "report.json")}\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
process.exit(process.exitCode ?? 0);
