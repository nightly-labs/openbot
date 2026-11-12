// Uses this worktree's integrated dev app and a synthetic Codex process only.
// Prepare: node --import tsx scripts/codex-safety-stop-e2e.ts --prepare-ui
// Start bun run dev with OPENBOT_CODEX_PATH, OPENBOT_FAKE_CODEX_LOG and
// OPENBOT_FAKE_CODEX_CONTROL set to codex, protocol.jsonl and control.json in
// .openbot-build/codex-safety-ui. Then run this script with --allow-mutations.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const instance = readDevInstanceRecords().find(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.ok(instance, "Start this checkout's dev app with the synthetic Codex fixture.");
assertMutationAllowed({
  command: "codex-safety-recovery-ui-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("safety-recovery-ui"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
page.setDefaultTimeout(15000);
const out = resolve(".openbot-build/codex-safety-ui");
mkdirSync(out, { recursive: true });
const results: string[] = [];
let passed = false;
let failure: string | undefined;
type SyntheticFailure = { fail: boolean; ordinary?: boolean };
const control = (value: SyntheticFailure) => writeFileSync(resolve(out, "control.json"), JSON.stringify(value));
const turnCount = () =>
  readFileSync(resolve(out, "protocol.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.includes('"method":"turn/start"')).length;
try {
  const previousDialog = page.getByRole("alertdialog", { name: /^Start a new chat with Safety recovery/u });
  if (await previousDialog.count()) await previousDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(`window.openbot.setProviderOn({ provider: "codex", on: true })`);
  // Do not send a turn unless the fake runtime has answered in this app.
  assert.ok(existsSync(resolve(out, "protocol.jsonl")), "The dev app must use the synthetic Codex executable.");
  assert.ok(readFileSync(resolve(out, "protocol.jsonl"), "utf8").includes('"method":"initialize"'));
  await page.evaluate(`window.openbot.refreshAgentProviders()`);
  assert.equal(
    await page.evaluate(
      `window.openbot.agent.getStatus("local").then(status => status.providers?.find(provider => provider.id === "codex")?.version)`,
    ),
    "99.0.0",
    "Only the synthetic provider may run this check",
  );
  control({ fail: true, ordinary: true });
  const name = `Safety recovery ${Date.now()}`;
  const agentId = await page.evaluate<string>(
    `window.openbot.agent.createAgent(${JSON.stringify({ name, description: "Synthetic recovery check", avatarSeed: "safety", avatarHue: null, provider: "codex", model: "gpt-5.5", initialMessage: "Synthetic greeting." })}, "local").then(agent => agent.id)`,
  );
  const sidebar = page.getByRole("navigation", { name: "Chat list", exact: true });
  await sidebar.getByRole("button", { name: new RegExp(`^${name}[,.]`, "u") }).click();
  const editor = page.getByRole("textbox", { name: `Message ${name}`, exact: true });
  await editor.waitFor();
  const error = page.getByText(
    "This request was blocked by our safety systems. Reason: Potentially unintended activity.",
    { exact: true },
  );
  await error.waitFor();
  const banner = page.getByRole("alert").filter({ has: error });
  await page.screenshot({ animations: "disabled", path: resolve(out, "before.png") });
  assert.equal(
    await banner.getByRole("button", { name: "New chat", exact: true }).count(),
    0,
    "No recovery banner button for ordinary prose",
  );
  results.push("Identical prose without the structured safety-stop code has no recovery button.");
  control({ fail: true });
  await page.evaluate(
    `window.openbot.agent.sendMessage({ agentId: ${JSON.stringify(agentId)}, text: "Synthetic safety stop." }, "local")`,
  );
  const recovery = banner.getByRole("button", { name: "New chat", exact: true });
  await recovery.waitFor();
  await page.screenshot({ animations: "disabled", path: resolve(out, "after.png") });
  const beforeTurns = turnCount();
  await recovery.click();
  const dialog = page.getByRole("alertdialog", { name: `Start a new chat with ${name}?`, exact: true });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await recovery.waitFor();
  assert.equal(turnCount(), beforeTurns);
  results.push("Cancel keeps the safety banner and sends no provider turn.");
  await editor.fill("/new");
  await editor.press("Enter");
  await dialog.waitFor();
  await page.screenshot({ animations: "disabled", path: resolve(out, "confirmation.png") });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await editor.innerText()).trim(), "/new");
  assert.equal(turnCount(), beforeTurns);
  results.push("/new opens the existing confirmation; Cancel keeps the command.");
  await editor.press("Enter");
  await dialog.getByRole("button", { name: "Start new chat", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await error.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelector('[role="textbox"][aria-multiline="true"]')?.textContent?.trim() === "",
  );
  assert.equal(turnCount(), beforeTurns, "The reset itself must not submit or replay a provider turn.");
  results.push("Confirmed /new clears the old banner and command without submitting a turn.");
  await page.screenshot({ animations: "disabled", path: resolve(out, "recovered.png") });
  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ passed, results, failure }, null, 2));
  process.stdout.write(`${JSON.stringify({ passed, results, failure }, null, 2)}\n`);
  await session.close();
}
