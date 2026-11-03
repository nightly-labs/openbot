// Real Codex stdio client and voice service with synthetic auth and a loopback sideband.
// No account files, live provider calls or microphone access. Report: .openbot-build/subscription-voice-e2e/.
import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { redactText } from "@openbot/logging";
import { createSubscriptionVoiceSession, type SubscriptionVoiceSession } from "@openbot/team-client/voice-subscription";
import { Effect } from "effect";
import WebSocket, { WebSocketServer } from "ws";
import {
  type CodexSubscriptionAuth,
  readCodexSubscriptionAuth,
  subscriptionAuthFailure,
} from "../src/backend/agent/codex-subscription-auth";
import type { VoiceContextEntry } from "../src/backend/agent/voice-context";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { decodeRecordResponse } from "../src/backend/protocol";
import { createRealtimeVoicePreferenceStore, RealtimeVoiceService } from "../src/main/realtime-voice-service";

const root = await mkdtemp(join(tmpdir(), "openbot-subscription-voice-"));
const out = resolve(".openbot-build/subscription-voice-e2e");
const accountId = "synthetic-voice-account";
const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.signature`;
const executable = join(root, "codex-fixture");
const callsFile = join(root, "calls.jsonl");
const checks: string[] = [];
const fixture = `#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  fs.appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify({method:m.method,params:m.params})+'\\n');
  let result={};
  if (m.method === 'account/read') result={account:{type:process.env.FIXTURE_ACCOUNT,email:'fixture@example.invalid'}};
  if (m.method === 'getAuthStatus') result={authMethod:process.env.FIXTURE_METHOD,authToken:process.env.FIXTURE_TOKEN};
  process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});
