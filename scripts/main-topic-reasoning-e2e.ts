// Drives this worktree's running dev app through a real provider turn, and checks that the
// reasoning steps of a finished turn are viewable in the agent's own chat the way they are in a
// side thread (#8747). The agent's model must write reasoning summaries, such as an OpenCode free
// reasoning model; a model that sends none reports `thinking: false` and skips the reasoning
// checks. The check prompts ask for no tool calls, so the turn's spans stay thinking and answer.
// `bun scripts/main-topic-reasoning-e2e.ts --allow-mutations --agent=<agent id>`.
//
// It sends one short prompt in the agent's own chat and one in a new side thread, then checks in
// the real UI that:
// - the steps row of the main topic's answer stands above the answer, not inside the action row;
// - the row opens the trace, and picking a step span there opens the steps list with the reasoning
//   text, which the trace-only row that #5464 gave the main topic could never do;
// - the side thread's row opens the steps list on its own click;
// - the main topic list still opens after a reload, from the stored commentary messages.
// It closes the side thread tab it started.
// Writes .openbot-build/main-topic-reasoning-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConversationPage } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, waitFor } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/main-topic-reasoning-e2e");
mkdirSync(OUT, { recursive: true });
const agentId = argument("agent");
assert.ok(agentId, "Pass --agent=<agent id> of an agent whose provider runs turns.");

// The prompt of both phases: the composer may keep or trim its text, so both compare trimmed.
const PROMPT_TEXT =
  "Think carefully step by step for a few sentences about whether 29 is prime, explaining your " +
  "reasoning out loud. Then reply with only the word ready. Do not use tools.";
const PROMPT = PROMPT_TEXT;

