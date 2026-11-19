import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const renderedText = process.argv.find((value) => value.startsWith("--rendered-text="))?.slice(16);
const filename = process.argv.find((value) => value.startsWith("--file="))?.slice(7);
assert.ok(renderedText && filename, "Pass --rendered-text=<script output> and --file=<filename>.");
const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "file-preview-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("file-preview-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const out = resolve(".openbot-build/file-preview-e2e");
mkdirSync(out, { recursive: true });
const results: string[] = [];
try {
  const page = session.page;
  page.setDefaultTimeout(10_000);
  const open = () => page.getByRole("button", { name: `Open workspace file ${filename}`, exact: true }).click();
  const panel = page.getByRole("complementary", { name: "File preview", exact: true });
  const frameElement = panel.locator("iframe");
  await open();
  await frameElement.waitFor();
  const address = await frameElement.getAttribute("src");
  assert.ok(address?.startsWith("openbot-visual://preview/"));
  const frame = frameElement.contentFrame();
  await frame.getByText(renderedText, { exact: true }).waitFor();
  const isolation = await frame.locator("body").evaluate(() => ({
    origin: globalThis.origin,
    bridge: typeof window.openbot,
    node: typeof require,
  }));
  assert.deepEqual(isolation, { origin: "null", bridge: "undefined", node: "undefined" });
  results.push("Local HTML opens with an opaque origin and no app or Node bridge.");
  await panel.getByRole("button", { name: "Show HTML source", exact: true }).click();
  await frameElement.waitFor({ state: "detached" });
  assert.ok((await panel.innerText()).includes("<script>"));
  await panel.getByRole("button", { name: "Show HTML source", exact: true }).click();
  await frameElement.waitFor();
  assert.equal(await frameElement.getAttribute("src"), address);
  await frameElement.contentFrame().locator("body").waitFor();
  results.push("Source toggles preserve the live page address.");
  const agentName = await page
    .getByRole("main", { name: "Conversation" })
    .getByRole("heading", { level: 1 })
    .innerText();
  const chats = page.getByRole("navigation", { name: "Chat list" });
  await chats.getByRole("button").filter({ hasNotText: agentName }).first().click();
  await panel.waitFor({ state: "detached" });
  await chats.getByRole("button").filter({ hasText: agentName }).click();
  await page
    .getByRole("main", { name: "Conversation" })
    .getByRole("heading", { level: 1, name: agentName, exact: true })
    .waitFor();
  assert.equal(await panel.count(), 0);
  await open();
  await frameElement.waitFor();
  const reopenedAddress = await frameElement.getAttribute("src");
  assert.notEqual(reopenedAddress, address);
  await frameElement.contentFrame().getByText(renderedText, { exact: true }).waitFor();
  results.push("Switching conversations clears preview state and reopening renders a fresh page.");
  await panel.getByRole("button", { name: "Close file preview", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  await open();
  await frameElement.waitFor();
  assert.notEqual(await frameElement.getAttribute("src"), reopenedAddress);
  await panel.getByRole("heading", { name: filename, exact: true }).waitFor();
  await frameElement.contentFrame().locator("body").waitFor();
  results.push("Closing and reopening obtains a fresh page address.");
  await panel.screenshot({ path: resolve(out, "preview.png") });
  await panel.getByRole("button", { name: "Close file preview", exact: true }).click();
} finally {
  writeFileSync(resolve(out, "report.json"), `${JSON.stringify({ results, passed: results.length === 4 }, null, 2)}\n`);
  await session.close();
}