`;
await writeFile(executable, fixture);
await chmod(executable, 0o700);
async function withAuth<A, E>(
  account: string,
  method: string,
  use: (auth: CodexSubscriptionAuth) => Effect.Effect<A, E>,
) {
  const client = new CodexAppServerClient(executable, 2_000, {
    FIXTURE_CALLS: callsFile,
    FIXTURE_ACCOUNT: account,
    FIXTURE_METHOD: method,
    FIXTURE_TOKEN: token,
  });
  client.start();
  try {
    await Effect.runPromise(
      client.request("initialize", { capabilities: { experimentalApi: true } }, decodeRecordResponse),
    );
    return await Effect.runPromise(readCodexSubscriptionAuth(client).pipe(Effect.flatMap(use)));
  } finally {
    await Effect.runPromise(client.stop());
  }
}
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const frames: string[] = [];
const savedContext: VoiceContextEntry[] = [];
let accountCurrent = true;
let providerRequests = 0;
let replySdp = "v=0\r\n";
let upstream: WebSocket | undefined;
let onFrame: ((frame: string) => void) | undefined;
server.on("connection", (socket) => {
  upstream = socket;
  socket.on("message", (data) => {
    frames.push(data.toString());
    onFrame?.(data.toString());
  });
});
const providerFetch = Object.assign(
  async (url: URL | RequestInfo, init?: RequestInit) => {
    providerRequests += 1;
    assert.equal(
      String(url),
      "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
    );
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
    assert.equal(new Headers(init?.headers).get("chatgpt-account-id"), accountId);
    assert.equal(init?.redirect, "error");
    const offer = JSON.parse(String(init?.body));
    assert.equal(offer.session.audio.output.voice, expectedVoice);
    assert.ok(offer.session.instructions.includes("Selected agent: Pam; the shopping day is Friday."));
    assert.ok(
      offer.session.instructions.lastIndexOf("Current startup instruction:") >
        offer.session.instructions.indexOf("Selected agent: Pam; the shopping day is Friday."),
    );
    assert.deepEqual(offer.session.initial_items, [
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: offer.session.instructions }],
      },
    ]);
    return new Response(replySdp, { headers: { "openai-session-id": "rtc_synthetic" } });
  },
  { preconnect: fetch.preconnect },
);
let expectedVoice = "cove";
const preferences = createRealtimeVoicePreferenceStore(join(root, "voice.json"));
await Effect.runPromise(preferences.load());
const voice = new RealtimeVoiceService({
  preferences,
  context: () => Effect.succeed("Selected agent: Pam; the shopping day is Friday."),
  mode: "subscription",
  enabled: true,
  saveContext: (_agentId, _sessionId, entries) => savedContext.push(...entries),
  withSubscriptionAuth: (_selected, use) =>
    Effect.tryPromise({
      try: () => withAuth("chatgpt", "chatgpt", (auth) => use({ ...auth, stillCurrent: () => accountCurrent })),
      catch: subscriptionAuthFailure,
    }),
  fetch: providerFetch,
  subscriptionSocket: (url, headers) => {
    assert.equal(url, "wss://api.openai.com/v1/live/rtc_synthetic");
    assert.equal(headers.Authorization, `Bearer ${token}`);
    return new WebSocket(`ws://127.0.0.1:${address.port}`);
  },
});
let client: SubscriptionVoiceSession | undefined;
let passed = false;
try {
  assert.deepEqual(await withAuth("chatgpt", "chatgpt", (auth) => Effect.succeed(auth)), { token, accountId });
  checks.push("Codex-owned ChatGPT metadata and token are both required");
  const authCases: Array<[string, string]> = [
    ["apiKey", "apiKey"],
    ["chatgpt", "apiKey"],
  ];
  for (const [account, method] of authCases) {
    await assert.rejects(withAuth(account, method, () => Effect.succeed(true)));
  }
  checks.push("API-key accounts and mismatched token auth fail without fallback");
  assert.equal(redactText(`bare ${token}`).includes(token), false);
  const requests = (await readFile(callsFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    requests.some(
      (item) =>
        item.method === "getAuthStatus" && item.params.refreshToken === true && item.params.includeToken === true,
    ),
  );
  assert.equal(
    requests.some((item) => item.method.startsWith("thread/") || item.method.startsWith("turn/")),
    false,
  );
  checks.push("Auth refresh starts no Codex thread or action; bare tokens are redacted");
  assert.equal(new RealtimeVoiceService({ apiKey: "synthetic-api-key" }).status().enabled, false);
  checks.push("Subscription mode does not activate an available API key");
  const answer = await Effect.runPromise(voice.connect({ agentId: "pam", sdp: "v=0\r\n" }, "nick", () => true));
  assert.ok(answer.sessionId && answer.sessionId !== "rtc_synthetic");
  assert.equal(JSON.stringify(answer).includes(token), false);
  const call = { agentId: "pam", sessionId: answer.sessionId };
  assert.ok(upstream);
  upstream.send(
    JSON.stringify({
      type: "turn.done",
      turn: { role: "assistant", transcript: "You said tomorrow is a school day." },
    }),
  );
  const startupIgnored = new Promise<void>((resolveFrame) => {
    onFrame = (frame) => {
      const value = JSON.parse(frame);
      if (
        value.type === "delegation.context.append" &&
        value.delegation_item_id === "startup-history" &&
        value.channel === "commentary"
      )
        resolveFrame();
    };
  });
  upstream.send(
    JSON.stringify({
      type: "delegation.created",
      item: {
        type: "delegation",
        target: "client",
        id: "startup-history",
        content: [{ type: "input_text", text: "Repeat the old historical task" }],
      },
    }),
  );
  await startupIgnored;
  onFrame = undefined;
  assert.equal((await Effect.runPromise(voice.poll(call, "nick", () => true))).delegation, null);
  assert.equal(
    savedContext.some((entry) => entry.kind === "delegation-context"),
    false,
  );
  checks.push("Startup greetings can use history, but history cannot dispatch a task before fresh user speech");
  // The voice model may return no transcript. A fresh user-turn event still permits its delegation context.
  upstream.send(JSON.stringify({ type: "turn.done", turn: { role: "user" } }));
  upstream.send(
    JSON.stringify({
      type: "delegation.created",
      item: {
        type: "delegation",
        target: "client",
        id: "request-1",
        content: [{ type: "input_text", text: "Plan tomorrow" }],
      },
    }),
  );
  let offers = 0;
  await new Promise<void>((resolveWait, reject) => {
    const deadline = setTimeout(() => reject(new Error("No delegation event.")), 2_000);
    client = createSubscriptionVoiceSession({
      call,
      port: {
        poll: (input) => Effect.runPromise(voice.poll(input, "nick", () => true)),
        reply: (input) => Effect.runPromise(voice.reply(input, "nick", () => true)),
        end: (input) => Effect.runPromise(voice.end(input, "nick")),
      },
      onDelegation: () => {
        offers += 1;
        if (offers === 1) return false;
        clearTimeout(deadline);
        resolveWait();
        return true;
      },
      onError: () => {
        clearTimeout(deadline);
        reject(new Error("Client delegation failed."));
      },
    });
    client.start();
  });
  assert.equal(offers, 2);
  checks.push("A busy client leaves delegation pending until it can accept it");
  await assert.rejects(Effect.runPromise(voice.poll(call, "britt", () => true)));
  assert.ok(
    (await Effect.runPromise(voice.poll(call, "nick", () => true))).delegation?.request.includes("Plan tomorrow"),
  );
  assert.equal((await Effect.runPromise(voice.poll(call, "nick", () => true))).delegation?.request, "Plan tomorrow");
  assert.ok(savedContext.some((entry) => entry.text.includes("tomorrow is a school day")));
  checks.push(
    "Voice starts with selected-agent context; delegation keeps that context out of the visible user request",
  );
  const received = new Promise<void>((resolveFrame) => {
    onFrame = (frame) => {
      if (JSON.parse(frame).type === "delegation.context.append") resolveFrame();
    };
  });
  await Effect.runPromise(
    voice.reply({ ...call, delegationId: "request-1", text: "The normal agent answer." }, "nick", () => true),
  );
  await received;
  const before = frames.length;
  await Effect.runPromise(
    voice.reply({ ...call, delegationId: "request-1", text: "The normal agent answer." }, "nick", () => true),
  );
  assert.equal(frames.length, before);
  const contextFrames = frames
    .map((frame) => JSON.parse(frame))
    .filter((frame) => frame.type === "session.context.append");
  assert.ok(contextFrames.length > 0);
  assert.ok(contextFrames.every((frame) => frame.channel === "commentary" && frame.delegation_item_id === undefined));
  assert.ok(
    contextFrames
      .map((frame) => frame.content[0].text)
      .join("")
      .includes("Selected agent: Pam; the shopping day is Friday."),
  );
  assert.equal(
    frames
      .map((frame) => JSON.parse(frame))
      .find((frame) => frame.type === "delegation.context.append" && frame.channel === "speakable")?.delegation_item_id,
    "request-1",
  );
  checks.push("Selected-agent context is sent on the silent sideband before the spoken delegation answer");
  checks.push("Owner-bound delegation and idempotent answer append through the real service and sideband");
  await assert.rejects(Effect.runPromise(voice.poll(call, "nick", () => false)));
  await assert.rejects(Effect.runPromise(voice.poll(call, "nick", () => true)));
  assert.ok(savedContext.some((entry) => entry.text.includes("school day")));
  assert.ok(savedContext.some((entry) => entry.kind === "agent-answer"));
  checks.push("Spoken context reaches delegation and the final handoff, even without exact user words");
  checks.push("Revocation closes the host-owned subscription call");
  const missingAnswer = await Effect.runPromise(voice.connect({ agentId: "pam", sdp: "v=0\r\n" }, "nick", () => true));
  assert.ok(missingAnswer.sessionId && upstream);
  const missingCall = { agentId: "pam", sessionId: missingAnswer.sessionId };
  const missingClosed = once(upstream, "close");
  upstream.send(JSON.stringify({ type: "turn.done", turn: { role: "user", transcript: "An old request" } }));
  upstream.send(
    JSON.stringify({
      type: "delegation.created",
      item: { type: "delegation", target: "client", id: "missing-context" },
    }),
  );
  await missingClosed;
  await assert.rejects(Effect.runPromise(voice.poll(missingCall, "nick", () => true)));
  checks.push("Missing delegation context closes the call instead of repeating an old transcript as a task");
  const toggleAnswer = await Effect.runPromise(voice.connect({ agentId: "pam", sdp: "v=0\r\n" }, "nick", () => true));
  assert.ok(toggleAnswer.sessionId);
  await Effect.runPromise(voice.setEnabled(false));
  await assert.rejects(
    Effect.runPromise(voice.poll({ agentId: "pam", sessionId: toggleAnswer.sessionId }, "nick", () => true)),
  );
  const restoredPreferences = createRealtimeVoicePreferenceStore(join(root, "voice.json"));
  await Effect.runPromise(restoredPreferences.load());
  assert.equal(restoredPreferences.get().enabled, false);
  const disabledRequests = providerRequests;
  await assert.rejects(Effect.runPromise(voice.connect({ agentId: "pam", sdp: "v=0\r\n" }, "nick", () => true)));
  assert.equal(providerRequests, disabledRequests);
  await Effect.runPromise(voice.setVoice("ember"));
  await Effect.runPromise(voice.setEnabled(true));
  await Effect.runPromise(restoredPreferences.load());
  assert.equal(restoredPreferences.get().voice, "ember", "The toggle lost the selected voice.");
  const reloadedVoice = new RealtimeVoiceService({
    preferences: restoredPreferences,
    mode: "subscription",
    withSubscriptionAuth: (_selected, use) =>
      Effect.tryPromise({
        try: () => withAuth("chatgpt", "chatgpt", (auth) => use({ ...auth, stillCurrent: () => accountCurrent })),
        catch: subscriptionAuthFailure,
      }),
  });
  assert.equal(reloadedVoice.status().voice, "ember");
  await Effect.runPromise(reloadedVoice.close());
  await assert.rejects(
    Effect.runPromise(voice.setVoice("alloy")),
    "An API-only voice was accepted for subscription calls.",
  );
  assert.equal(voice.status().voice, "ember");
  await Promise.all([Effect.runPromise(voice.setVoice("cove")), Effect.runPromise(voice.setEnabled(false))]);
  await Effect.runPromise(restoredPreferences.load());
  assert.deepEqual(
    restoredPreferences.get(),
    { enabled: false, voice: "cove" },
    "Concurrent changes lost a saved preference.",
  );
  await Effect.runPromise(voice.setVoice("ember"));
  await Effect.runPromise(voice.setEnabled(true));
  const legacyPath = join(root, "legacy-voice.json");
  await writeFile(legacyPath, JSON.stringify({ version: 1, enabled: false }));
  const legacyPreferences = createRealtimeVoicePreferenceStore(legacyPath);
  await Effect.runPromise(legacyPreferences.load());
  assert.deepEqual(legacyPreferences.get(), { enabled: false, voice: null });
  checks.push("Concurrent preference changes retain both fields, and enabled-only preference files remain valid");
  expectedVoice = "ember";
  checks.push(
    "Voice selection survives host reload and toggle changes, and rejects the other authentication mode's voices",
  );
  checks.push("The toggle ends active calls, persists across reload and blocks provider requests while off");
  accountCurrent = false;
  const beforeChangedAccount = providerRequests;
  await assert.rejects(Effect.runPromise(voice.connect({ agentId: "pam", sdp: "v=0\r\n" }, "nick", () => true)));
  assert.equal(providerRequests, beforeChangedAccount, "A changed subscription account reached the provider.");
  checks.push("A changed subscription account fails before the provider request, with no API fallback");
  accountCurrent = true;
  replySdp = `v=0\r\n${token}`;
  await assert.rejects(
    Effect.runPromise(voice.connect({ agentId: "pam", sdp: "v=0\r\n" }, "nick", () => true)),
    (error) => !String(error).includes(token),
  );
  checks.push("An unexpected provider echo cannot return an OAuth token in SDP");
  passed = true;
} finally {
  client?.close();
  await Effect.runPromise(voice.close());
  for (const client of server.clients) client.terminate();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        passed,
        checks,
        unverified: [
          "Live subscriber entitlement",
          "Real microphone and audio playback",
          "Native build and device behavior",
        ],
      },
      null,
      2,
    ),
  );
  // Machine-readable: local verification receipt, with no token or request content.
  process.stdout.write(`${JSON.stringify({ passed, checks: checks.length, report: join(out, "report.json") })}\n`);
}
