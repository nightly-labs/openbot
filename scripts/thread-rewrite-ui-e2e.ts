// Drives real desktop Edit/Cancel/Resend actions with a live Codex provider on this worktree's dev profile.
// Run: bun scripts/thread-rewrite-ui-e2e.ts --allow-mutations
// After stopping and starting the dev stack, run again with --verify-restart --allow-mutations.
// Keeps its generated agent for review. Reports and screenshots stay under .openbot-build/.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import type { Page } from "playwright-core";
import { connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "thread-rewrite-ui-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
mkdirSync(OUT, { recursive: true });
const t = translateFor("zh");
interface Report {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  taskId: string | null;
  mainText: string;
  taskText: string;
  removedMessageIds: string[];
  checks: string[];
  screenshots: string[];
  passed: boolean;
  restarted?: boolean;
  error?: string;
}
const verifyRestart = process.argv.includes("--verify-restart");
const report: Report =
  verifyRestart || process.argv.includes("--resume")
    ? JSON.parse(readFileSync(resolve(OUT, "report.json"), "utf8"))
    : {
        agentId: "",
        agentName: `Rewrite QA ${Date.now()}`,
        provider: "codex",
        model: "",
        taskId: null,
        mainText: "Reply with exactly REWRITTEN_MAIN. Do not use tools.",
        taskText: "Reply with exactly REWRITTEN_SIDE. Do not use tools.",
        removedMessageIds: [],
        checks: [],
        screenshots: [],
        passed: false,
      };
let session: Awaited<ReturnType<typeof connectChannelE2e>> | undefined;
let page: Page;
async function shot(name: string) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  report.screenshots.push(path);
}
const read = (taskId: string | null): Promise<ConversationSnapshot> =>
  page.evaluate(
    ({ agentId, taskId }) =>
      taskId ? window.openbot.agent.readTask({ agentId, taskId }) : window.openbot.agent.readConversation(agentId),
    { agentId: report.agentId, taskId },
  );
