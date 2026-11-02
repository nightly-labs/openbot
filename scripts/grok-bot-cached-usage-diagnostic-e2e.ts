// Exercises cached-only diagnostics through a real loopback service and temporary account files.
// No live app, provider account, prompt, or OS credential store is used.
// bun scripts/grok-bot-cached-usage-diagnostic-e2e.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import {
  GrokBotAccountStore,
  type GrokBotCachedGateway,
  type GrokBotGatewaySession,
} from "../src/backend/grok-bot/grok-bot-account";
import {
  type GrokBotUsageDiagnosticReport,
  readGrokBotUsageDiagnostic,
} from "../src/backend/grok-bot/grok-bot-usage-diagnostic";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-cached-usage-diagnostic-e2e");
const report: { passed: boolean; cases: string[] } = { passed: false, cases: [] };
const PRIVATE = "private-fixture-content-do-not-export";
const ID = "synthetic-agent";
const NONCE = "synthetic-nonce";
const ECHO = "synthetic-echo";
const TOKEN = "synthetic-gateway-credential";
const session: GrokBotGatewaySession = {
  url: "http://127.0.0.1:1340",
  token: TOKEN,
  headers: {
    "x-anyrun-network-token": "synthetic-network-credential",
    Cookie: PRIVATE,
    Authorization: PRIVATE,
    "x-unknown": PRIVATE,
  },
};
let decryptCalls = 0;
let failDecrypt = false;
const root = await mkdtemp(join(tmpdir(), "openbot-cached-diagnostic-"));
const accountPath = join(root, "account.json");
const store = new GrokBotAccountStore(accountPath, {
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => {
    decryptCalls += 1;
    if (failDecrypt) throw new Error(PRIVATE);
    return value.toString("utf8");
  },
});
let mode = "normal";
let paths: string[] = [];
let controls = new AbortController();
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  request.on("end", () => {
    const path = request.url ?? "";
    paths.push(path);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(request.headers["x-anyrun-network-token"], "synthetic-network-credential");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers["x-unknown"], undefined);
    if (mode.startsWith("http-")) {
      response.writeHead(Number(mode.slice(5)));
      response.end(PRIVATE);
      return;
    }
    if (mode === "reject-runs" && path === "/api/getAgentRunHistory") {
      response.writeHead(417).end(PRIVATE);
      return;
    }
    if (mode === "redirect") {
      response.writeHead(302, { location: "https://unexpected.example/" }).end(PRIVATE);
      return;
    }
    if (mode === "slow-body") {
      response.writeHead(200);
      response.write("{");
      return;
    }
    if (mode === "drop") {
      request.socket.destroy();
      return;
    }
    if (mode === "declared-large") {
      response.writeHead(200, { "content-length": 131073 });
      response.end(PRIVATE);
      return;
    }
    if (mode === "chunked-large") {
      response.writeHead(200);
      response.end("x".repeat(131073));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    if (mode === "invalid-json") {
      response.end(PRIVATE);
      return;
    }
    if (mode === "null-json") {
      response.end("null");
      return;
    }
    if (path === "/api/promptAcceptanceStatus" && mode === "malformed-acceptance") {
      response.end(JSON.stringify({ outcome: "found", record: {} }));
      return;
    }
    if (path === "/api/promptAcceptanceStatus" && mode === "bad-outcome-object") {
      response.end(JSON.stringify({ outcome: { toString: PRIVATE } }));
      return;
    }
    if (path === "/api/listAgents") {
      response.end(
        JSON.stringify({
          agents:
            mode === "no-agents"
              ? []
              : mode === "agent-limit"
                ? [...Array.from({ length: 20 }, () => ({})), { id: ID }]
                : [{ id: ID, name: PRIVATE, token: PRIVATE }, { id: "never-selected" }],
        }),
      );
    } else if (path === "/api/getAgentRunHistory") {
      assert.deepEqual(body, { id: ID, limit: 10 });
      response.end(
        JSON.stringify({
          agentId: mode === "wrong-agent" ? "other" : ID,
          runs:
            mode === "no-runs"
              ? []
              : Array.from({ length: 15 }, (_, i) => ({
                  requestId: PRIVATE,
                  detail: PRIVATE,
                  usage:
                    mode === "invalid-counts"
                      ? { requests: -1, inputTokens: "5", outputTokens: 1.5, cacheReadTokens: null }
                      : { requests: 1, inputTokens: 200, outputTokens: 10, cacheReadTokens: 100 },
                  ...(mode === "run-nonce" ? { clientNonce: NONCE } : {}),
                  index: i,
                })),
          unknown: PRIVATE,
        }),
      );
    } else if (path === "/api/getAgentTranscriptTail") {
      assert.deepEqual(body, { id: ID, limit: 20 });
      response.end(
        JSON.stringify({
          entries:
            mode === "no-nonce"
              ? [{ role: "user", id: ECHO, text: PRIVATE }]
              : [{ role: "user", id: ECHO, clientNonce: NONCE, text: PRIVATE, images: [PRIVATE], tools: [PRIVATE] }],
        }),
      );
    } else if (path === "/api/promptAcceptanceStatus") {
      assert.deepEqual(body, { accountSlot: "host", clientNonce: NONCE });
      response.end(
        JSON.stringify(
          mode === "unknown-acceptance"
            ? { outcome: "unknown-durability" }
            : {
                outcome: "found",
                record: {
                  agentId: ID,
                  clientNonce: NONCE,
                  echoEntryId: mode === "mismatch-echo" ? "other" : ECHO,
                  inputDigest: PRIVATE,
                  detail: PRIVATE,
                },
              },
        ),
      );
    } else {
      throw new Error("Diagnostic sent a non-allowlisted request");
    }
  });
});
await new Promise<void>((ready, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", ready);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const local = `http://127.0.0.1:${address.port}`;
const transport: typeof fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = new URL(String(url));
    assert.equal(target.origin, "http://127.0.0.1:1340");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.equal(init?.cache, "no-store");
    const response = await fetch(`${local}${target.pathname}`, init);
    if (mode === "cancel-after-first") controls.abort();
    return response;
  },
  { preconnect: fetch.preconnect },
);
async function check(
  name: string,
  expected: GrokBotUsageDiagnosticReport["outcome"],
  snapshot: () => GrokBotCachedGateway = () => store.cachedGateway(),
  optedIn = true,
) {
  paths = [];
  const beforeDecrypt = decryptCalls;
  const before = await readFile(accountPath).catch(() => null);
  const result = await Effect.runPromise(
    readGrokBotUsageDiagnostic({ optedIn, cachedGateway: snapshot, fetchImpl: transport, signal: controls.signal }),
  );
  assert.equal(result.outcome, expected, name);
  assert.equal(decryptCalls, beforeDecrypt, "diagnostic must not decrypt or load an account");
  assert.deepEqual(
    await readFile(accountPath).catch(() => null),
    before,
    "diagnostic must not change the account file",
  );
  const encoded = JSON.stringify(result);
  for (const value of [PRIVATE, ID, NONCE, ECHO, TOKEN, session.url, "synthetic-network-credential"])
    assert.equal(encoded.includes(value), false, name);
  assert.ok(paths.length <= 4);
  assert.ok(
    paths.every((path) =>
      [
        "/api/listAgents",
        "/api/getAgentRunHistory",
        "/api/getAgentTranscriptTail",
        "/api/promptAcceptanceStatus",
      ].includes(path),
    ),
  );
  report.cases.push(name);
  return result;
}
try {
  await check(
    "disabled-never-reads-snapshot",
    "not-opted-in",
    () => {
      throw new Error("Snapshot was read without opt-in");
    },
    false,
  );
  assert.equal(paths.length, 0);
  await check("cold-cache-no-file-read", "no-cached-account");
  assert.equal(paths.length, 0);
  await Effect.runPromise(store.load());
  await check("missing-account", "signed-out");
  assert.equal(paths.length, 0);
  const account = { accessToken: "e30.eyJleHAiOjF9.signature", refreshToken: PRIVATE, gateway: session };
  await Effect.runPromise(store.save({ ...account, gateway: null }));
  await Effect.runPromise(store.load());
  await check("no-cached-gateway", "no-cached-session");
  assert.equal(paths.length, 0);
  await Effect.runPromise(store.save(account));
  await check("save-invalidates-cache", "no-cached-account");
  await Effect.runPromise(store.load());
  const result = await check("cached-only-with-expired-account-access", "complete");
  assert.equal(paths.length, 4);
  assert.equal(result.runsInspected, 10);
  assert.deepEqual(result.usageFields, { requests: true, input: true, output: true, cacheRead: true });
  assert.equal(result.nonceEchoMatched, true);
  assert.equal(result.runHasNonce, false);
  assert.equal(result.runNonceExactMatch, null);
  const copied = store.cachedGateway();
  if (copied.state === "loaded" && copied.session) {
    copied.session.token = "changed";
    Object.assign(copied.session.headers, { "x-anyrun-network-token": "changed" });
  }
  await check("snapshot-is-a-defensive-copy", "complete");
  for (const variant of ["http-401", "http-403", "http-417", "http-404", "http-500"]) {
    mode = variant;
    const stopped = await check(variant, "read-stopped");
    assert.equal(paths.length, 1);
    assert.equal(stopped.reads[0]?.httpStatus, Number(variant.slice(5)));
  }
  mode = "reject-runs";
  await check("stop-on-later-auth-failure", "read-stopped");
  assert.equal(paths.length, 2);
  for (const [variant, status] of [
    ["redirect", "redirect"],
    ["declared-large", "body-limit"],
    ["chunked-large", "body-limit"],
    ["invalid-json", "invalid-json"],
    ["drop", "network-error"],
    ["slow-body", "timeout"],
  ] as const) {
    mode = variant;
    const stopped = await check(variant, "read-stopped");
    assert.equal(paths.length, 1);
    assert.equal(stopped.reads[0]?.status, status);
  }
  mode = "null-json";
  await check(mode, "invalid-shape");
  assert.equal(paths.length, 1);
  mode = "wrong-agent";
  await check(mode, "invalid-shape");
  assert.equal(paths.length, 2);
  for (const variant of ["no-agents", "agent-limit"]) {
    mode = variant;
    await check(variant, "no-agent");
    assert.equal(paths.length, 1);
  }
  mode = "no-runs";
  await check(mode, "complete");
  assert.equal(paths.length, 2);
  mode = "no-nonce";
  await check(mode, "complete");
  assert.equal(paths.length, 3);
  mode = "unknown-acceptance";
  assert.equal((await check(mode, "complete")).nonceEchoMatched, null);
  mode = "malformed-acceptance";
  await check(mode, "invalid-shape");
  assert.equal(paths.length, 4);
  mode = "bad-outcome-object";
  await check(mode, "invalid-shape");
  assert.equal(paths.length, 4);
  mode = "mismatch-echo";
  assert.equal((await check(mode, "complete")).nonceEchoMatched, false);
  mode = "run-nonce";
  assert.equal((await check(mode, "complete")).runNonceExactMatch, true);
  mode = "invalid-counts";
  assert.deepEqual((await check(mode, "complete")).usageFields, {
    requests: false,
    input: false,
    output: false,
    cacheRead: false,
  });
  mode = "normal";
  for (const url of [
    "https://fixture.cursorvm.com",
    "http://fixture.cursorvm.com",
    "https://cursorvm.com",
    "https://cursorvm.com.evil.example",
    "https://127.0.0.1",
    "http://127.0.0.1:1341",
    "https://user:secret@fixture.cursorvm.com",
    "https://fixture.cursorvm.com:8443",
    "https://fixture.cursorvm.com/?token=secret",
    "https://fixture.cursorvm.com/#secret",
    "http://127.0.0.1:1340/?token=secret",
  ]) {
    await check("invalid-cached-origin", "invalid-session", () => ({ state: "loaded", session: { ...session, url } }));
    assert.equal(paths.length, 0);
  }
  for (const invalid of [
    { ...session, token: "" },
    { ...session, token: "x".repeat(8193) },
    { ...session, headers: { "x-anyrun-network-token": "x".repeat(8193) } },
  ]) {
    await check("invalid-cached-credential-shape", "invalid-session", () => ({ state: "loaded", session: invalid }));
    assert.equal(paths.length, 0);
  }
  const invalidHeader = await check("invalid-header-never-reaches-network", "read-stopped", () => ({
    state: "loaded",
    session: { ...session, token: "invalid\nheader" },
  }));
  assert.equal(paths.length, 0);
  assert.equal(invalidHeader.reads[0]?.status, "network-error");
  controls.abort();
  const cancelled = await check("pre-cancelled-no-network", "read-stopped");
  assert.equal(paths.length, 0);
  assert.equal(cancelled.reads[0]?.status, "cancelled");
  controls = new AbortController();
  mode = "cancel-after-first";
  await check("cancel-prevents-next-request", "read-stopped");
  assert.equal(paths.length, 1);
  controls = new AbortController();
  mode = "normal";
  failDecrypt = true;
  await Effect.runPromise(Effect.result(store.load()));
  await check("failed-load-discards-old-cache", "no-cached-account");
  assert.equal(paths.length, 0);
  failDecrypt = false;
  await Effect.runPromise(store.load());
  store.forgetCachedGateway();
  await check("explicit-cache-forget", "no-cached-account");
  assert.equal(paths.length, 0);
  await Effect.runPromise(store.load());
  await Effect.runPromise(store.clear());
  await check("sign-out-discards-cache", "signed-out");
  assert.equal(paths.length, 0);
  report.passed = true;
} finally {
  await new Promise<void>((ready, reject) => server.close((error) => (error ? reject(error) : ready())));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
