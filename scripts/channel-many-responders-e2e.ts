// Checks that more than one member can answer one channel request, in this worktree's running dev app
// with real provider turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-many-responders-e2e.ts --allow-mutations`. It needs three visible agents whose
// provider is signed in.
//
// 1. A message written in the composer that opens with two mentions gives each mentioned member a
//    task of its own for the same request, with no routing turn, and each member replies.
// 2. A request to the whole group goes through the lead, which gives it to more than one member; the
//    lead posts one dispatch row for each, and each member replies.
// 3. A plain question that one member can answer still goes to one member only.
// 4. "Everyone", picked in the composer's mention menu, gives each member a task with no routing turn.
//    Stop while they work pauses each task, and "continue" continues the same tasks; it starts no
//    new ones.
// It makes its own channel and deletes it at the end.
// Writes .openbot-build/channel-many-responders-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX, type ChannelPage, type ChannelTask } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-many-responders-e2e");
const UI_WAIT_MS = 15_000;
const english = translateFor("en");

interface RequestResult {
  owners: string[];
  dispatchRows: number;
  repliedBy: string[];
}

interface Report {
  channelId?: string;
  members?: string[];
  mentions?: RequestResult;
  group?: RequestResult;
  single?: RequestResult;
  everyone?: RequestResult & { afterStop: string[]; continued: RequestResult };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("channel-many-responders-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(page);
const name = `E2E responders ${crypto.randomUUID().slice(0, 4)}`;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const conversation = () => page.getByRole("main", { name: english("conversation.view.label") });
const composer = () => page.getByRole("textbox", { name: english("channel.composer.label") });

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.locator("body").screenshot({ path });
  report.screenshots.push(path);
}

/** Picks a mention from the composer's menu at the caret. */
async function mention(agentName: string): Promise<void> {
  await composer().pressSequentially(`@${agentName.slice(0, 3)}`);
  await page
    .getByRole("listbox", { name: english("composer.picker.mentionLabel") })
    .getByRole("option", { name: english("composer.picker.option.agent", { name: agentName }), exact: true })
    .click();
}

const terminal = (task: ChannelTask) => task.state === "completed" || task.state === "failed";

/** Waits until every task of the request ends, and reads who owned them and who replied. */
async function settle(channelId: string, requestMessageId: string, label: string): Promise<RequestResult> {
  const settled = await waitFor(
    page,
    `${label}: every task of the request ends`,
    () => client.read(channelId),
    (current: ChannelPage) => {
      const tasks = current.tasks.filter((task) => task.requestMessageId === requestMessageId && !task.parentTaskId);
      return tasks.length > 0 && tasks.every((task) => task.ownerAgentId && terminal(task));
    },
    300_000,
  );
  const tasks = settled.tasks.filter((task) => task.requestMessageId === requestMessageId && !task.parentTaskId);
  for (const task of tasks) assert.equal(task.state, "completed", `${label}: task ${task.id} ${task.error ?? ""}`);
  const ids = new Set(tasks.map((task) => task.id));
  const rows = settled.messages.filter((message) => message.taskId && ids.has(message.taskId));
  return {
    owners: tasks.flatMap((task) => (task.ownerAgentId ? [task.ownerAgentId] : [])),
    dispatchRows: rows.filter((row) => row.message.itemType?.startsWith(CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX)).length,
    repliedBy: [
      ...new Set(
        rows
          .filter(
            (row) =>
              row.author.kind === "agent" &&
              row.message.author === "assistant" &&
              row.message.itemType !== "commentary" &&
              row.message.text.trim(),
          )
          .map((row) => row.author.id),
      ),
    ],
  };
}

/** The id of the newest message that the reader wrote with this text. */
async function requestId(channelId: string, text: string): Promise<string> {
  const current = await waitFor(
    page,
    "the request is stored",
    () => client.read(channelId),
    (value) =>
      value.messages.some((message) => message.author.kind === "member" && message.message.text.includes(text)),
  );
  const request = current.messages.findLast(
    (message) => message.author.kind === "member" && message.message.text.includes(text),
  );
  assert.ok(request);
  return request.id;
}

try {
  const agents = await client.agents();
  assert.ok(agents.length >= 3, "This check needs three visible agents.");
  const [lead, writer, editor] = agents;
  assert.ok(lead && writer && editor);
  const channel = await client.create(name, [lead.id, writer.id, editor.id], lead.id);
  report.channelId = channel.id;
  report.members = [lead.name, writer.name, editor.name];
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first()
    .click();
  await composer().waitFor({ timeout: UI_WAIT_MS });

  // 1. Two opening mentions, written in the composer as a reader writes them.
  const mentionText = "reply with the single word ready. Do not use tools.";
  await composer().click();
  await mention(writer.name);
  await page.keyboard.insertText(" ");
  await mention(editor.name);
  await page.keyboard.insertText(` ${mentionText}`);
  await conversation()
    .getByRole("button", { name: english("composer.send.message"), exact: true })
    .click();
  const mentions = await settle(channel.id, await requestId(channel.id, mentionText), "mentions");
  report.mentions = mentions;
  assert.deepEqual(new Set(mentions.owners), new Set([writer.id, editor.id]), "Each mentioned member owns a task.");
  assert.equal(mentions.owners.length, 2);
  assert.equal(mentions.dispatchRows, 0, "Mentions need no routing turn.");
  assert.deepEqual(new Set(mentions.repliedBy), new Set([writer.id, editor.id]), "Each mentioned member replies.");
  await shot("mentions");

  // 2. A request to the whole group.
  const groupText =
    "Everyone: each of you, give one short sentence of feedback on the product name 'River Notes' from your own role. Do not use tools.";
  await client.send(channel.id, groupText, null);
  const group = await settle(channel.id, await requestId(channel.id, groupText), "group");
  report.group = group;
  assert.ok(group.owners.length >= 2, `The lead gave the group request to ${group.owners.length} member(s).`);
  assert.equal(new Set(group.owners).size, group.owners.length, "A member owns one task of the request.");
  assert.equal(group.dispatchRows, group.owners.length, "The lead posts one dispatch row for each member.");
  assert.deepEqual(new Set(group.repliedBy), new Set(group.owners), "Each selected member replies.");
  await shot("group");

  // 3. One plain question still goes to one member.
  const singleText = "What is 2 + 2? Reply with the number only. Do not use tools.";
  await client.send(channel.id, singleText, null);
  const single = await settle(channel.id, await requestId(channel.id, singleText), "single");
  report.single = single;
  assert.equal(single.owners.length, 1, `A plain question went to ${single.owners.length} members.`);
  await shot("single");

  // 4. Everyone, then Stop, then "continue".
  const everyoneText = "write a numbered list of 30 short facts about mountains, one per line. Do not use tools.";
  await composer().click();
  await composer().pressSequentially("@ev");
  await page
    .getByRole("listbox", { name: english("composer.picker.mentionLabel") })
    .getByRole("option", { name: english("composer.picker.everyone"), exact: true })
    .click();
  await page.keyboard.insertText(everyoneText);
  await conversation()
    .getByRole("button", { name: english("composer.send.message"), exact: true })
    .click();
  const everyoneRequest = await requestId(channel.id, everyoneText);
  const requestTasks = (current: ChannelPage) =>
    current.tasks.filter((task) => task.requestMessageId === everyoneRequest && !task.parentTaskId);
  const running = await waitFor(
    page,
    "everyone: each member owns a task and one runs",
    () => client.read(channel.id),
    (current: ChannelPage) =>
      requestTasks(current).length === 3 && requestTasks(current).some((task) => task.state === "running"),
  );
  const everyoneIds = requestTasks(running).map((task) => task.id);
  assert.deepEqual(
    new Set(requestTasks(running).map((task) => task.ownerAgentId)),
    new Set([lead.id, writer.id, editor.id]),
    "Everyone gives each member a task.",
  );
  await conversation()
    .getByRole("button", { name: english("composer.send.stop"), exact: true })
    .click();
  const stopped = await waitFor(
    page,
    "everyone: Stop pauses the work",
    () => client.read(channel.id),
    (current: ChannelPage) =>
      requestTasks(current).every((task) => task.state === "paused" || terminal(task)) &&
      requestTasks(current).some((task) => task.state === "paused"),
  );
  const afterStop = requestTasks(stopped).map((task) => `${task.ownerAgentId}:${task.state}`);
  const pausedIds = requestTasks(stopped)
    .filter((task) => task.state === "paused")
    .map((task) => task.id);
  await shot("everyone-stopped");
  await composer().click();
  await page.keyboard.insertText("continue");
  await conversation()
    .getByRole("button", { name: english("composer.send.message"), exact: true })
    .click();
  const continued = await settle(channel.id, await requestId(channel.id, "continue"), "continue");
  const settled = await client.read(channel.id);
  const continueTasks = settled.tasks.filter((task) => pausedIds.includes(task.id));
  report.everyone = {
    owners: requestTasks(running).flatMap((task) => (task.ownerAgentId ? [task.ownerAgentId] : [])),
    dispatchRows: settled.messages.filter(
      (row) =>
        row.taskId &&
        everyoneIds.includes(row.taskId) &&
        row.message.itemType?.startsWith(CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX),
    ).length,
    repliedBy: continued.repliedBy,
    afterStop,
    continued,
  };
  assert.equal(report.everyone.dispatchRows, 0, "Everyone needs no routing turn.");
  assert.equal(continued.owners.length, pausedIds.length, "Continue starts no new task.");
  assert.ok(
    continueTasks.every((task) => task.state === "completed"),
    "Continue completes each paused task.",
  );
  assert.deepEqual(
    new Set(continued.repliedBy),
    new Set(continueTasks.map((task) => task.ownerAgentId)),
    "Each continued member replies.",
  );
  await shot("everyone-continued");

  report.passed = true;
} finally {
  await client.cleanup();
  writeReport("channel-many-responders-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
