import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { Effect, Result } from "effect";
import { setCustomerBillingDetails } from "../src/server/billing-tax";
import { StripeClient } from "../src/server/stripe-client";
import { ViesClient, type ViesTiming } from "../src/server/vies-client";

const OUT = resolve(import.meta.dirname, "../../../.openbot-build/vies-check-e2e.json");
const TIMING: ViesTiming = { deadlineMs: 1_500, attemptTimeoutMs: 400, minAttemptMs: 100, retryDelayMs: 50 };
const VAT_ID = "DE123456789";
const REQUESTER = "PL1234567890";
const CUSTOMER = "cus_vies_e2e";

type Reply =
  | "valid"
  | "invalidInput"
  | "requesterRefused"
  | "blocked"
  | "busy"
  | "msUnavailable"
  | "serverError"
  | "hang";

interface SeenRequest {
  requester: boolean;
}

interface CaseReport {
  name: string;
  outcome: string;
  requests: SeenRequest[];
  elapsedMs: number;
}

const VALID_BODY = {
  countryCode: "DE",
  vatNumber: "123456789",
  requestDate: "2026-11-26T16:00:00.000Z",
  valid: true,
  requestIdentifier: "WAPI-TEST",
};

function errorBody(error: string) {
  return { actionSucceed: false, errorWrappers: [{ error }] };
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function answer(reply: Reply, requester: boolean, response: ServerResponse) {
  if (reply === "hang") return;
  if (reply === "valid") return send(response, 200, requester ? VALID_BODY : { ...VALID_BODY, requestIdentifier: "" });
  if (reply === "invalidInput") return send(response, 200, errorBody("INVALID_INPUT"));
  if (reply === "requesterRefused") return send(response, 200, errorBody("INVALID_REQUESTER_INFO"));
  if (reply === "blocked") return send(response, 200, errorBody("IP_BLOCKED"));
  if (reply === "busy") return send(response, 200, errorBody("MS_MAX_CONCURRENT_REQUESTS"));
  if (reply === "msUnavailable") return send(response, 200, errorBody("MS_UNAVAILABLE"));
  return send(response, 500, { message: "internal" });
}

async function sentRequester(request: IncomingMessage): Promise<boolean> {
  request.setEncoding("utf8");
  let text = "";
  for await (const chunk of request) text += chunk;
  return "requesterNumber" in JSON.parse(text);
}

async function withVies<T>(replies: Reply[], requester: string | null, use: (client: ViesClient) => Promise<T>) {
  const requests: SeenRequest[] = [];
  const open = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const withRequester = await sentRequester(request);
    requests.push({ requester: withRequester });
    open.add(response);
    response.on("close", () => open.delete(response));
    answer(replies[Math.min(requests.length - 1, replies.length - 1)] ?? "serverError", withRequester, response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new ViesClient(
    (input, init) => fetch(input, init),
    requester,
    `http://127.0.0.1:${address.port}/check-vat-number`,
    TIMING,
  );
  try {
    return { value: await use(client), requests };
  } finally {
    for (const response of open) response.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

async function runCase(name: string, replies: Reply[], requester: string | null) {
  const started = Date.now();
  const { value: result, requests } = await withVies(replies, requester, (client) =>
    Effect.runPromise(Effect.result(client.check(VAT_ID))),
  );
  const elapsedMs = Date.now() - started;
  const outcome = Result.isSuccess(result)
    ? `valid=${result.success.valid} id=${result.success.requestIdentifier ?? "none"}`
    : result.failure._tag;
  return { name, outcome, requests, elapsedMs } satisfies CaseReport;
}

interface FakeCustomer {
  country: string | null;
  taxExempt: string;
  metadata: Record<string, string>;
  taxIds: { id: string; type: string; value: string; verification?: { status: string } }[];
}

function stripeReply(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fakeStripe(customer: FakeCustomer) {
  const customerBody = () => ({
    id: CUSTOMER,
    address: { country: customer.country },
    tax_exempt: customer.taxExempt,
    metadata: customer.metadata,
    tax_ids: { data: customer.taxIds },
  });
  return new StripeClient("sk_test_vies_e2e", async (input, init) => {
    const url = new URL(input);
    const form = new URLSearchParams(typeof init.body === "string" ? init.body : "");
    if (url.pathname === "/v1/subscriptions") return stripeReply({ data: [] });
    if (url.pathname === "/v1/tax_rates") return stripeReply({ data: [] });
    if (url.pathname === `/v1/customers/${CUSTOMER}/tax_ids` && init.method === "POST") {
      const taxId = { id: `txi_${customer.taxIds.length}`, type: "eu_vat", value: form.get("value") ?? "" };
      customer.taxIds.push(taxId);
      return stripeReply(taxId);
    }
    if (url.pathname.startsWith(`/v1/customers/${CUSTOMER}/tax_ids/`) && init.method === "DELETE") {
      const id = url.pathname.split("/").at(-1);
      customer.taxIds = customer.taxIds.filter((taxId) => taxId.id !== id);
      return stripeReply({ id });
    }
    if (url.pathname === `/v1/customers/${CUSTOMER}` && init.method === "POST") {
      customer.taxExempt = form.get("tax_exempt") ?? customer.taxExempt;
      customer.country = form.get("address[country]") ?? customer.country;
      for (const [key, value] of form) {
        const name = /^metadata\[(.+)\]$/.exec(key)?.[1];
        if (name) customer.metadata[name] = value;
      }
      return stripeReply({ id: CUSTOMER });
    }
    if (url.pathname === `/v1/customers/${CUSTOMER}`) return stripeReply(customerBody());
    return new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 404 });
  });
}

interface DetailsReport {
  name: string;
  status: string;
  savedVatId: string | null;
  customer: FakeCustomer;
  alerts: readonly string[];
}

async function runDetailsCase(name: string, replies: Reply[], customer: FakeCustomer): Promise<DetailsReport> {
  const { value: result } = await withVies(replies, null, (client) =>
    Effect.runPromise(
      Effect.result(
        setCustomerBillingDetails(
          fakeStripe(customer),
          client,
          CUSTOMER,
          { country: "DE", vatId: VAT_ID },
          Date.parse("2026-11-26T16:00:00.000Z"),
        ),
      ),
    ),
  );
  if (Result.isFailure(result))
    return { name, status: `${result.failure._tag}`, savedVatId: null, customer, alerts: [] };
  return {
    name,
    status: "saved",
    savedVatId: result.success.details.vatId,
    customer,
    alerts: result.success.vatChanges,
  };
}

const newCustomer = (): FakeCustomer => ({ country: null, taxExempt: "none", metadata: {}, taxIds: [] });

const cases: CaseReport[] = [];
const detailsCases: DetailsReport[] = [];
let failure: string | undefined;
try {
  const answered = await runCase("answers at once", ["valid"], REQUESTER);
  assert.equal(answered.outcome, "valid=true id=WAPI-TEST");
  assert.equal(answered.requests.length, 1);
  cases.push(answered);

  const hung = await runCase("first request hangs, second answers", ["hang", "valid"], REQUESTER);
  assert.equal(hung.outcome, "valid=true id=WAPI-TEST");
  assert.equal(hung.requests.length, 2);
  cases.push(hung);

  const busy = await runCase("member state busy, then answers", ["busy", "msUnavailable", "valid"], REQUESTER);
  assert.equal(busy.outcome, "valid=true id=WAPI-TEST");
  assert.equal(busy.requests.length, 3);
  cases.push(busy);

  const refused = await runCase(
    "requester refused, checks without requester",
    ["requesterRefused", "valid"],
    REQUESTER,
  );
  assert.equal(refused.outcome, "valid=true id=none");
  assert.deepEqual(
    refused.requests.map((request) => request.requester),
    [true, false],
  );
  cases.push(refused);

  const refusedThenBusy = await runCase(
    "requester refusal does not use a plain try",
    ["requesterRefused", "busy", "busy", "valid"],
    REQUESTER,
  );
  assert.equal(refusedThenBusy.outcome, "valid=true id=none");
  assert.equal(refusedThenBusy.requests.length, 4);
  cases.push(refusedThenBusy);

  const blocked = await runCase("blocked caller stops at once", ["blocked", "valid"], null);
  assert.equal(blocked.outcome, "ViesUnavailableError");
  assert.equal(blocked.requests.length, 1);
  cases.push(blocked);

  const invalid = await runCase("unknown VAT ID is invalid at once", ["invalidInput"], REQUESTER);
  assert.equal(invalid.outcome, "valid=false id=none");
  assert.equal(invalid.requests.length, 1);
  cases.push(invalid);

  const down = await runCase("VIES down stays unavailable within the deadline", ["serverError"], null);
  assert.equal(down.outcome, "ViesUnavailableError");
  assert.equal(down.requests.length, 3);
  assert(down.elapsedMs < TIMING.deadlineMs, `took ${down.elapsedMs} ms`);
  cases.push(down);

  const hangs = await runCase("VIES hangs on every request", ["hang"], null);
  assert.equal(hangs.outcome, "ViesUnavailableError");
  assert(hangs.elapsedMs < TIMING.deadlineMs + 200, `took ${hangs.elapsedMs} ms`);
  cases.push(hangs);

  const confirmed = await runDetailsCase("VIES confirms the VAT ID: reverse charge", ["valid"], newCustomer());
  assert.equal(confirmed.status, "saved");
  assert.equal(confirmed.savedVatId, VAT_ID);
  assert.equal(confirmed.customer.taxExempt, "reverse");
  assert.equal(confirmed.customer.metadata.openbot_vat_id, VAT_ID);
  assert.deepEqual(confirmed.alerts, []);
  detailsCases.push(confirmed);

  const unanswered = await runDetailsCase(
    "VIES does not answer: the details save with Polish VAT and an operator alert",
    ["serverError"],
    newCustomer(),
  );
  assert.equal(unanswered.status, "saved");
  assert.equal(unanswered.savedVatId, null);
  assert.equal(unanswered.customer.country, "DE");
  assert.equal(unanswered.customer.taxExempt, "none");
  assert.equal(unanswered.customer.metadata.openbot_vat_id, "");
  assert.deepEqual(
    unanswered.customer.taxIds.map((taxId) => taxId.value),
    [VAT_ID],
  );
  assert.equal(unanswered.alerts.length, 1);
  assert.match(unanswered.alerts[0] ?? "", /^VAT check: VIES did not answer .*pays Polish VAT/);
  assert(unanswered.alerts[0]?.includes(CUSTOMER) && unanswered.alerts[0].includes(VAT_ID));
  detailsCases.push(unanswered);

  const kept = await runDetailsCase(
    "VIES does not answer for an ID that it confirmed before: reverse charge stays",
    ["blocked"],
    {
      country: "DE",
      taxExempt: "reverse",
      metadata: { openbot_vat_id: VAT_ID, openbot_vies_request: "WAPI-OLD", openbot_vat_checked_at: "2026-11-01" },
      taxIds: [{ id: "txi_old", type: "eu_vat", value: VAT_ID }],
    },
  );
  assert.equal(kept.status, "saved");
  assert.equal(kept.savedVatId, VAT_ID);
  assert.equal(kept.customer.taxExempt, "reverse");
  assert.equal(kept.customer.metadata.openbot_vies_request, "WAPI-OLD");
  assert.equal(kept.alerts.length, 1);
  assert.match(kept.alerts[0] ?? "", /^VAT check: VIES did not answer .*keeps reverse charge/);
  detailsCases.push(kept);

  const stripeVerified = await runDetailsCase(
    "VIES does not answer for an ID that Stripe verified: reverse charge stays",
    ["serverError"],
    {
      country: "DE",
      taxExempt: "reverse",
      metadata: {},
      taxIds: [{ id: "txi_migrated", type: "eu_vat", value: VAT_ID, verification: { status: "verified" } }],
    },
  );
  assert.equal(stripeVerified.status, "saved");
  assert.equal(stripeVerified.savedVatId, VAT_ID);
  assert.equal(stripeVerified.customer.taxExempt, "reverse");
  assert.match(stripeVerified.alerts[0] ?? "", /keeps reverse charge/);
  detailsCases.push(stripeVerified);

  const unknown = await runDetailsCase("VIES does not know the VAT ID: refused", ["invalidInput"], newCustomer());
  assert.equal(unknown.status, "BillingError");
  assert.deepEqual(unknown.customer.taxIds, []);
  detailsCases.push(unknown);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ passed: failure === undefined, cases, detailsCases, failure }, null, 2)}\n`);
for (const report of cases) console.log(`PASS ${report.name}: ${report.outcome} (${report.requests.length} requests)`);
for (const report of detailsCases) console.log(`PASS ${report.name}: ${report.status}, ${report.alerts.length} alerts`);
if (failure) {
  console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`Report: ${OUT}`);
