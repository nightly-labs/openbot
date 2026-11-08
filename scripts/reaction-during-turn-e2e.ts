// Issue #3752. Start this worktree's dev app with the fake Codex, then run the check:
//   OPENBOT_CODEX_PATH="$PWD/scripts/provider-fakes/codex-slow-turn.mjs" bun run dev
//   bun scripts/reaction-during-turn-e2e.ts --allow-mutations
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import type { Locator } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "reaction-during-turn-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("reaction-during-turn-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const out = resolve(".openbot-build/reaction-during-turn-e2e");
const releaseHeldTurn = resolve(out, "release");
mkdirSync(out, { recursive: true });
rmSync(releaseHeldTurn, { force: true });

interface TargetResult {
  message: string;
  emoji: string;
  elementAtEmojiCentre: string;
  duringTurn: boolean;
  afterTurn: boolean;
}
const results: TargetResult[] = [];
let turnRanDuringReactions = false;
let error: string | undefined;
let agentId: string | undefined;
const page = session.page;

try {
  page.setDefaultTimeout(15_000);
  const name = `Reactions ${Date.now()}`;
  const agent = await page.evaluate(
    (agentName) =>
      window.openbot.agent.createAgent({
        name: agentName,
        description: "Checks reactions during a turn.",
        avatarSeed: "reactions",
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "codex",
        model: "fake-slow-turn",
      }),
    name,
  );
  agentId = agent.id;
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();
  const fromAgent = page.getByRole("article", { name: `Message from ${name}` });
  await fromAgent.filter({ hasText: "Reply to: Hello." }).waitFor();

  const composer = page.getByRole("textbox", { name: `Message ${name}` });
  const send = async (text: string) => {
    await composer.click();
    await composer.fill(text);
    await composer.press("Enter");
  };
  await send("First request.");
  const request = page.getByRole("article", { name: "Message from You" }).filter({ hasText: "First request." });
  const answer = fromAgent.filter({ hasText: "Reply to: First request." });
  await answer.waitFor();
  await send("Keep working.");
  const stop = page.getByRole("button", { name: "Stop agent" });
  await stop.waitFor();

  const dismissStarPrompt = page.getByRole("button", { name: "Not now" });
  const reactionOn = (target: Locator, emoji: string) =>
    target.getByRole("group", { name: /^Reactions:/ }).filter({ hasText: emoji });
  const shown = (target: Locator, emoji: string) =>
    reactionOn(target, emoji)
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

  for (const [label, target, emoji] of [
    ["request", request, "👍"],
    ["answer", answer, "❤️"],
  ] as const) {
    if (await dismissStarPrompt.isVisible()) await dismissStarPrompt.click();
    await target.hover();
    await target.getByRole("button", { name: "Add reaction" }).click();
    const item = page.getByRole("menuitemradio", { name: `React with ${emoji}` });
    await item.waitFor();
    await item.evaluate((element) =>
      Promise.all(
        (element.closest("[role=menu]") ?? element)
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
    const box = await item.boundingBox();
    assert.ok(box, `The ${emoji} item has no box.`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const elementAtEmojiCentre = await page.evaluate(
      (point) => {
        const top = document.elementFromPoint(point.x, point.y);
        if (!top) return "nothing";
        if (top.closest("[role=menuitemradio]")) return "the emoji";
        const row = top.closest(".virtual-chat-row")?.getAttribute("data-index");
        return `${top.tagName.toLowerCase()}.${top.classList[0] ?? ""}${row ? ` in chat row ${row}` : ""}`;
      },
      { x, y },
    );
    await page.mouse.click(x, y);
    const duringTurn = await shown(target, emoji);
    if (!duringTurn && (await item.isVisible())) await page.keyboard.press("Escape");
    results.push({ message: label, emoji, elementAtEmojiCentre, duringTurn, afterTurn: false });
  }
  turnRanDuringReactions = await stop.isVisible();
  await page.screenshot({ path: resolve(out, "during-turn.png") });

  writeFileSync(releaseHeldTurn, "");
  await stop.waitFor({ state: "hidden" });
  await fromAgent.filter({ hasText: "Working" }).waitFor();
  for (const [index, target] of [request, answer].entries()) {
    const result = results[index];
    if (result) result.afterTurn = await shown(target, result.emoji);
  }
  await page.screenshot({ path: resolve(out, "after-turn.png") });
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  writeFileSync(releaseHeldTurn, "");
  if (agentId) {
    const id = agentId;
    await page
      .getByRole("button", { name: "Stop agent" })
      .waitFor({ state: "hidden" })
      .catch(() => {});
    await page.evaluate((agent) => window.openbot.agent.deleteAgent(agent), id).catch(() => {});
  }
  const passed =
    !error &&
    turnRanDuringReactions &&
    results.length === 2 &&
    results.every((result) => result.elementAtEmojiCentre === "the emoji" && result.duringTurn && result.afterTurn);
  const report = { passed, turnRanDuringReactions, results, error };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(resolve(out, "report.json"), json);
  process.stdout.write(json);
  await session.close();
  if (!passed) process.exitCode = 1;
}
