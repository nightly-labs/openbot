import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { NearGatewayOwner, NearIntentsGateway } from "../src/main/near-intents-gateway";
import { NEAR_SIGNING_PATH } from "../src/main/near-wallet-signing";
import type { SecretCipher } from "../src/main/provider-credential-store";

export const PAGE_ORIGIN = "https://accounts.e2e.invalid";
export const PARTNER_KEY = `nia_e2e_${randomBytes(24).toString("hex")}`;
export const USDC = "nep141:usdc.e2e.near";
export const USDC_DECIMALS = 6;
export const WAIT_MS = 20_000;

export class KeyedNearGateway implements NearIntentsGateway {
  signedIn = true;
  readonly #partnerKey: string;
  readonly #send: typeof fetch;

  constructor(partnerKey: string, send: typeof fetch = fetch) {
    this.#partnerKey = partnerKey;
    this.#send = send;
  }

  owners(): NearGatewayOwner[] {
    return this.signedIn ? ["personal"] : [];
  }

  fetch(_owner: NearGatewayOwner): typeof fetch {
    const keyed = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("x-api-key", this.#partnerKey);
      return this.#send(input, { ...init, headers });
    };
    return Object.assign(keyed, { preconnect: this.#send.preconnect });
  }
}

export const jsonSchema = z.json();
export type Json = z.infer<typeof jsonSchema>;
export type JsonObject = { [key: string]: Json };
export const jsonObjectSchema = z.record(z.string(), jsonSchema);

export function toJson(value: unknown): Json {
  const text = JSON.stringify(value);
  return text === undefined ? null : jsonSchema.parse(JSON.parse(text));
}

export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
export const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const webAuthnPayloadSchema = z.object({
  challenge: z.string(),
  rpId: z.string(),
  allowCredentials: z.array(z.object({ id: z.string(), type: z.literal("public-key") })),
  userVerification: z.literal("required"),
  timeout: z.number().int().positive(),
});
export type WebAuthnPayload = z.infer<typeof webAuthnPayloadSchema>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const PASSKEY_FLAGS = 0x01 | 0x04 | 0x08 | 0x10;

export function passkeyAuthenticatorData(rpId: string): Buffer {
  return Buffer.concat([sha256(Buffer.from(rpId)), Buffer.from([PASSKEY_FLAGS]), Buffer.alloc(4)]);
}

interface SignedCredential {
  id: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
}

const signedClientDataSchema = z.object({ type: z.string(), challenge: z.string(), origin: z.string() });

function ownerSigned(agent: FakeAgent, payload: WebAuthnPayload, credential: SignedCredential): boolean {
  if (credential.id !== agent.credentialId) return false;
  const clientDataJSON = Buffer.from(credential.response.clientDataJSON, "base64url");
  const clientData = signedClientDataSchema.safeParse(JSON.parse(clientDataJSON.toString("utf8")));
  if (!clientData.success || clientData.data.type !== "webauthn.get") return false;
  if (clientData.data.challenge !== payload.challenge || new URL(clientData.data.origin).hostname !== agent.rpId)
    return false;
  const authenticatorData = Buffer.from(credential.response.authenticatorData, "base64url");
  if (!authenticatorData.subarray(0, 32).equals(sha256(Buffer.from(agent.rpId)))) return false;
  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  return verify("sha256", signed, agent.ownerKey, Buffer.from(credential.response.signature, "base64url"));
}

export const writtenRecordSchema = z.object({ payments: z.array(z.object({ idempotencyKey: z.string() })) });

export class RecordingCipher implements SecretCipher {
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

export interface RecordedRequest {
  method: string;
  path: string;
  query: { [key: string]: string };
  apiKey: string | null;
  grantToken: string | null;
  idempotencyKey: string | null;
  body: Json;
  answered: number | "dropped";
}

export type Answered = "answered";

export const policySchema = z.object({
  frozen: z.boolean(),
  owner_approval: z.boolean(),
  budget: z.object({ daily_usd: z.string().nullable() }),
});
export const generateSchema = z.object({
  type: z.string(),
  agent_id: z.string().optional(),
  owner: z
    .object({ type: z.literal("passkey"), credential_id: z.string(), public_key: z.string(), rp_id: z.string() })
    .optional(),
  policy: z.object({ confidential: z.boolean() }).optional(),
});
export const submitSchema = z.object({
  type: z.string(),
  correlation_id: z.string(),
  signed_data: z.object({
    standard: z.string(),
    payload: jsonSchema,
    credential: z.object({
      id: z.string(),
      response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string() }),
    }),
  }),
});
export const grantIssueSchema = z.object({ credential: z.string(), expires_at: z.string(), label: z.string() });
export const policyUpdateSchema = z.object({ policy: jsonObjectSchema, expected_revision: z.number() });
export const approvalVoteSchema = z.object({ approval_id: z.string(), verdict: z.string() });
export const executionSchema = z.object({
  asset: z.string(),
  amount: z.string().regex(/^[1-9]\d*$/u),
  recipient: z.string(),
  chain: z.string().optional(),
});

export interface FakeIntent {
  correlationId: string;
  type: string;
  agentId: string;
  request: JsonObject;
  payload: WebAuthnPayload;
  status: "PENDING_SIGNATURE" | "SUCCESS";
  createGrantId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FakeAgent {
  id: string;
  ownerKey: KeyObject;
  credentialId: string;
  rpId: string;
  owner: Json;
  status: "PENDING" | "ACTIVE";
  policy: JsonObject;
  revision: number;
  grants: { grantId: string; commitment: string; expiresAt: string; label: string }[];
  spentCents: number;
  createdAt: string;
}

export interface FakeExecution {
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

export function policyOf(agent: FakeAgent) {
  return policySchema.parse(agent.policy);
}

export class FakeAgentApi {
  readonly requests: RecordedRequest[] = [];
  readonly rawRequests: string[] = [];
  readonly agents = new Map<string, FakeAgent>();
  readonly intents = new Map<string, FakeIntent>();
  readonly executions = new Map<string, FakeExecution>();
  readonly executionsByKey = new Map<string, string>();
  balanceRaw = 1_000n * 10n ** BigInt(USDC_DECIMALS);
  dropNextExecution = false;
  refuseCreateGrant = false;
  proxyFailures = 0;
  usdPrice = 1;
  #server: Server | null = null;
  port = 0;
  latencyMs: (method: string, path: string) => number = () => 0;

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
    const delay = this.latencyMs(request.method ?? "", url.pathname);
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
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
    if (this.proxyFailures > 0 && /\/(transfer|withdraw)$/u.test(url.pathname)) {
      this.proxyFailures -= 1;
      recorded.answered = 502;
      response.writeHead(502, { "content-type": "text/html", "retry-after": "0" }).end("<html>Bad gateway</html>");
      return "answered";
    }
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
    if (method === "GET" && path === "/v1/tokens")
      return answer(200, {
        data: tokenList().map((token) => (token.asset_id === USDC ? { ...token, price: this.usdPrice } : token)),
      });
    if (method === "POST" && path === "/v1/generate-intent") {
      const raw = jsonObjectSchema.safeParse(recorded.body);
      const facts = generateSchema.safeParse(recorded.body);
      if (!raw.success || !facts.success) return bad("generate-intent body");
      if (facts.data.policy && !facts.data.policy.confidential)
        return answer(
          400,
          errorDocument("validation_failed", "request", "A new policy must set confidential to true.", false),
        );
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
            price: this.usdPrice,
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
        ownerKey: createPublicKey({
          key: Buffer.from(facts.owner.public_key, "base64url"),
          format: "der",
          type: "spki",
        }),
        credentialId: facts.owner.credential_id,
        rpId: facts.owner.rp_id,
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
    const payload: WebAuthnPayload = {
      challenge: createHash("sha256")
        .update(`${correlationId}\n${JSON.stringify(raw)}`)
        .digest("base64url"),
      rpId: agent.rpId,
      allowCredentials: [{ id: agent.credentialId, type: "public-key" }],
      userVerification: "required",
      timeout: 300_000,
    };
    this.intents.set(correlationId, {
      correlationId,
      type: facts.type,
      agentId,
      request: raw,
      payload,
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
      intent: { standard: "webauthn", payload },
      preview: { summary: `${facts.type} (e2e)` },
    };
  }

  #submit(body: z.infer<typeof submitSchema>, answer: (status: number, body: Json) => Answered): Answered {
    const intent = this.intents.get(body.correlation_id);
    if (!intent) return answer(404, errorDocument("not_found", "request", "No such intent.", false));
    if (intent.status === "SUCCESS") return answer(202, this.#statusOf(intent.correlationId));
    const signed = body.signed_data;
    if (signed.standard !== "webauthn" || JSON.stringify(signed.payload) !== JSON.stringify(intent.payload))
      return answer(400, errorDocument("payload_mismatch", "request", "The payload changed.", false));
    const agent = this.agents.get(intent.agentId);
    if (!agent || !ownerSigned(agent, intent.payload, signed.credential))
      return answer(400, errorDocument("invalid_signature", "auth", "The owner did not sign this.", false));
    const refused = this.#apply(intent);
    if (refused) return answer(409, errorDocument(refused, "policy", refused, false));
    intent.status = "SUCCESS";
    intent.updatedAt = new Date().toISOString();
    return answer(202, this.#statusOf(intent.correlationId));
  }

  #apply(intent: FakeIntent): string | null {
    const agent = this.agents.get(intent.agentId);
    if (!agent) return "not_found";
    if (intent.type === "agent_create") {
      agent.status = "ACTIVE";
      agent.revision = 1;
      const grant = grantIssueSchema.optional().parse(intent.request.grant);
      if (grant && this.refuseCreateGrant) intent.createGrantId = null;
      if (grant && !this.refuseCreateGrant) {
        const installed = this.#grantFrom(grant);
        agent.grants.push(installed);
        intent.createGrantId = installed.grantId;
      }
    } else if (intent.type === "grant_issue") {
      agent.grants.push(this.#grantFrom(grantIssueSchema.parse(intent.request)));
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

  #grantFrom(request: z.infer<typeof grantIssueSchema>): FakeAgent["grants"][number] {
    return {
      grantId: randomUUID(),
      commitment: request.credential,
      expiresAt: request.expires_at,
      label: request.label,
    };
  }

  #createDetails(intent: FakeIntent, agent: FakeAgent | undefined): JsonObject {
    const grant = agent?.grants.find((item) => item.grantId === intent.createGrantId);
    const refused = intent.createGrantId === null ? "refused:grant_credential_reused" : null;
    return {
      revision: agent?.revision ?? null,
      policy_hash: null,
      transaction_hash: null,
      agent_id: intent.agentId,
      grant: grant ? { grant_id: grant.grantId, label: grant.label, credential_type: "token" } : null,
      grant_install: grant ? "installed" : refused,
    };
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
            : intent.type === "agent_create"
              ? this.#createDetails(intent, agent)
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

const PRODUCTION_TOKEN_COUNT = 240;

export function tokenView(): JsonObject {
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

export function tokenList(): JsonObject[] {
  const others = Array.from({ length: PRODUCTION_TOKEN_COUNT - 1 }, (_, index) => ({
    ...tokenView(),
    asset_id: `nep141:token-${index}.e2e.near`,
    symbol: `T${index}`,
  }));
  return [tokenView(), ...others];
}

export function errorDocument(code: string, layer: string, detail: string, retryable: boolean): JsonObject {
  return { errors: [{ code, layer, title: code, detail, meta: { retryable } }], meta: { request_id: randomUUID() } };
}

export function agentView(agent: FakeAgent): JsonObject {
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

export function atomicToDecimal(raw: bigint): string {
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const fraction = (raw % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/u, "");
  return fraction ? `${raw / scale}.${fraction}` : `${raw / scale}`;
}

export const fragmentSchema = z.object({
  v: z.literal(1),
  nonce: z.string(),
  kind: z.enum(["register", "sign"]),
  action: z.string(),
  summary: z.string(),
  challenge: z.string().optional(),
  userId: z.string().optional(),
  intent: z.object({ standard: z.literal("webauthn"), payload: webAuthnPayloadSchema }).optional(),
  port: z.number().int().optional(),
});
export type Fragment = z.infer<typeof fragmentSchema>;

export type PageMode = { kind: "honest" } | { kind: "other-key" } | { kind: "wrong-nonce" };

export interface PageReturn {
  nonce: "right" | "wrong";
  status: number | null;
  text: string | null;
  error: string | null;
}

export interface PageVisit {
  fragment: Fragment;
  returns: PageReturn[];
}

export class SigningPage {
  readonly visits: PageVisit[] = [];
  mode: PageMode = { kind: "honest" };
  readonly owner = generateKeyPairSync("ec", { namedCurve: "P-256" });
  readonly other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  readonly credentialId = randomBytes(32).toString("base64url");
  readonly #listeners = new Set<(visit: PageVisit) => void>();
  readonly #pending = new Set<Promise<void>>();

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

  get publicKey(): string {
    return this.owner.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  }

  forgedRegister(): string {
    const notAPoint = `${this.publicKey.slice(0, 36)}${randomBytes(64).toString("base64url").slice(0, 85)}A`;
    return base64url(JSON.stringify({ credentialId: this.credentialId, publicKey: notAPoint }));
  }

  result(fragment: Fragment, key: KeyObject): string {
    if (fragment.kind === "register") {
      const authenticatorData = passkeyAuthenticatorData(new URL(PAGE_ORIGIN).hostname).toString("base64url");
      return base64url(
        JSON.stringify({ credentialId: this.credentialId, publicKey: this.publicKey, authenticatorData }),
      );
    }
    assert.ok(fragment.intent, "the owner signs a webauthn intent");
    const { payload } = fragment.intent;
    assert.deepEqual(payload.allowCredentials, [{ id: this.credentialId, type: "public-key" }]);
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: payload.challenge, origin: PAGE_ORIGIN, crossOrigin: false }),
    );
    const authenticatorData = passkeyAuthenticatorData(payload.rpId);
    const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientData)]), key);
    return base64url(
      JSON.stringify({
        credential: {
          id: this.credentialId,
          rawId: this.credentialId,
          type: "public-key",
          response: {
            clientDataJSON: clientData.toString("base64url"),
            authenticatorData: authenticatorData.toString("base64url"),
            signature: signature.toString("base64url"),
          },
          clientExtensionResults: {},
          authenticatorAttachment: "platform",
        },
      }),
    );
  }

  async #respond(visit: PageVisit): Promise<void> {
    const { fragment } = visit;
    if (this.mode.kind === "wrong-nonce") {
      const forgedNonce = randomBytes(32).toString("base64url");
      visit.returns.push(
        await this.#return(fragment, forgedNonce, this.result(fragment, this.owner.privateKey), "wrong"),
      );
      return;
    }
    const key = this.mode.kind === "other-key" ? this.other : this.owner.privateKey;
    visit.returns.push(await this.#return(fragment, fragment.nonce, this.result(fragment, key), "right"));
  }

  async #return(fragment: Fragment, nonce: string, data: string, label: "right" | "wrong"): Promise<PageReturn> {
    assert.ok(fragment.port, "the development fragment names the loopback port");
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

export function withDeadline<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`timed out: ${label}`)), WAIT_MS);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}
