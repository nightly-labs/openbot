// Checks the OpenBot tools that a member agent uses in a channel turn, in this worktree's running
// dev app with real provider turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-tools-e2e.ts --allow-mutations`. It needs two visible agents whose provider is
// signed in and follows tool instructions.
//
// It checks that `html_render` gives a visual reply in the channel with its page attached, that
// `ask_ui` and the plan card of `acknowledge_request` show in the channel and that the answer reaches
// the turn, that a screen capture asks each time and names the channel also with Full access, that
// `channel_history` reads the channel, that `start_task` starts no task from a channel, and that text
// after `channel_result` folds into the steps rather than showing as a second reply. The model
// does the tool calls, so a model that does not follow the instructions fails a step. It makes its own
// channel and deletes it, and gives the agent its settings back.
// Writes .openbot-build/channel-tools-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type {
  AgentAdminSettings,
  AgentApproval,
  AgentPromptQuestion,
  AgentSummary,
  ChannelMessage,
  ChannelPage,
  ChannelTask,
} from "@openbot/contracts/ipc";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

interface SeenPrompt {
  requestId: string | number;
  agentId: string;
  threadId: string;
  questions: AgentPromptQuestion[];
}

declare global {
  interface Window {
    channelToolsE2e?: { prompts: SeenPrompt[]; approvals: AgentApproval[] };
  }
}

