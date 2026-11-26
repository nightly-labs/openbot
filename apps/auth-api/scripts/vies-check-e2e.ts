import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { Effect, Result } from "effect";
import { ViesClient, type ViesTiming } from "../src/server/vies-client";

const OUT = resolve(import.meta.dirname, "../../../.openbot-build/vies-check-e2e.json");
const TIMING: ViesTiming = { deadlineMs: 1_500, attemptTimeoutMs: 400, minAttemptMs: 100, retryDelayMs: 50 };
const VAT_ID = "DE123456789";
const REQUESTER = "PL1234567890";

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

async function runCase(name: string, replies: Reply[], requester: string | null) {
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
  const started = Date.now();
  const result = await Effect.runPromise(Effect.result(client.check(VAT_ID)));
  const elapsedMs = Date.now() - started;
  for (const response of open) response.destroy();
  await new Promise<void>((done) => server.close(() => done()));
  const outcome = Result.isSuccess(result)
    ? `valid=${result.success.valid} id=${result.success.requestIdentifier ?? "none"}`
    : result.failure._tag;
  return { name, outcome, requests, elapsedMs } satisfies CaseReport;
}

const cases: CaseReport[] = [];
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
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ passed: failure === undefined, cases, failure }, null, 2)}\n`);
for (const report of cases) console.log(`PASS ${report.name}: ${report.outcome} (${report.requests.length} requests)`);
if (failure) {
  console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`Report: ${OUT}`);
