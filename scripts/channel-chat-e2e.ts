// Checks the channel chat of the desktop app through its UI, in this worktree's running dev app with
// real provider turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-chat-e2e.ts --allow-mutations`. It needs two visible agents whose provider is
// signed in.
//
// It creates a channel from the "+" menu, and opens it from the sidebar, global search and the
// schedule. It checks that the channel has one conversation panel and no model picker, that a sent
// message shows at once and the agent's reply follows, that the activity row shows and Stop ends the
// work, and that a deleted channel shows the preview notice and is in "Deleted channels" until a
// restore. It makes its own channel and deletes it at the end.
// Writes .openbot-build/channel-chat-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { CreateChannelRoutineInput } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import type { Locator } from "playwright-core";
import {
  ChannelClient,
  connectChannelE2e,
  LONG_PROMPT,
  SHORT_PROMPT,
  waitFor,
  writeReport,
} from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-chat-e2e");
const UI_WAIT_MS = 15_000;
const english = translateFor("en");

interface Report {
  channelId?: string;
  created?: { fromMenu: boolean; members: number };
  opened?: { sidebar: boolean; search: boolean; schedule: boolean };
  layout?: { conversationPanels: number; modelPickers: number };
  send?: { ownRowShown: boolean; agentReplied: boolean; ownBeforeAgent: boolean };
  stop?: { activityShown: boolean; taskState: string };
  archive?: { notice: boolean; sidePanels: number; inDeletedChannels: boolean; composerAfterRestore: boolean };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("channel-chat-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(page);
const name = `E2E chat ${crypto.randomUUID().slice(0, 4)}`;
let routineId: string | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const conversation = () => page.getByRole("main", { name: english("conversation.view.label") });
const header = () => conversation().getByRole("heading", { level: 1, name, exact: true });
const sidebarRow = () =>
  page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first();
const composer = () => page.getByRole("textbox", { name: english("channel.composer.label") });

async function shot(label: string, target: Locator = page.locator("body")): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await target.screenshot({ path });
  report.screenshots.push(path);
}

/** Writes a message that starts with a mention picked from the composer's menu, and sends it. */
async function sendTo(agentName: string, text: string): Promise<void> {
  await composer().click();
  await composer().pressSequentially(`@${agentName.slice(0, 3)}`);
  await page
    .getByRole("listbox", { name: english("composer.picker.mentionLabel") })
    .getByRole("option", { name: english("composer.picker.option.agent", { name: agentName }), exact: true })
    .click();
  await page.keyboard.insertText(` ${text}`);
  await conversation()
    .getByRole("button", { name: english("composer.send.message"), exact: true })
    .click();
}

/** Opens another agent's chat, so the next step opens the channel again. */
async function leaveChannel(agentName: string): Promise<void> {
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agentName)},`) })
    .first()
    .click();
  await header().waitFor({ state: "detached", timeout: UI_WAIT_MS });
}

try {
  const agents = await client.agents();
  assert.ok(agents.length >= 2, "This check needs two visible agents.");
  const [a, b] = agents;
  assert.ok(a && b);
  await leaveChannel(a.name).catch(() => undefined);

  // 1. The "+" menu has New channel, and the dialog creates the channel.
  await page.getByRole("button", { name: english("sidebar.new.menuWithChannel"), exact: true }).click();
  await page.getByRole("menuitem", { name: english("sidebar.new.channel"), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: english("sidebar.new.channel") });
  await dialog.waitFor({ timeout: UI_WAIT_MS });
  await dialog.getByRole("textbox", { name: english("channel.form.name") }).fill(name);
  for (const agent of [a, b]) await dialog.locator(`[id="channel-member-${agent.id}"]`).check();
  await shot("create-dialog", dialog);
  await dialog.getByRole("button", { name: english("common.create"), exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const created = await waitFor(
    page,
    "the channel is in the list",
    () => client.list(),
    (list) => list.some((channel) => channel.name === name),
  );
  const channel = created.find((candidate) => candidate.name === name);
  assert.ok(channel);
  client.created.push(channel.id);
  report.channelId = channel.id;
  report.created = { fromMenu: true, members: channel.members.length };
  assert.equal(channel.members.length, 2);

  // 2. One conversation panel, and no model picker.
  await header().waitFor({ timeout: UI_WAIT_MS });
  report.layout = {
    conversationPanels: await page.getByRole("main", { name: english("conversation.view.label") }).count(),
    modelPickers: await page.getByRole("button", { name: /^Agent model:/ }).count(),
  };
  assert.equal(report.layout.conversationPanels, 1, "The channel shows more than one conversation panel.");
  assert.equal(report.layout.modelPickers, 0, "The channel shows a model picker.");

  // 3. The sidebar, global search and the schedule open the channel.
  const opened = { sidebar: false, search: false, schedule: false };
  report.opened = opened;
  await leaveChannel(a.name);
  await sidebarRow().click();
  await header().waitFor({ timeout: UI_WAIT_MS });
  opened.sidebar = true;

  await leaveChannel(a.name);
  await page.getByRole("button", { name: english("conversation.globalSearch.title"), exact: true }).click();
  await page.getByRole("combobox", { name: english("conversation.globalSearch.title") }).fill(name);
  await page
    .getByRole("option", { name: new RegExp(literal(name)) })
    .first()
    .click();
  await header().waitFor({ timeout: UI_WAIT_MS });
  opened.search = true;

  const routineInput: CreateChannelRoutineInput = {
    channelId: channel.id,
    name: `${name} brief`,
    instruction: SHORT_PROMPT,
    active: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    schedule: { kind: "hourly", minute: (new Date().getMinutes() + 30) % 60 },
  };
  const routine = await page.evaluate((input) => window.openbot.agent.createChannelRoutine(input), routineInput);
  routineId = routine.id;
  await page.getByRole("button", { name: english("app.rail.schedule"), exact: true }).click();
  await page
    .getByRole("button", { name: english("routine.card.open", { name: routine.name }), exact: true })
    .first()
    .click();
  await header().waitFor({ timeout: UI_WAIT_MS });
  await page.getByLabel(english("channel.panel.label")).first().waitFor({ timeout: UI_WAIT_MS });
  opened.schedule = true;

  // 4. A sent message shows at once; the agent's reply follows it.
  await sendTo(a.name, SHORT_PROMPT);
  const own = conversation()
    .getByRole("article", { name: english("chat.row.label", { name: "You" }) })
    .filter({ hasText: SHORT_PROMPT });
  await own.first().waitFor({ timeout: 5_000 });
  const reply = conversation().getByRole("article", { name: english("chat.row.label", { name: a.name }) });
  await reply.first().waitFor({ timeout: 180_000 });
  const order = await conversation()
    .getByRole("article")
    .evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label") ?? ""));
  const ownLabel = english("chat.row.label", { name: "You" });
  const ownIndex = order.findLastIndex((label) => label.startsWith(ownLabel));
  const replyIndex = order.findLastIndex((label) => label.startsWith(english("chat.row.label", { name: a.name })));
  report.send = { ownRowShown: true, agentReplied: true, ownBeforeAgent: ownIndex >= 0 && ownIndex < replyIndex };
  assert.ok(report.send.ownBeforeAgent, "The agent's reply does not follow the sent message.");
  await shot("conversation", conversation());

  // 5. The activity row shows while work runs, and Stop ends it.
  const before = (await client.read(channel.id)).tasks.length;
  await sendTo(b.name, LONG_PROMPT);
  const activity = conversation().getByRole("status", { name: /is working/ });
  await activity.first().waitFor({ timeout: 60_000 });
  await shot("activity", conversation());
  await conversation()
    .getByRole("button", { name: english("composer.send.stop"), exact: true })
    .click();
  const stopped = await waitFor(
    page,
    "Stop ends the channel task",
    () => client.read(channel.id),
    (current) => {
      const state = current.tasks.slice(before).at(-1)?.state;
      return state === "cancelled" || state === "paused" || state === "completed" || state === "failed";
    },
  );
  await activity.first().waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.stop = { activityShown: true, taskState: stopped.tasks.slice(before).at(-1)?.state ?? "missing" };
  // Stop pauses a task that no agent took yet, and cancels one that an agent runs.
  assert.ok(["cancelled", "paused"].includes(report.stop.taskState), "Stop did not end the channel task.");

  // 6. Delete shows the preview notice and lists the channel in Deleted channels; restore ends it.
  await sidebarRow().click({ button: "right" });
  await page.getByRole("menuitem", { name: english("sidebar.channelMenu.delete"), exact: true }).click();
  await page.getByRole("button", { name: english("common.delete"), exact: true }).click();
  await waitFor(
    page,
    "the channel is deleted",
    () => client.summary(channel.id),
    (summary) => summary.archived === true,
  );
  await page.getByLabel(english("sidebar.nav.freeArea"), { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: english("sidebar.deletedChannels.title"), exact: true }).click();
  const deleted = page.getByRole("region", { name: english("sidebar.deletedChannels.title") });
  const deletedRow = deleted.getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) });
  await deletedRow.waitFor({ timeout: UI_WAIT_MS });
  await deletedRow.click();
  const notice = conversation().getByText(english("channel.conversation.archivedNotice"), { exact: true });
  await notice.waitFor({ timeout: UI_WAIT_MS });
  // A deleted channel takes no edit, so its settings, the empty side panel and the panel button do not show.
  const sidePanels =
    (await page.getByLabel(english("channel.panel.label")).count()) +
    (await page.getByRole("complementary", { name: english("conversation.sidePanel.label") }).count()) +
    (await conversation()
      .getByRole("button", { name: english("conversation.sidePanel.open"), exact: true })
      .count());
  assert.equal(sidePanels, 0, "The deleted channel shows a side panel.");
  await shot("deleted", page.locator("body"));
  await client.command({ type: "restore", operationId: crypto.randomUUID(), channelId: channel.id });
  await composer().waitFor({ timeout: UI_WAIT_MS });
  await deletedRow.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.archive = { notice: true, sidePanels, inDeletedChannels: true, composerAfterRestore: true };
  await page.getByLabel(english("sidebar.nav.freeArea"), { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: english("sidebar.deletedChannels.hide"), exact: true }).click();

  report.passed = true;
} finally {
  if (routineId && report.channelId)
    await page
      .evaluate((input) => window.openbot.agent.deleteChannelRoutine(input), {
        channelId: report.channelId,
        routineId,
      })
      .catch(() => undefined);
  await client.cleanup();
  writeReport("channel-chat-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