interface Report {
  visualReply?: { itemType: string; attachments: number };
  askUi?: { promptOnChannelThread: boolean; uiBlockInChannel: boolean; reply: string };
  planCard?: { promptOnChannelThread: boolean; uiBlockInChannel: boolean; answered: boolean; state: string };
  screenCapture?: { asked: boolean; namesChannel: boolean; reason: string };
  history?: { reply: string; tasksStarted: number };
  result?: { answers: string[]; folded: string[] };
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-tools-e2e");
const { page } = session;
const client = new ChannelClient(page);
let restore: { agent: AgentSummary; admin: AgentAdminSettings } | null = null;

const newestTask = (channel: ChannelPage): ChannelTask | undefined => channel.tasks.at(-1);
const ended = (channel: ChannelPage) => {
  const state = newestTask(channel)?.state;
  return state === "completed" || state === "failed" || state === "paused" || state === "cancelled";
};
const repliesAfter = (channel: ChannelPage, agentId: string, sequence: number): ChannelMessage[] =>
  channel.messages.filter((message) => message.sequence > sequence && message.author.id === agentId);

const seen = () => page.evaluate(() => window.channelToolsE2e ?? { prompts: [], approvals: [] });

/** Sends one request to the agent and waits until its task ends. */
async function ask(channelId: string, agentId: string, text: string, label: string) {
  const sequence = (await client.read(channelId)).throughSequence;
  await client.send(channelId, text, agentId);
  const channel = await waitFor(page, label, () => client.read(channelId), ended);
  return { channel, sequence, replies: repliesAfter(channel, agentId, sequence) };
}

/** The first new prompt of the agent after `count` prompts were seen. */
async function nextPrompt(agentId: string, count: number, label: string): Promise<SeenPrompt> {
  const all = await waitFor(page, label, seen, (events) =>
    events.prompts.slice(count).some((prompt) => prompt.agentId === agentId),
  );
  const prompt = all.prompts.slice(count).find((candidate) => candidate.agentId === agentId);
  assert.ok(prompt);
  return prompt;
}

/** Answers each question with the option that `pick` names, or with its first option. */
function answersFor(prompt: SeenPrompt, pick: RegExp | null): Record<string, string[]> {
  return Object.fromEntries(
    prompt.questions.map((question) => {
      const options = question.options ?? [];
      const chosen = options.find((option) => pick?.test(option.label)) ?? options[0];
      return [question.id, [chosen?.label ?? "ok"]];
    }),
  );
}

const onChannelThread = async (channelId: string, threadId: string) =>
  ((await client.summary(channelId)).threads ?? []).some((thread) => thread.threadId === threadId);

try {
  const agents = (await client.agents()).filter((agent) => agentProviderDescriptor(agent.provider).concurrentTurns);
  assert.ok(agents.length >= 2, "This check needs two visible agents whose provider runs turns at the same time.");
  const [a, b] = agents;
  assert.ok(a && b);

  const admin = await page.evaluate((id) => window.openbot.agent.getAgentAdminSettings(id), a.id);
  restore = { agent: a, admin };
  await client.update(a.id, { quickAcknowledgement: true, computerUse: true });
  await page.evaluate(
    (id) => window.openbot.agent.updateAgentAdminSettings({ agentId: id, access: "full", autoApprove: true }),
    a.id,
  );
  await page.evaluate(() => {
    const events: { prompts: SeenPrompt[]; approvals: AgentApproval[] } = { prompts: [], approvals: [] };
    window.channelToolsE2e = events;
    window.openbot.agent.onEvent((event) => {
      if (event.type === "prompt")
        events.prompts.push({
          requestId: event.requestId,
          agentId: event.agentId,
          threadId: event.threadId,
          questions: event.questions,
        });
      if (event.type === "approval") events.approvals.push(event.approval);
    });
  });

  const channel = await client.create("E2E channel tools", [a.id, b.id], a.id);

  // 1. html_render gives a visual reply in the channel, with the page attached.
  const visual = await ask(
    channel.id,
    a.id,
    "Call the html_render tool once with a small HTML page that shows the word OTTER in a heading. Then reply with DONE only.",
    "the visual reply turn ends",
  );
  const visualMessage = visual.replies.find((message) => message.message.itemType?.startsWith("visual-reply:"));
  report.visualReply = {
    itemType: visualMessage?.message.itemType ?? "missing",
    attachments: visualMessage?.message.attachments?.length ?? 0,
  };
  assert.ok(visualMessage, "The channel has no visual reply.");
  assert.ok(report.visualReply.attachments > 0, "The visual reply has no attached page.");

  // 2. ask_ui shows its block in the channel, and the answer reaches the turn.
  let prompts = (await seen()).prompts.length;
  let sequence = (await client.read(channel.id)).throughSequence;
  await client.send(
    channel.id,
    "Call the ask_ui tool once with a quick_replies block titled 'Pick a color' with the options Red and Blue. When the answer comes, reply with the chosen color only.",
    a.id,
  );
  const colorPrompt = await nextPrompt(a.id, prompts, "the ask_ui prompt arrives");
  const withBlock = await waitFor(
    page,
    "the ask_ui block shows in the channel",
    () => client.read(channel.id),
    (current) => repliesAfter(current, a.id, sequence).some((message) => message.message.uiBlock !== undefined),
  );
  await page.evaluate((input) => window.openbot.agent.respondToPrompt(input), {
    requestId: colorPrompt.requestId,
    answers: answersFor(colorPrompt, /blue/i),
  });
  const colorAnswered = await waitFor(page, "the ask_ui turn ends", () => client.read(channel.id), ended);
  const colorReply = repliesAfter(colorAnswered, a.id, sequence).at(-1)?.message.text ?? "";
  report.askUi = {
    promptOnChannelThread: await onChannelThread(channel.id, colorPrompt.threadId),
    uiBlockInChannel: repliesAfter(withBlock, a.id, sequence).some((message) => message.message.uiBlock !== undefined),
    reply: colorReply,
  };
  assert.ok(report.askUi.promptOnChannelThread, "The ask_ui prompt is not on the agent's channel thread.");
  assert.equal(newestTask(colorAnswered)?.state, "completed");
  assert.match(colorReply, /blue/i, "The answer did not reach the turn.");

  // 3. The plan card shows in the channel, and the start reaches the turn.
  prompts = (await seen()).prompts.length;
  sequence = (await client.read(channel.id)).throughSequence;
  await client.send(
    channel.id,
    "Call the acknowledge_request tool once with a two-step plan to write a haiku about rivers. When I start the work, reply with the haiku only.",
    a.id,
  );
  const planPrompt = await nextPrompt(a.id, prompts, "the plan card arrives");
  const answered = await page
    .evaluate((input) => window.openbot.agent.respondToPrompt(input), {
      requestId: planPrompt.requestId,
      answers: answersFor(planPrompt, null),
    })
    .then(
      () => true,
      // The host presses the start button itself after ten seconds.
      () => false,
    );
  const planEnded = await waitFor(page, "the plan turn ends", () => client.read(channel.id), ended);
  report.planCard = {
    promptOnChannelThread: await onChannelThread(channel.id, planPrompt.threadId),
    uiBlockInChannel: repliesAfter(planEnded, a.id, sequence).some((message) => message.message.uiBlock !== undefined),
    answered,
    state: newestTask(planEnded)?.state ?? "missing",
  };
  assert.ok(report.planCard.promptOnChannelThread, "The plan card is not on the agent's channel thread.");
  assert.ok(report.planCard.uiBlockInChannel, "The plan card does not show in the channel.");
  assert.equal(report.planCard.state, "completed");

  // 4. A screen capture asks each time, names the channel, and the decline reaches the turn.
  const approvals = (await seen()).approvals.length;
  await client.send(
    channel.id,
    "Call the capture_screen tool once with target region, x 0, y 0, width 200 and height 200. If it is declined, reply with DECLINED only.",
    a.id,
  );
  const events = await waitFor(page, "the capture approval arrives", seen, (current) =>
    current.approvals.slice(approvals).some((approval) => approval.agentId === a.id),
  );
  const approval = events.approvals.slice(approvals).find((candidate) => candidate.agentId === a.id);
  assert.ok(approval);
  await page.evaluate(
    (requestId) => window.openbot.agent.respondToApproval({ requestId, decision: "decline" }),
    approval.requestId,
  );
  await waitFor(page, "the capture turn ends", () => client.read(channel.id), ended);
  report.screenCapture = {
    asked: true,
    namesChannel: (approval.reason ?? "").includes(channel.name),
    reason: approval.reason ?? "",
  };
  assert.ok(report.screenCapture.namesChannel, "The capture approval does not name the channel.");

  // 5. channel_history reads the channel; start_task starts nothing from a channel.
  await ask(
    channel.id,
    b.id,
    "Remember the code word HERON. Reply with OK only. Do not use tools.",
    "the other member replies",
  );
  const tasksBefore = (await page.evaluate((id) => window.openbot.agent.listTasks(id), a.id)).tasks.length;
  const history = await ask(
    channel.id,
    a.id,
    `Call the channel_history tool and find the code word that I gave to ${b.name}. Then call the start_task tool with the title E2E and the brief "Reply ok". Reply in this form only: WORD=<the code word> TASK=<the result of start_task>.`,
    "the history turn ends",
  );
  const tasksAfter = (await page.evaluate((id) => window.openbot.agent.listTasks(id), a.id)).tasks.length;
  const historyReply = history.replies.at(-1)?.message.text ?? "";
  report.history = { reply: historyReply, tasksStarted: tasksAfter - tasksBefore };
  assert.match(historyReply, /heron/i, "channel_history did not find the code word.");
  assert.equal(report.history.tasksStarted, 0, "start_task started a task from a channel.");

  // 6. Text after channel_result folds into the steps; the result is the only reply (#3202).
  const result = await ask(
    channel.id,
    a.id,
    "Call the channel_result tool once with the text PELICAN. After the tool returns, reply with Yes. only.",
    "the result turn ends",
  );
  const answers = result.replies.filter(
    (message) =>
      message.message.author === "assistant" &&
      !message.message.uiBlock &&
      (!message.message.itemType || message.message.itemType === "agentMessage"),
  );
  report.result = {
    answers: answers.map((message) => message.message.text),
    folded: result.replies
      .filter((message) => message.message.itemType === "commentary")
      .map((message) => message.message.text),
  };
  assert.deepEqual(report.result.answers, ["PELICAN"], "The turn shows more than its result as a reply.");
  assert.ok(
    report.result.folded.some((text) => /^yes\.?$/i.test(text.trim())),
    "The text after the result is not in the steps.",
  );

  report.passed = true;
} finally {
  await client.cleanup();
  if (restore) {
    const { agent, admin } = restore;
    await client
      .update(agent.id, {
        quickAcknowledgement: agent.quickAcknowledgement ?? false,
        computerUse: agent.computerUse ?? true,
      })
      .catch(() => undefined);
    await page
      .evaluate((input) => window.openbot.agent.updateAgentAdminSettings(input), {
        agentId: agent.id,
        access: admin.access,
        autoApprove: admin.autoApprove,
      })
      .catch(() => undefined);
  }
  writeReport("channel-tools-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