interface Report {
  agentId: string;
  mainTopic?: {
    stepsAboveAnswer: boolean;
    traceOpens: boolean;
    pickOpensList: boolean;
    reasoningText: string;
    listOpensAfterReload: boolean;
  };
  sideThread?: { rowOpensList: boolean; reasoningText: string; tabClosed: boolean };
  thinking: boolean;
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { agentId: agentId, thinking: false, pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("main-topic-reasoning-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

interface TurnState {
  active: string | null;
  answered: boolean;
  failed: boolean;
  commentary: number;
}

/** The newest turn whose user message is this script's prompt: the phase before it has ended, so
 * the newest one is this send's, whichever path took the message. */
function readTurn(id: string): Promise<TurnState & { turnId: string | null }> {
  return page.evaluate(
    async ({ id, prompt }) => {
      const conversationPage: ConversationPage = await window.openbot.agent.readConversationPage({
        agentId: id,
        anchor: { type: "latest" },
        limit: 30,
      });
      const mine = (conversationPage.messages ?? []).filter(
        (message) => message.author === "user" && (message.text ?? "").trim() === prompt,
      );
      const turnId = mine.at(-1)?.turnId ?? null;
      const turn = (conversationPage.messages ?? []).filter((message) => message.turnId === turnId);
      return {
        turnId,
        active: conversationPage.activeTurnId,
        answered: turn.some((message) => message.author === "assistant" && message.itemType !== "commentary"),
        failed: turn.some((message) => message.status === "failed"),
        commentary: turn.filter((message) => message.itemType === "commentary").length,
      };
    },
    { id, prompt: PROMPT_TEXT },
  );
}

/** Sends the prompt in the agent's own chat, or in a new side thread, and waits for its turn. */
async function runTurn(id: string, where: "main" | "thread"): Promise<{ turnId: string; state: TurnState }> {
  if (where === "thread") {
    await page
      .getByRole("button", { name: /新话题|新会话|New thread/ })
      .first()
      .waitFor({ timeout: 15_000 });
    await page
      .getByRole("button", { name: /新话题|新会话|New thread/ })
      .first()
      .click();
    await page.waitForTimeout(700);
    // The draft thread's own box, named for the new thread, not the agent's own chat box. The
    // editor reads real key events, so the prompt types instead of a value set.
    const composer = page.getByRole("textbox", { name: /新话题|New thread/ }).first();
    await composer.click();
    await page.keyboard.type(PROMPT, { delay: 2 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
  } else {
    await page.evaluate(
      async ({ id, text }) => {
        const agents = await window.openbot.agent.listAgents();
        if (!agents.some((candidate) => candidate.id === id)) return null;
        return window.openbot.agent.sendMessage({ agentId: id, text, clientMessageId: crypto.randomUUID() });
      },
      { id, text: PROMPT },
    );
  }
  const state = await waitFor(
    page,
    `the ${where} turn to end`,
    () => readTurn(id),
    (current) => current.turnId !== null && current.active === null && (current.answered || current.failed),
    180_000,
  );
  assert.ok(!state.failed, `The ${where} turn failed.`);
  report.thinking = report.thinking || state.commentary > 0;
  return { turnId: state.turnId ?? "", state };
}

/** Waits until the newest turn's steps row is on the page: the API can end a turn before the view
 * has drawn its steps row. */
async function waitForStepsRow(where: "main" | "thread"): Promise<boolean> {
  return waitFor(
    page,
    `the ${where} steps row to render`,
    () =>
      page.evaluate((scope) => {
        const all = [...document.querySelectorAll(".agent-steps")];
        const rows =
          scope === "thread"
            ? all.filter((row) => row.closest(".agent-thread-scroll"))
            : all.filter((row) => !row.closest(".agent-thread-scroll"));
        return rows.length > 0;
      }, where),
    (found) => found,
    15_000,
  ).then(
    () => true,
    () => false,
  );
}

/** The rows of one surface: the agent's own chat leaves out an open side thread's panel, whose
 * rows the thread scope reads alone. */
function scopedRows(scope: "main" | "thread") {
  return page.evaluate((where) => {
    const all = [...document.querySelectorAll(".agent-steps")];
    return all
      .filter((row) =>
        where === "thread" ? Boolean(row.closest(".agent-thread-scroll")) : !row.closest(".agent-thread-scroll"),
      )
      .map((row) => ({
        open: row.hasAttribute("data-open"),
        summary: row.querySelector(".agent-steps-summary")?.textContent ?? "",
      }));
  }, scope);
}

/** Closes the newest steps row of the scope when it is open, so the next click does what a closed
 * row does: open the trace in the agent's own chat, or open the list in a side thread. */
async function ensureRowClosed(where: "main" | "thread"): Promise<void> {
  const rows = await scopedRows(where);
  if (rows.at(-1)?.open) {
    await page.evaluate((scope) => {
      const all = [...document.querySelectorAll(".agent-steps")];
      const rows =
        scope === "thread"
          ? all.filter((row) => row.closest(".agent-thread-scroll"))
          : all.filter((row) => !row.closest(".agent-thread-scroll"));
      rows
        .at(-1)
        ?.querySelector(".agent-steps-header")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, where);
    await page.waitForTimeout(500);
  }
}

/** Clicks the steps row of the newest turn in the given scope. */
async function clickStepsRow(where: "main" | "thread"): Promise<boolean> {
  return page.evaluate((scope) => {
    const all = [...document.querySelectorAll(".agent-steps")];
    const rows =
      scope === "thread"
        ? all.filter((row) => row.closest(".agent-thread-scroll"))
        : all.filter((row) => !row.closest(".agent-thread-scroll"));
    const target = rows.at(-1);
    if (!target) return false;
    target
      .querySelector(".agent-steps-header")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, where);
}

/** Scrolls the agent's own chat, and any open side thread, to their latest message, so the newest
 * turn's rows are on the page. */
async function scrollToBottom(): Promise<void> {
  await page.evaluate(() => {
    for (const scroller of document.querySelectorAll(".conversation-scroll, .agent-thread-scroll")) {
      if (scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = scroller.scrollHeight;
    }
  });
  await page.waitForTimeout(400);
}

/** In an open trace dialog, picks the first step span: the thinking span of a no-tool turn. */
async function pickStepSpan(): Promise<boolean> {
  return page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    if (!dialog) return false;
    const spans = [...dialog.querySelectorAll("button.trace-name-button")];
    const target = spans.at(1) ?? spans.at(0);
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return Boolean(target);
  });
}

const listState = (scope: "main" | "thread") =>
  page.evaluate((where) => {
    const all = [...document.querySelectorAll(".agent-steps")];
    const rows =
      where === "thread"
        ? all.filter((row) => row.closest(".agent-thread-scroll"))
        : all.filter((row) => !row.closest(".agent-thread-scroll"));
    return {
      dialog: Boolean(document.querySelector("[role='dialog']")),
      panel: rows.some((row) => row.querySelector(".agent-steps-panel")),
      thinking: rows
        .flatMap((row) => [...row.querySelectorAll(".agent-step[data-kind='thinking']")])
        .map((step) => (step.textContent ?? "").replace(/\s+/g, " ").trim()),
    };
  }, scope);

// Open the agent's own chat. The agent button in the navigation starts with the agent's name.
// A dialog that an earlier session left open would block the navigation, so it closes first.
await page.keyboard.press("Escape");
const agents = await page.evaluate(() => window.openbot.agent.listAgents());
const agent = agents.find((candidate) => candidate.id === agentId);
assert.ok(agent, `Unknown agent ${agentId}`);
await page
  .getByRole("navigation")
  .getByRole("button", { name: new RegExp(`^${agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
  .first()
  .click();
await page.waitForTimeout(800);
// The own chat checks read only the main conversation, so this run starts with no open thread tab.
// A right-click menu that does not open leaves the tab in place: the row scopes keep it harmless.
while ((await page.getByRole("tab").count()) > 0) {
  await page.getByRole("tab").last().click({ button: "right" });
  const closed = await page
    .getByRole("menuitem", { name: /关闭标签页|Close tab/ })
    .first()
    .click({ timeout: 2_000 })
    .then(
      () => true,
      () => false,
    );
  await page.waitForTimeout(500);
  if (!closed) break;
}
// The checks below need the app's default: the steps lists start closed, and each click's effect
// (trace, then list) reads from a known state.
await page.evaluate(() => window.localStorage.setItem("openbot:show-agent-steps", "false"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2_000);

// The main topic: the turn's steps row stands above the answer, the row opens the trace, and a
// step pick opens the list with the reasoning text.
const mainTurn = await runTurn(agentId, "main");
void mainTurn.turnId;
await scrollToBottom();
assert.ok(await waitForStepsRow("main"), "The main topic shows no steps row after the turn.");
const mainRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".agent-steps")].filter((row) => !row.closest(".agent-thread-scroll"));
  const target = rows.at(-1);
  return target
    ? {
        inActionRow: Boolean(target.closest(".message-action-row")),
        summary: target.querySelector(".agent-steps-summary")?.textContent ?? "",
      }
    : null;
});
assert.ok(mainRow, "The main topic shows no steps row after the turn.");
report.mainTopic = {
  stepsAboveAnswer: !mainRow.inActionRow,
  traceOpens: false,
  pickOpensList: false,
  reasoningText: "",
  listOpensAfterReload: false,
};
await shot("main-topic-after-turn");

await ensureRowClosed("main");
assert.ok(await clickStepsRow("main"), "No steps row to click in the main topic.");
await page.waitForTimeout(900);
report.mainTopic.traceOpens = await page.evaluate(() => Boolean(document.querySelector("[role='dialog']")));
assert.ok(report.mainTopic.traceOpens, "The main topic steps row did not open the trace.");
await shot("main-topic-trace");
assert.ok(await pickStepSpan(), "The trace holds no step span to pick.");
await page.waitForTimeout(1_100);
const picked = await listState("main");
report.mainTopic.pickOpensList = !picked.dialog && picked.panel;
report.mainTopic.reasoningText = picked.thinking.at(-1) ?? "";
if (report.thinking) {
  assert.ok(report.mainTopic.pickOpensList, "The trace pick did not open the reasoning list.");
  assert.ok(report.mainTopic.reasoningText.length > 0, "The opened list shows no reasoning text.");
}
await shot("main-topic-list");

// A reload reads the stored commentary again, and the same flow opens the list.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2_500);
await ensureRowClosed("main");
assert.ok(await clickStepsRow("main"), "No steps row after the reload.");
await page.waitForTimeout(900);
assert.ok(await pickStepSpan(), "The trace after the reload holds no step span.");
await page.waitForTimeout(1_100);
const reloaded = await listState("main");
report.mainTopic.listOpensAfterReload = reloaded.panel && reloaded.thinking.length > 0;
await shot("main-topic-after-reload");

// A side thread keeps its own row that opens the list on one click.
await runTurn(agentId, "thread");
await scrollToBottom();
assert.ok(await waitForStepsRow("thread"), "The side thread shows no steps row.");
await page.waitForTimeout(500);
await ensureRowClosed("thread");
assert.ok(await clickStepsRow("thread"), "The side thread shows no steps row to click.");
await page.waitForTimeout(1_000);
const side = await listState("thread");
report.sideThread = {
  rowOpensList: side.panel && (!report.thinking || side.thinking.length > 0),
  reasoningText: side.thinking.at(-1) ?? "",
  tabClosed: false,
};
if (report.thinking) {
  assert.ok(report.sideThread.rowOpensList, "The side thread row did not open the list on one click.");
  assert.ok(report.sideThread.reasoningText.length > 0, "The side thread list shows no reasoning text.");
}
await shot("side-thread-list");

// Close the tab of the side thread that this script started.
const tab = page.getByRole("tab").last();
if ((await tab.count()) > 0) {
  await tab.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: /关闭标签页|Close tab/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  report.sideThread.tabClosed = (await page.getByRole("tab").count()) === 0;
}

assert.ok(report.pageErrors.length === 0, `The page reported errors: ${report.pageErrors.join("; ")}`);
report.passed = true;
const reportPath = resolve(OUT, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`PASS main-topic-reasoning-e2e: ${reportPath}\n`);
await session.close();
