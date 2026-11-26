import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type NearWalletStatus,
  parseNearAgentsInput,
  parseNearAllowPaymentInput,
  parseNearRuleInput,
  parseNearWalletCreateInput,
  parseNearWalletStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { z } from "zod";
import type { NearPaymentPlan, NearPaymentRequest, NearPaymentResult } from "../src/backend/near-wallet";
import { NearWalletService } from "../src/main/near-wallet-service";
import { NearOwnerSigning } from "../src/main/near-wallet-signing";
import { NearWalletStore } from "../src/main/near-wallet-store";
import {
  FakeAgentApi,
  fakeTransactionHash,
  type Json,
  KeyedNearGateway,
  PAGE_ORIGIN,
  PARTNER_KEY,
  policyOf,
  policyUpdateSchema,
  type RecordedRequest,
  RecordingCipher,
  SigningPage,
  sha256Hex,
  toJson,
  USDC,
  withDeadline,
} from "./near-wallet-fake-api";

const OUT = resolve(import.meta.dirname, "../.openbot-build/near-wallet-e2e");
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const DOMAIN = "api.example.com";
const MERCHANT = "merchant.near";
const SHOP = "shop.near";

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
  readonly gateway = new KeyedNearGateway(PARTNER_KEY);

  constructor(path: string, cipher: RecordingCipher, page: SigningPage, api: FakeAgentApi) {
    this.store = new NearWalletStore(path, cipher);
    this.signing = new NearOwnerSigning({ pageOrigin: PAGE_ORIGIN, openExternal: page.openExternal, loopback: true });
    this.service = new NearWalletService({
      store: this.store,
      signing: this.signing,
      gateway: this.gateway,
      baseUrl: api.baseUrl,
    });
    this.service.onChanged((status) => statuses.push(structuredClone(status)));
  }

  status(): NearWalletStatus {
    const status = this.service.status();
    assert.notEqual(parseNearWalletStatus(structuredClone(status)), null, "status passes the IPC decoder");
    statuses.push(structuredClone(status));
    return status;
  }

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
const SEND_ATTEMPTS = 3;

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "openbot-near-wallet-e2e-"));
  const storePath = join(dir, "near-wallet.json");
  const api = new FakeAgentApi();
  await api.start();
  const cipher = new RecordingCipher();
  const page = new SigningPage();
  let wallet = new Wallet(storePath, cipher, page, api);
  await Effect.runPromise(wallet.service.load());
  let grantToken = "";

  try {
    await scenario("signed out, setup is refused before any wallet call", async (details) => {
      const mark = api.requests.length;
      wallet.gateway.signedIn = false;
      const before = wallet.status();
      const input = decoded(parseNearWalletCreateInput({ dailyBudgetUsd: "50" }), "setup");
      const result = await attempt(wallet.service.create(input));
      details.set("state", before.state);
      details.set("result", { error: result.error, statusError: result.value?.error });
      details.set("requests", sent(api, mark));
      assert.equal(before.state, "signed-out");
      assert.equal(result.error ?? result.value?.error, sourceText("error.connector.nearSignIn"));
      assert.equal(api.requests.length, mark, "no request leaves the computer");
      await assert.rejects(stat(storePath), "no store file is written");
    });

    await scenario("signed in, setup starts with no key step", async (details) => {
      wallet.gateway.signedIn = true;
      const status = wallet.status();
      details.set("status", { state: status.state, error: status.error });
      assert.equal(status.state, "no-wallet");
    });

    await scenario(
      "create registers the passkey owner, then one signature makes the account and its grant",
      async (details) => {
        const mark = api.requests.length;
        const input = decoded(parseNearWalletCreateInput({ dailyBudgetUsd: "50" }), "setup");
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
        assert.deepEqual(actions, ["register", "create"]);
        assert.equal(record.owner?.credential_id, page.credentialId);
        assert.equal(record.owner?.public_key, page.publicKey);
        const agentId = record.wallet?.agentId ?? "";
        const fakeAgent = api.agents.get(agentId);
        assert.ok(fakeAgent, "the fake API has the agent account");
        assert.equal(policyOf(fakeAgent).owner_approval, true);
        assert.equal(policyOf(fakeAgent).budget.daily_usd, "50");
        assert.equal(status.account?.accountId, agentId);
        assert.equal(status.account?.dailyBudgetUsd, "50");
        assert.equal(status.account?.ownerApproval, true);
        assert.equal(status.allAgents, true);
        assert.deepEqual(status.agentIds, []);
        assert.equal(status.balances[0]?.amount, "1000");
        const grant = record.wallet?.grant;
        assert.equal(grant?.active, true);
        assert.equal(grant?.grantId, fakeAgent.grants[0]?.grantId);
        assert.match(grant?.token ?? "", /^ngt_[A-Za-z0-9_-]{43}$/u);
        assert.equal(
          fakeAgent.grants[0]?.commitment,
          sha256Hex(grant?.token ?? ""),
          "the API got the token commitment",
        );
        const requests = api.requests.slice(mark);
        assert.ok(
          requests.every((request) => request.grantToken === null),
          "no setup request carries the grant token",
        );
        const generated = requests.filter((request) => request.path === "/v1/generate-intent");
        assert.deepEqual(
          generated.map((request) => intentType(request.body)),
          ["agent_create"],
        );
        assert.ok(
          generated.every((request) => request.idempotencyKey !== null),
          "each generate-intent has an idempotency key",
        );
      },
    );

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

    await scenario("a new wallet lets every agent ask to pay", async (details) => {
      const asked = await wallet.prepare(payment("pay-any-agent", { agentId: AGENT_B }));
      const status = wallet.status();
      details.set("asked", asked);
      assert.deepEqual(asked, { kind: "ask", amount: "1", symbol: "USDC" });
      assert.equal(status.payments[0]?.requestId, "pay-any-agent");
      wallet.service.drop("pay-any-agent");
      assert.equal(wallet.status().payments.length, 0);
    });

    await scenario("prepare asks for a chosen agent and refuses another agent", async (details) => {
      const listed = decoded(parseNearAgentsInput({ allAgents: false, agentIds: [AGENT_A] }), "agents");
      const chosen = await Effect.runPromise(wallet.service.setAgents(listed));
      const ask = await wallet.prepare(payment("pay-ask-1", { amount: "1.5" }));
      const refused = await wallet.prepare(payment("pay-refused", { agentId: AGENT_B }));
      const status = wallet.status();
      details.set("chosen", { allAgents: chosen.allAgents, agentIds: chosen.agentIds });
      details.set("ask", ask);
      details.set("refused", refused);
      assert.equal(chosen.allAgents, false);
      assert.deepEqual(chosen.agentIds, [AGENT_A]);
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
      const status = await wallet.waitFor(
        "the refresh after the payment shows the spent amount",
        (current) => current.account?.spentTodayUsd === "1.50",
      );
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
        assert.deepEqual(auto, { kind: "auto", amount: "2", symbol: "USDC" });
        const paidAuto = await wallet.pay("pay-auto-1");
        assert.equal(paidAuto.status, "paid");
        assert.equal(
          paidAuto.transactionHash,
          paidAuto.correlationId ? fakeTransactionHash(paidAuto.correlationId) : null,
          "a paid transfer gives its transaction hash",
        );
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
      assert.deepEqual(auto, { kind: "auto", amount: "1", symbol: "USDC" });
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
      assert.deepEqual(auto, { kind: "auto", amount: "1", symbol: "USDC" });
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

    await scenario("two auto payments at the same time stay inside the rule limit", async (details) => {
      const mark = api.requests.length;
      assert.equal(wallet.status().rules[0]?.spentTodayUsd, 5);
      assert.deepEqual(await wallet.prepare(payment("pay-race-1", { amount: "3" })), {
        kind: "auto",
        amount: "3",
        symbol: "USDC",
      });
      assert.deepEqual(await wallet.prepare(payment("pay-race-2", { amount: "3" })), {
        kind: "auto",
        amount: "3",
        symbol: "USDC",
      });
      const results = await Promise.all([wallet.pay("pay-race-1"), wallet.pay("pay-race-2")]);
      details.set("results", results);
      details.set(
        "transfers",
        sent(api, mark).filter((request) => request.path.endsWith("/transfer")),
      );
      assert.deepEqual(results.map((result) => result.status).sort(), ["declined", "paid"]);
      assert.equal(
        results.find((result) => result.status === "declined")?.detail,
        sourceText("error.connector.nearDeclined"),
      );
      assert.equal(api.requests.slice(mark).filter(isTransfer).length, 1, "only one payment is sent");
      assert.equal(wallet.status().rules[0]?.spentTodayUsd, 8);
    });

    await scenario(
      "a proxy error with no error document is uncertain; after a new grant a restart does not send it again",
      async (details) => {
        const mark = api.requests.length;
        assert.deepEqual(await wallet.prepare(payment("pay-proxy", { amount: "1" })), {
          kind: "auto",
          amount: "1",
          symbol: "USDC",
        });
        api.proxyFailures = SEND_ATTEMPTS;
        const result = await wallet.pay("pay-proxy");
        details.set("result", result);
        assert.equal(result.status, "uncertain");
        assert.equal(api.proxyFailures, 0);
        const stored = wallet.store.read().payments;
        assert.equal(stored.length, 1, "the payment stays stored");
        const key = stored[0]?.idempotencyKey ?? "";
        const before = api.requests.slice(mark).filter(isTransfer);
        assert.ok(before.every((request) => request.idempotencyKey === key && request.answered === 502));
        assert.equal(wallet.status().rules[0]?.spentTodayUsd, 9, "the spend of the uncertain payment is kept");

        const renewed = await Effect.runPromise(wallet.service.renewGrant());
        details.set("renewed", { state: renewed.state, error: renewed.error });
        assert.equal(renewed.error, null);
        await Effect.runPromise(wallet.service.dispose());
        const restarted = new Wallet(storePath, cipher, page, api);
        const cleared = cipher.nextWrite(
          "the restart drops the payment of the old grant",
          (keys) => !keys.includes(key),
        );
        await Effect.runPromise(restarted.service.load());
        await cleared;
        await Effect.runPromise(restarted.store.update((record) => record));
        wallet = restarted;
        const after = api.requests.slice(mark).filter(isTransfer);
        details.set(
          "transfers",
          sent(api, mark).filter((request) => request.path.endsWith("/transfer")),
        );
        assert.equal(after.length, before.length, "no transfer under the new grant");
        assert.equal(wallet.store.read().payments.length, 0);
        assert.equal(wallet.status().rules[0]?.spentTodayUsd, 9, "the dropped payment is not refunded");
      },
    );

    await scenario("a token price of zero makes a rule payment ask the owner", async (details) => {
      api.usdPrice = 0;
      await Effect.runPromise(wallet.service.dispose());
      wallet = new Wallet(storePath, cipher, page, api);
      await Effect.runPromise(wallet.service.load());
      const ask = await wallet.prepare(payment("pay-no-price", { amount: "500" }));
      details.set("ask", ask);
      assert.deepEqual(ask, { kind: "ask", amount: "500", symbol: "USDC" });
      assert.equal(wallet.status().payments.find((item) => item.requestId === "pay-no-price")?.amountUsd, null);
      wallet.service.drop("pay-no-price");
      api.usdPrice = 1;
      await Effect.runPromise(wallet.service.dispose());
      wallet = new Wallet(storePath, cipher, page, api);
      await Effect.runPromise(wallet.service.load());
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
      const wrongNoncePage = new SigningPage();
      wrongNoncePage.mode = { kind: "wrong-nonce" };
      const signing = new NearOwnerSigning({
        pageOrigin: PAGE_ORIGIN,
        openExternal: wrongNoncePage.openExternal,
        loopback: true,
      });
      const visited = wrongNoncePage.nextVisit("the wrong-nonce page returns");
      const outcome = signing.sign({ kind: "register", action: "register", summary: "" }, null).then(
        () => "resolved",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      const visit = await visited;
      details.set("wrongNonce", visit.returns);
      assert.equal(visit.returns[0]?.status, 404, "the listener does not take a wrong nonce");
      assert.equal(signing.busy(), true, "the signature still waits");
      assert.equal(signing.receive("not-the-nonce", "e30"), false);
      const forged = wrongNoncePage.forgedRegister();
      assert.equal(signing.receive(visit.fragment.nonce, forged), true);
      const registerOutcome = await outcome;
      details.set("forgedRegister", registerOutcome);
      assert.equal(registerOutcome, sourceText("error.connector.nearSigningInvalid"));
      assert.equal(signing.busy(), false);
      assert.equal(signing.receive(visit.fragment.nonce, forged), false, "a used nonce is not taken again");
      await signing.dispose();

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

    await scenario("removing the last rule turns the owner approval on again", async (details) => {
      const fakeAgent = api.agents.get(wallet.store.read().wallet?.agentId ?? "");
      assert.ok(fakeAgent);
      const visits = page.visits.length;
      const other = decoded(
        parseNearRuleInput({ domain: "other.example.com", recipients: [SHOP], dailyUsd: 5 }),
        "rule",
      );
      await Effect.runPromise(wallet.service.saveRule(other));
      const kept = await Effect.runPromise(wallet.service.removeRule(other.domain));
      details.set("afterOtherRule", { error: kept.error, rules: kept.rules.map((rule) => rule.domain) });
      assert.equal(kept.error, null);
      assert.deepEqual(
        page.visits.slice(visits).map((visit) => visit.fragment.action),
        [],
        "a rule that is not the last one needs no signature",
      );
      assert.equal(policyOf(fakeAgent).owner_approval, false);

      const removed = await Effect.runPromise(wallet.service.removeRule(DOMAIN));
      const actions = page.visits.slice(visits).map((visit) => visit.fragment.action);
      details.set("removed", {
        error: removed.error,
        rules: removed.rules,
        ownerApproval: removed.account?.ownerApproval,
      });
      details.set("signedActions", actions);
      assert.equal(removed.error, null);
      assert.deepEqual(removed.rules, []);
      assert.deepEqual(actions, ["manual-pay"]);
      assert.equal(policyOf(fakeAgent).owner_approval, true);
      assert.equal(wallet.store.read().wallet?.ownerApproval, true);
      assert.equal(removed.account?.ownerApproval, true);

      const ask = await wallet.prepare(payment("pay-no-rule", { amount: "1" }));
      details.set("ask", ask);
      assert.deepEqual(ask, { kind: "ask", amount: "1", symbol: "USDC" });
      wallet.service.drop("pay-no-rule");
    });

    await scenario("secrets stay out of the store file, statuses, answers, logs and requests", async (details) => {
      const token = wallet.store.read().wallet?.grant?.token ?? "";
      grantToken = token;
      assert.ok(token, "a grant token exists to look for");
      const file = await readFile(storePath, "utf8");
      const secrets = { partnerKey: PARTNER_KEY, grantToken: token };
      const keyedRequests = api.requests.filter((request) => request.apiKey !== "<partner-key>");
      details.set("requestsWithoutTheKey", keyedRequests.length);
      assert.equal(keyedRequests.length, 0, "the gateway adds the partner key to each request");
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
      const fileRecord = z.object({ record: z.string() }).parse(JSON.parse(file));
      const decrypted = cipher.decrypt(Buffer.from(fileRecord.record, "base64"));
      assert.ok(decrypted.includes(token), "the encrypted record keeps the grant token");
      assert.ok(!decrypted.includes(PARTNER_KEY), "the record holds no partner key");
    });

    await scenario("disconnect forgets the wallet and clears the store file", async (details) => {
      const status = await Effect.runPromise(wallet.service.disconnect());
      details.set("status", { state: status.state, error: status.error, account: status.account });
      assert.equal(status.state, "no-wallet");
      assert.equal(status.account, null);
      assert.equal(status.error, null);
      assert.equal(wallet.service.ready(), false);
      await assert.rejects(stat(storePath), "the store file is removed");
      const refused = await wallet.prepare(payment("pay-after-disconnect"));
      assert.deepEqual(refused, { error: sourceText("error.connector.nearNoWallet") });
    });

    await scenario("a refused create grant falls back to a grant signature", async (details) => {
      api.refuseCreateGrant = true;
      const mark = api.requests.length;
      const visits = page.visits.length;
      const input = decoded(parseNearWalletCreateInput({ dailyBudgetUsd: "50" }), "setup");
      await Effect.runPromise(wallet.service.create(input));
      const status = await wallet.waitFor(
        "create with a refused grant ends",
        (current) => (current.state === "ready" && current.signing === null) || current.error !== null,
      );
      await page.settle();
      const actions = page.visits.slice(visits).map((visit) => visit.fragment.action);
      const generated = api.requests.slice(mark).filter((request) => request.path === "/v1/generate-intent");
      details.set("signedActions", actions);
      details.set("status", { state: status.state, error: status.error });
      assert.equal(status.error, null);
      assert.deepEqual(actions, ["register", "create", "grant"]);
      assert.deepEqual(
        generated.map((request) => intentType(request.body)),
        ["agent_create", "grant_issue"],
      );
      const grant = wallet.store.read().wallet?.grant;
      const fakeAgent = api.agents.get(wallet.store.read().wallet?.agentId ?? "");
      assert.equal(grant?.active, true);
      assert.equal(grant?.grantId, fakeAgent?.grants[0]?.grantId);
      api.refuseCreateGrant = false;
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
