import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { writeReport } from "./channel-e2e-support";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const NAME = "channel-history-loading-e2e";
const OUT = resolve(import.meta.dirname, "../.openbot-build", NAME);
const TIMEOUT_MS = 30_000;
const t = translateFor("en");
const instances = readDevInstanceRecords().filter(
  (record) => record.service === "test-client" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(
  instances.length,
  1,
  "Start OPENBOT_DEV_CLIENT_TRANSPORT=webrtc OPENBOT_DEV_RTT_MS=1200 bun run dev:test-client in this worktree.",
);
const [instance] = instances;
assert.ok(instance);
assertMutationAllowed({
  command: NAME,
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});

const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger(NAME), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const { page } = session;
const sidebar = page.getByRole("navigation", { name: t("sidebar.nav.label") });
const channel = sidebar.getByRole("button", { name: /^Launch room[,.]/ }).first();
const agent = sidebar.getByRole("button", { name: /^Research[,.]/ }).first();
const conversation = page.getByRole("main", { name: t("conversation.view.label") });
const loading = conversation.getByRole("status").filter({ hasText: t("conversation.direct.loading") });
const message = conversation.getByRole("article").filter({ hasText: "Add the rollback owner to the release note." });
const report = { firstOpenShowsLoading: false, backShowsCachedMessage: false, backShowsLoading: false, passed: false };

try {
  const remote = await page.evaluate(async () => {
    const server = (await window.openbot.servers.list()).find((entry) => entry.kind === "remote");
    if (!server) return false;
    if (!server.active) await window.openbot.servers.select(server.id);
    return true;
  });
  assert.ok(remote, "The test client must be on the joined dev server.");

  await page.evaluate(() => localStorage.removeItem("openbot:selected-channel:v1"));
  await page.reload();
  await agent.click({ timeout: TIMEOUT_MS });
  await conversation.getByRole("heading", { level: 1, name: /^Research / }).waitFor({ timeout: TIMEOUT_MS });
  await conversation.getByRole("article").first().waitFor({ timeout: TIMEOUT_MS });
  await channel.click({ timeout: TIMEOUT_MS });
  report.firstOpenShowsLoading = await loading.isVisible();
  mkdirSync(OUT, { recursive: true });
  await conversation.screenshot({ path: resolve(OUT, "first-open.png") });
  await message.waitFor({ timeout: TIMEOUT_MS });
  await loading.waitFor({ state: "hidden", timeout: TIMEOUT_MS });

  await agent.click();
  await message.waitFor({ state: "hidden", timeout: TIMEOUT_MS });
  await channel.click();
  report.backShowsCachedMessage = await message.isVisible();
  report.backShowsLoading = await loading.isVisible();
  await conversation.screenshot({ path: resolve(OUT, "switch-back.png") });
  await message.waitFor({ timeout: TIMEOUT_MS });

  assert.ok(report.firstOpenShowsLoading, "Show a loading status while the first channel page is pending.");
  assert.ok(report.backShowsCachedMessage, "Show channel history when switching back from an agent chat.");
  assert.ok(!report.backShowsLoading, "Keep the cached page on screen while the host refreshes it.");
  report.passed = true;
} finally {
  writeReport(NAME, report);
  await session.close();
}