async function idle(taskId: string | null) {
  if (taskId) {
    await waitFor(
      page,
      "side thread is idle",
      () => page.evaluate((agentId) => window.openbot.agent.listTasks(agentId), report.agentId),
      (snapshot) => snapshot.tasks.some((task) => task.id === taskId && task.state === "idle"),
    );
  } else {
    await waitFor(
      page,
      "main thread is idle",
      () => page.evaluate((agentId) => window.openbot.agent.listQueue(agentId), report.agentId),
      (snapshot) =>
        !snapshot.deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
    );
  }
  const snapshot = await read(taskId);
  assert.ok(
    snapshot.messages.some((message) => message.author === "assistant" && message.status === "completed"),
    "A provider answer completed",
  );
  assert.ok(!snapshot.messages.some((message) => message.status === "failed"), "The provider turn did not fail");
  return snapshot;
}
async function send(text: string, taskId: string | null = null) {
  await page.evaluate(
    ({ agentId, taskId, text }) => window.openbot.agent.sendMessage({ agentId, ...(taskId ? { taskId } : {}), text }),
    { agentId: report.agentId, taskId, text },
  );
  return idle(taskId);
}
async function openAgent() {
  await page
    .getByRole("navigation", { name: t("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${report.agentName}[,.]`) })
    .click();
}
async function rewrite(taskId: string | null, sourceText: string, replacement: string, prefix: string) {
  const before = await read(taskId);
  const sourceIndex = before.messages.findIndex((message) => message.author === "user" && message.text === sourceText);
  assert.ok(sourceIndex >= 0);
  const removed = before.messages.slice(sourceIndex).map((message) => message.id);
  const article = page.getByRole("article").filter({ hasText: sourceText });
  await article.getByRole("button", { name: t("chat.actions.edit"), exact: true }).focus();
  await article.getByRole("button", { name: t("chat.actions.edit"), exact: true }).press("Enter", { timeout: 15_000 });
  const draft = page.getByRole("textbox", { name: t("chat.rewrite.draft") });
  await draft.waitFor({ timeout: 15_000 });
  assert.equal(await draft.inputValue(), sourceText);
  assert.equal(
    await article.getByText(sourceText, { exact: true }).count(),
    0,
    "Edit replaces the original text rather than duplicating it",
  );
  await shot(`${prefix}-draft`);
  await draft.fill("Unsent draft that must not alter history");
  await page.getByRole("button", { name: t("common.cancel"), exact: true }).click();
  assert.deepEqual(await read(taskId), before, "Cancel must leave the thread unchanged");
  report.checks.push(`${prefix}: Edit prefills text; Cancel leaves the entire conversation unchanged`);
  await shot(`${prefix}-before`);
  await article.getByRole("button", { name: t("chat.actions.edit"), exact: true }).focus();
  await article.getByRole("button", { name: t("chat.actions.edit"), exact: true }).press("Enter", { timeout: 15_000 });
  await draft.fill(replacement);
  await page.getByRole("button", { name: t("chat.rewrite.send"), exact: true }).click();
  await draft.waitFor({ state: "hidden" });
  const after = await idle(taskId);
  assert.equal(after.threadId, before.threadId);
  assert.deepEqual(
    after.messages.slice(0, sourceIndex).map((message) => message.id),
    before.messages.slice(0, sourceIndex).map((message) => message.id),
  );
  assert.ok(after.messages.some((message) => message.author === "user" && message.text === replacement));
  assert.ok(!after.messages.some((message) => removed.includes(message.id)));
  report.removedMessageIds.push(...removed);
  report.checks.push(`${prefix}: Resend replaces the source and all later messages in the same thread; prefix remains`);
  await shot(`${prefix}-after`);
}
try {
  report.passed = false;
  session = await connectChannelE2e(NAME);
  page = session.page;
  await page.bringToFront();
  await page.keyboard.press("Escape");
  if (verifyRestart) {
    const main = await send("Reply with exactly RESTARTED_MAIN. Do not use tools.");
    assert.ok(main.messages.some((message) => message.text === report.mainText));
    assert.ok(!main.messages.some((message) => report.removedMessageIds.includes(message.id)));
    assert.ok(report.taskId);
    const side = await send("Reply with exactly RESTARTED_SIDE. Do not use tools.", report.taskId);
    assert.ok(side.messages.some((message) => message.text === report.taskText));
    assert.ok(!side.messages.some((message) => report.removedMessageIds.includes(message.id)));
    await openAgent();
    await shot("after-full-app-restart");
    report.restarted = true;
    report.checks.push(
      "Complete desktop stack/provider restart: edited main and side history persists; removed suffixes do not return",
    );
  } else {
    if (!report.agentId) {
      const models = await page.evaluate(() => window.openbot.agent.listModels());
      const codex = models.filter((model) => model.provider === "codex");
      const model =
        codex.find((model) => model.id.includes("luna")) ?? codex.find((model) => !model.id.includes("pro"));
      assert.ok(model, "A signed-in live Codex model is required");
      report.model = model.id;
      const agent = await page.evaluate(
        ({ name, model }) =>
          window.openbot.agent.createAgent({
            name,
            description: "Disposable history edit verification",
            avatarSeed: "rewind-qa",
            avatarHue: null,
            initialMessage: "Reply with exactly KEPT_PREFIX. Do not use tools.",
            provider: "codex",
            model,
            reasoningEffort: "low",
          }),
        { name: report.agentName, model: report.model },
      );
      report.agentId = agent.id;
      await idle(null);
      const oldMain = "Reply with exactly OLD_MAIN. Do not use tools.";
      await send(oldMain);
      await send("Reply with exactly REMOVED_SUFFIX. Do not use tools.");
    }
    await openAgent();
    const oldMain = "Reply with exactly OLD_MAIN. Do not use tools.";
    if ((await read(null)).messages.some((message) => message.text === oldMain))
      await rewrite(null, oldMain, report.mainText, "main");
    const oldSide = "Reply with exactly OLD_SIDE. Do not use tools.";
    if (!report.taskId) {
      const task = await page.evaluate(({ agentId, text }) => window.openbot.agent.startTask({ agentId, text }), {
        agentId: report.agentId,
        text: oldSide,
      });
      report.taskId = task.id;
      await idle(task.id);
      await send("Reply with exactly REMOVED_SIDE_SUFFIX. Do not use tools.", task.id);
    }
    const taskId = report.taskId;
    assert.ok(taskId);
    await page.getByRole("button", { name: t("conversation.threads.all"), exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${oldSide}`) }).click();
    if ((await read(taskId)).messages.some((message) => message.text === oldSide))
      await rewrite(taskId, oldSide, report.taskText, "side");
  }
  report.passed = true;
  report.screenshots = [...new Set(report.screenshots.filter((path) => !path.endsWith("/failure.png")))];
  delete report.error;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (session) await shot("failure").catch(() => {});
  throw error;
} finally {
  writeReport(NAME, report);
  await session?.close();
}
