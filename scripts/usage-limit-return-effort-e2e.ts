// Checks that an explicit reasoning-effort update also changes the effort saved for the automatic
// return from a usage-limit backup model. Runs the real agent service and stores on a temporary
// profile, then boots the store again to verify persistence:
// `bun scripts/usage-limit-return-effort-e2e.ts`.
// Writes .openbot-build/usage-limit-return-effort-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/usage-limit-return-effort-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-usage-limit-return-effort-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const report: {
  passed: boolean;
  before?: { currentEffort: string; returnModel: string; returnAccount: string; returnEffort: string };
  after?: { currentEffort: string; returnModel: string; returnAccount: string; returnEffort: string };
  restart?: { currentEffort: string; returnModel: string; returnAccount: string; returnEffort: string };
} = { passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
};

let database: OpenBotDatabase | null = null;
let service: AgentService | null = null;

try {
  database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  service = new AgentService({ store, mailbox, browser });

  const created = await runCauseEffect(
    store.createAgent({ name: "Quota return", description: "", avatarSeed: "quota-return", avatarHue: null }),
  );
  const seeded = await runCauseEffect(
    store.updateAgent({
      agentId: created.id,
      reasoningEffort: "high",
      usageLimitReturn: {
        provider: "codex",
        model: "gpt-6.1-sol",
        providerAccountId: "a0123456789abcdef",
        reasoningEffort: "xhigh",
      },
    }),
  );
  assert.ok(seeded.usageLimitReturn);
  report.before = {
    currentEffort: seeded.reasoningEffort,
    returnModel: seeded.usageLimitReturn.model,
    returnAccount: seeded.usageLimitReturn.providerAccountId ?? "",
    returnEffort: seeded.usageLimitReturn.reasoningEffort,
  };

  const updated = await runCauseEffect(service.updateAgent({ agentId: created.id, reasoningEffort: "max" }));
  assert.equal(updated.reasoningEffort, "max");
  assert.deepEqual(updated.usageLimitReturn, {
    provider: "codex",
    model: "gpt-6.1-sol",
    providerAccountId: "a0123456789abcdef",
    reasoningEffort: "max",
  });
  report.after = {
    currentEffort: updated.reasoningEffort,
    returnModel: updated.usageLimitReturn.model,
    returnAccount: updated.usageLimitReturn.providerAccountId ?? "",
    returnEffort: updated.usageLimitReturn.reasoningEffort,
  };

  await runCauseEffect(service.stop());
  service = null;
  database.close();
  database = null;

  const reopenedDatabase = new OpenBotDatabase(userData);
  database = reopenedDatabase;
  const reopenedStore = new AgentStore(userData, home, reopenedDatabase);
  await runCauseEffect(reopenedStore.initialize());
  const restarted = reopenedStore.list().find((agent) => agent.id === created.id);
  assert.ok(restarted?.usageLimitReturn);
  assert.equal(restarted.reasoningEffort, "max");
  assert.deepEqual(restarted.usageLimitReturn, {
    provider: "codex",
    model: "gpt-6.1-sol",
    providerAccountId: "a0123456789abcdef",
    reasoningEffort: "max",
  });
  report.restart = {
    currentEffort: restarted.reasoningEffort,
    returnModel: restarted.usageLimitReturn.model,
    returnAccount: restarted.usageLimitReturn.providerAccountId ?? "",
    returnEffort: restarted.usageLimitReturn.reasoningEffort,
  };
  report.passed = true;
} finally {
  if (service) await runCauseEffect(service.stop()).catch(() => undefined);
  database?.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
