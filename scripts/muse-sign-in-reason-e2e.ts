// Connects Muse on the real driver and `ProviderRuntime`, with a fake `muse serve` host that answers
// the device-code sign-in with each `account/loginCompleted` case. Checks that a refused sign-in
// shows Muse's own reason, redacted, and that a refusal with no reason keeps the general text (#5544).
// `bun scripts/muse-sign-in-reason-e2e.ts`. Writes .openbot-build/muse-sign-in-reason-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentProviderStatus } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/muse-sign-in-reason-e2e");
const WAIT_MS = 20_000;
const PAYMENT = "Muse Code requires a payment method — finish onboarding at https://dev.meta.ai, then log in again.";
const SECRET = "abcdef1234567890";

// Reads its answer from `case.json` in FAKE_MUSE_DIR: `{ outcome, message? }`.
const FAKE_MUSE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  process.stdout.write("muse 1.4.14-R7309.1\\n");
  process.exit(0);
}
if (process.argv[2] !== "serve") process.exit(0);
const dir = process.env.FAKE_MUSE_DIR;
const answer = JSON.parse(fs.readFileSync(path.join(dir, "case.json"), "utf8"));
const signedIn = path.join(dir, "signed-in");
const send = (frame) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (result) => send({ id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({ schema: { version: 1, fingerprint: "fake" }, sessionDurability: "durable", serverInfo: { name: "muse", version: "1.4.14" } });
    case "account/loginStart":
      reply({ verificationUrl: "https://example.invalid/device", userCode: "ABCD-EFGH" });
      if (answer.outcome === "granted") fs.writeFileSync(signedIn, "");
      return send({ method: "account/loginCompleted", params: answer });
    case "account/read":
      return reply(fs.existsSync(signedIn)
        ? { state: "accountLogin", credentialRequired: true, label: "user@example.com" }
        : { state: "loggedOut", credentialRequired: true });
    case "model/list":
      return reply({ providerId: "meta", models: [{ modelId: "muse-1", displayLabel: "Muse 1", providerId: "meta" }] });
    default:
      return reply({});
  }
});
`;

interface Case {
  name: string;
  answer: { outcome: string; message?: string };
  check: (row: AgentProviderStatus) => void;
}

const CASES: Case[] = [
  {
    name: "payment-method",
    answer: { outcome: "failed", message: PAYMENT },
    check: (row) => assert.equal(row.message, `The sign-in did not complete: ${PAYMENT}`),
  },
  {
    name: "secret-in-reason",
    answer: { outcome: "failed", message: `exchange failed with Bearer ${SECRET}` },
    check: (row) => {
      assert.ok(row.message?.startsWith("The sign-in did not complete: "), row.message ?? "no message");
      assert.ok(!row.message?.includes(SECRET), "The row does not show the secret.");
    },
  },
  {
    name: "no-reason",
    answer: { outcome: "denied" },
    check: (row) => assert.equal(row.message, "OpenBot could not connect Muse. Try again."),
  },
  {
    name: "granted",
    answer: { outcome: "granted" },
    check: (row) => assert.equal(row.state, "available"),
  },
];

const root = await mkdtemp(join(tmpdir(), "openbot-muse-sign-in-reason-e2e-"));
const executable = join(root, "bin", "muse");
const saved = { OPENBOT_MUSE_PATH: process.env.OPENBOT_MUSE_PATH, FAKE_MUSE_DIR: process.env.FAKE_MUSE_DIR };
process.env.OPENBOT_MUSE_PATH = executable;
const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
const report: {
  passed: boolean;
  cases: { name: string; state?: string; message?: string | null; opened: string[]; error?: string }[];
} = { passed: false, cases: [] };

/** Connects Muse once and resolves with its row when the sign-in has ended. */
async function connect(item: Case): Promise<void> {
  const dir = join(root, item.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "case.json"), JSON.stringify(item.answer));
  process.env.FAKE_MUSE_DIR = dir;
  const result: (typeof report.cases)[number] = { name: item.name, opened: [] };
  report.cases.push(result);
  let connecting = false;
  let settle: (row: AgentProviderStatus) => void = () => {};
  const ended = new Promise<AgentProviderStatus>((done) => {
    settle = done;
  });
  const runtime = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "muse"),
    conversation: new ConversationRuntime(
      store,
      () => undefined,
      () => store.list(),
    ),
    hooks: {
      bindClient: () => undefined,
      onProvidersReady: () => Effect.void,
      onProviderLost: () => undefined,
      onClientStopped: () => Effect.void,
      isStopping: () => false,
      isProviderBusy: () => false,
      isAgentBusy: () => false,
      isProviderAssigned: () => true,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(root, "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: (event) => {
      if (event.type !== "status") return;
      const row = event.status.providers?.find((candidate) => candidate.id === "muse");
      if (!row) return;
      if (row.connectionState === "connecting") connecting = true;
      else if (connecting) settle(row);
    },
    emitError: () => undefined,
    requestTimeoutMs: 5_000,
    preferredProvider: "muse",
    clientFactory: null,
    bundledExecutables: {},
    credentials: NO_PROVIDER_CREDENTIALS,
    redactMcp: (text) => text,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A signed-out Muse refuses to start: the row asks for a sign-in.
    await Effect.runPromiseExit(runtime.ensureProvider("muse"));
    await Effect.runPromise(
      runtime.connectProvider("muse", async (url) => {
        result.opened.push(url);
      }),
    );
    const row = await Promise.race([
      ended,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The Muse sign-in did not end.")), WAIT_MS);
      }),
    ]);
    result.state = row.state;
    result.message = row.message ?? null;
    item.check(row);
  } catch (error) {
    result.error = error instanceof Error ? error.message || String(error) : String(error);
  } finally {
    clearTimeout(timer);
    for (const client of await runCauseEffect(runtime.dispose())) await runCauseEffect(client.stop());
  }
}

try {
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(executable, FAKE_MUSE);
  await chmod(executable, 0o755);
  for (const item of CASES) await connect(item);
  report.passed = report.cases.length === CASES.length && report.cases.every((item) => item.error === undefined);
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
