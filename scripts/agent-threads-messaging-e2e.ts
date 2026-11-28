import assert from "node:assert/strict";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentTask, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const fromArgument = argument("from");
const toArgument = argument("to");
assert.ok(fromArgument && toArgument, "Pass --from=<agent id> and --to=<agent id> of two signed-in agents.");
const from: string = fromArgument;
const to: string = toArgument;
const also = argument("also");
const run = crypto.randomUUID().slice(0, 6);
const TURN_MS = 240_000;
const only = argument("only")?.split(",").map(Number);

type Details = Record<string, string | number | boolean | null | undefined>;

interface Step {
  name: string;
  passed: boolean;
  details: Details;
  error?: string;
}

interface Report {
  from: string;
  to: string;
  run: string;
  steps: Step[];
  pageErrors: string[];
  passed: boolean;
}

const report: Report = { from, to, run, steps: [], pageErrors: [], passed: false };
const session = await connectChannelE2e("agent-threads-messaging-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const started: Array<{ agentId: string; taskId: string }> = [];

const bridge = {
  agent: (id: string) =>
    page.evaluate(async (agentId) => {
      const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === agentId);
      if (!found) throw new Error(`Unknown agent: ${agentId}`);
      return { name: found.name, provider: found.provider };
    }, id),
  tasks: (id: string): Promise<AgentTask[]> =>
    page.evaluate((agentId) => window.openbot.agent.listTasks(agentId).then((snapshot) => snapshot.tasks), id),
  main: (id: string): Promise<ConversationSnapshot> =>
    page.evaluate((agentId) => window.openbot.agent.readConversation(agentId), id),
  side: (agentId: string, taskId: string): Promise<ConversationSnapshot> =>
    page.evaluate((input) => window.openbot.agent.readTask(input), { agentId, taskId }),
  send: (agentId: string, text: string) =>
    page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
      agentId,
      text,
    }),
  stop: (agentId: string, taskId: string) =>
    page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId }),
  close: (agentId: string, taskId: string) =>
    page.evaluate((input) => window.openbot.agent.closeTask(input), { agentId, taskId }),
  reopen: (agentId: string, taskId: string) =>
    page.evaluate((input) => window.openbot.agent.reopenTask(input), { agentId, taskId }),
  startTask: async (agentId: string, text: string): Promise<AgentTask> => {
    const task = await page.evaluate(
      (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
      { agentId, text },
    );
    started.push({ agentId, taskId: task.id });
    return task;
  },
};

const has = (snapshot: ConversationSnapshot, accept: (message: ConversationMessage) => boolean) =>
  snapshot.messages.some(accept);
const answerWith = (word: string) => (message: ConversationMessage) =>
  message.author === "assistant" && message.text.includes(word);
const fromAgent = (agentId: string, word: string) => (message: ConversationMessage) =>
  message.senderAgentId === agentId && message.text.includes(word);
const count = (snapshot: ConversationSnapshot, match: (message: ConversationMessage) => boolean) =>
  snapshot.messages.filter(match).length;
const idle = (snapshot: ConversationSnapshot) => snapshot.activeTurnId === null;
const task = async (agentId: string, taskId: string) =>
  (await bridge.tasks(agentId)).find((entry) => entry.id === taskId);

let stepNumber = 0;
async function step(name: string, body: (details: Details) => Promise<void>): Promise<void> {
  stepNumber += 1;
  if (only && !only.includes(stepNumber)) return;
  const details: Details = {};
  const entry: Step = { name, passed: false, details };
  report.steps.push(entry);
  try {
    await body(details);
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  }
  process.stdout.write(`${entry.passed ? "pass" : "FAIL"} ${name}${entry.error ? `: ${entry.error}` : ""}\n`);
}

const ask = (word: string, question: string, toName: string) =>
  [
    `Use openbot.send_message to send ${toName} (agent id "${to}") this message, with expectsReply true:`,
    `"${word}: ${question} Answer with only the number."`,
    "Then end your turn and reply with the single word SENT. Do not wait for the answer.",
  ].join("\n");

const busyFor = (seconds: number) =>
  `run the shell command "ping -c ${seconds} 127.0.0.1" in the foreground, with a timeout of ${(seconds + 60) * 1000} ms`;

const fromAgentInfo = await bridge.agent(from);
const toAgentInfo = await bridge.agent(to);
for (const provider of [fromAgentInfo.provider, toAgentInfo.provider]) {
  assert.ok(
    isAgentProvider(provider) && agentProviderDescriptor(provider).concurrentTurns,
    `${provider} runs one turn.`,
  );
}
const claude = fromAgentInfo.provider === "claude";

try {
  await step("main asks another agent", async (details) => {
    const word = `M1${run}`;
    const tasksBefore = (await bridge.tasks(from)).length + (await bridge.tasks(to)).length;
    await bridge.send(from, ask(word, "What is 2+2?", toAgentInfo.name));
    await waitFor(
      page,
      "B gets the request in its own chat",
      () => bridge.main(to),
      (s) => has(s, fromAgent(from, word)),
      TURN_MS,
    );
    const back = await waitFor(
      page,
      "A gets the answer in its own chat",
      () => bridge.main(from),
      (s) => has(s, (m) => m.senderAgentId === to && m.text.includes("4")) && idle(s),
      TURN_MS,
    );
    details.answerInMain = has(back, (m) => m.senderAgentId === to);
    const tasksAfter = (await bridge.tasks(from)).length + (await bridge.tasks(to)).length;
    details.threadsStarted = tasksAfter - tasksBefore;
    assert.equal(tasksAfter, tasksBefore, "A message between agents started a thread.");
  });

  await step("side thread asks another agent", async (details) => {
    const word = `M2${run}`;
    const answer = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes("6");
    const outgoing = (message: ConversationMessage) => message.exchange?.direction === "outgoing";
    const sentAnswer = (m: ConversationMessage) => outgoing(m) && m.text.includes("6");
    const answersBefore = count(await bridge.main(from), answer);
    const sentBefore = count(await bridge.main(to), sentAnswer);
    const side = await bridge.startTask(from, ask(word, "What is 3+3?", toAgentInfo.name));
    details.taskId = side.id;
    await waitFor(
      page,
      "B gets the request in its own chat",
      () => bridge.main(to),
      (s) => has(s, fromAgent(from, word)),
      TURN_MS,
    );
    const toSides = await Promise.all((await bridge.tasks(to)).map((entry) => bridge.side(to, entry.id)));
    details.requestInRecipientSideThread = toSides.some((s) => has(s, fromAgent(from, word)));
    assert.equal(details.requestInRecipientSideThread, false, "The request reached a side thread of B.");
    const lane = await waitFor(
      page,
      "A gets the answer",
      async () => {
        const [main, thread] = [await bridge.main(from), await bridge.side(from, side.id)];
        return has(thread, answer) ? "side" : count(main, answer) > answersBefore ? "main" : null;
      },
      (value) => value !== null,
      TURN_MS,
    );
    details.answerLane = lane;
    assert.equal(lane, "side", "The answer came back to A's own chat.");
    await waitFor(
      page,
      "the side thread reads the answer",
      () => task(from, side.id),
      (entry) => entry?.state === "idle",
      TURN_MS,
    );
    const thread = await bridge.side(from, side.id);
    details.sideRepliedSent = has(thread, answerWith("SENT"));
    details.sideReadAnswer = thread.messages.slice(thread.messages.findIndex(answer) + 1).some(answerWith(""));
    const ownChat = await bridge.main(from);
    details.requestInSenderChat = has(ownChat, (m) => outgoing(m) && m.text.includes(word));
    details.answerInSenderChat = count(ownChat, answer) > answersBefore;
    assert.equal(details.requestInSenderChat, false, "A's own chat shows the request from its side thread.");
    assert.equal(details.answerInSenderChat, false, "A's own chat shows the answer to its side thread.");
    details.answerInRecipientChat = count(await bridge.main(to), sentAnswer) > sentBefore;
    assert.ok(details.answerInRecipientChat, "B's own chat does not show its answer.");
  });

  await step("recipient answers while its side thread runs", async (details) => {
    const word = `M3${run}`;
    const slept = `SLEPT${run}`;
    const side = await bridge.startTask(to, `First ${busyFor(90)}, then reply with the single word ${slept}.`);
    details.taskId = side.id;
    await waitFor(
      page,
      "B's side thread runs",
      () => task(to, side.id),
      (entry) => entry?.state === "running",
      TURN_MS,
    );
    const sentAt = Date.now();
    const mark = async (key: string) => {
      details[`${key}Ms`] = Date.now() - sentAt;
      details[`${key}SideState`] = (await task(to, side.id))?.state ?? null;
    };
    await bridge.send(from, ask(word, "What is 5+5?", toAgentInfo.name));
    const requestIndex = (s: ConversationSnapshot) => s.messages.findIndex(fromAgent(from, word));
    await waitFor(
      page,
      "B gets the request",
      () => bridge.main(to),
      (s) => requestIndex(s) >= 0,
      TURN_MS,
    );
    await mark("requestArrived");
    await waitFor(
      page,
      "B's own chat starts a turn",
      () => bridge.main(to),
      (s) => s.activeTurnId !== null || s.messages.slice(requestIndex(s) + 1).some((m) => m.author === "assistant"),
      TURN_MS,
    );
    await mark("mainTurnStarted");
    await waitFor(
      page,
      "B answers in its own chat",
      () => bridge.main(to),
      (s) => s.messages.slice(requestIndex(s) + 1).some((m) => m.author === "assistant" && m.text.trim() !== ""),
      TURN_MS,
    );
    await mark("mainAnswered");
    assert.equal(details.requestArrivedSideState, "running", "B's side thread ended before the request came.");
    assert.equal(details.mainTurnStartedSideState, "running", "B's own chat waited for its side thread.");
    const thread = await waitFor(
      page,
      "B's side thread ends",
      () => bridge.side(to, side.id),
      (s) => idle(s) && has(s, answerWith(slept)),
      TURN_MS,
    );
    const main = await bridge.main(to);
    details.sideHasRequest = has(thread, (m) => m.text.includes(word));
    details.mainHasSideAnswer = has(main, (m) => m.text.includes(slept) && m.author === "assistant");
    assert.equal(details.sideHasRequest, false, "B's side thread got A's request.");
    assert.equal(details.mainHasSideAnswer, false, "B's own chat got the side thread's answer.");
  });

  await step("agent starts a thread from its own chat", async (details) => {
    const title = `Smoke sub ${run}`;
    const pong = `PONG${run}`;
    await bridge.send(
      from,
      `Call openbot.start_task with the title "${title}" and the brief "Reply with the single word ${pong}. Do not use tools." Then reply with the single word STARTED.`,
    );
    const created = await waitFor(
      page,
      "the thread starts",
      async () => (await bridge.tasks(from)).find((entry) => entry.title === title),
      Boolean,
      TURN_MS,
    );
    assert.ok(created);
    started.push({ agentId: from, taskId: created.id });
    details.origin = created.origin;
    await waitFor(
      page,
      "the thread answers",
      () => bridge.side(from, created.id),
      (s) => idle(s) && has(s, answerWith(pong)),
      TURN_MS,
    );
    const main = await waitFor(
      page,
      "the own chat ends its turn",
      () => bridge.main(from),
      (s) => idle(s) && has(s, answerWith("STARTED")),
      TURN_MS,
    );
    const brief = (m: ConversationMessage) => m.text.startsWith(`Reply with the single word ${pong}`);
    details.mainHasThreadAnswer = has(main, answerWith(pong));
    details.mainHasBrief = has(main, brief);
    await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId: from, taskId: created.id });
    started.splice(
      started.findIndex((entry) => entry.taskId === created.id),
      1,
    );
    details.mainHasBriefAfterDelete = has(await bridge.main(from), brief);
    assert.equal(details.mainHasThreadAnswer, false, "The own chat got the thread's answer.");
    assert.equal(details.mainHasBrief, false, "The own chat shows the thread's brief.");
    assert.equal(details.mainHasBriefAfterDelete, false, "The thread delete moved the brief to the own chat.");
  });

  await step("side thread cannot start threads or a new chat", async (details) => {
    const title = `Refused ${run}`;
    const mainBefore = await bridge.main(from);
    const side = await bridge.startTask(
      from,
      [
        "Call each tool once, in order, and do not retry. Then reply with the exact result text of each call, one per line.",
        `1. openbot.start_task with the title "${title}" and the brief "Reply ok."`,
        "2. openbot.start_new_chat with no arguments.",
      ].join("\n"),
    );
    details.taskId = side.id;
    const thread = await waitFor(page, "the side thread ends", () => bridge.side(from, side.id), idle, TURN_MS);
    const last = thread.messages.filter((m) => m.author === "assistant").at(-1);
    details.sideAnswer = last?.text.slice(0, 600);
    details.threadStarted = (await bridge.tasks(from)).some((entry) => entry.title === title);
    const mainAfter = await bridge.main(from);
    details.mainKeptThread = mainAfter.threadId === mainBefore.threadId;
    details.mainKeptMessages = mainBefore.messages.every((m) => mainAfter.messages.some((n) => n.id === m.id));
    assert.equal(details.threadStarted, false, "A side thread started a thread.");
    assert.ok(details.mainKeptThread && details.mainKeptMessages, "A side thread reset the own chat.");
  });

  await step("answer after the side thread is archived", async (details) => {
    const word = `M6${run}`;
    const busy = `BUSY${run}`;
    const answer = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes("14");
    const answersBefore = count(await bridge.main(from), answer);
    await bridge.send(to, `Write the numbers from 1 to 300 as English words, one per line. Then reply ${busy}.`);
    await waitFor(
      page,
      "B's own chat runs",
      () => bridge.main(to),
      (s) => s.activeTurnId !== null,
      TURN_MS,
    );
    const side = await bridge.startTask(from, ask(word, "What is 7+7?", toAgentInfo.name));
    details.taskId = side.id;
    await waitFor(
      page,
      "B gets the request",
      () => bridge.main(to),
      (s) => has(s, fromAgent(from, word)),
      TURN_MS,
    );
    await waitFor(
      page,
      "A's side thread ends",
      () => task(from, side.id),
      (e) => e?.state === "idle",
      TURN_MS,
    );
    await bridge.close(from, side.id);
    const recipient = await bridge.main(to);
    details.recipientBusyAtArchive = recipient.activeTurnId !== null && !has(recipient, answerWith(busy));
    assert.ok(details.recipientBusyAtArchive, "B finished before the archive; the step proves nothing.");
    const lane = await waitFor(
      page,
      "A gets the answer",
      async () => {
        const [main, thread] = [await bridge.main(from), await bridge.side(from, side.id)];
        return has(thread, answer) ? "side" : count(main, answer) > answersBefore ? "main" : null;
      },
      (value) => value !== null,
      TURN_MS * 2,
    );
    details.answerLane = lane;
    assert.equal(lane, "main", "The answer to an archived side thread did not come to A's own chat.");
    await waitFor(page, "A's own chat reads it", () => bridge.main(from), idle, TURN_MS);
    await bridge.reopen(from, side.id);
    details.reopenedState = (await task(from, side.id))?.state ?? null;
    details.reopenedHasAnswer = has(await bridge.side(from, side.id), answer);
    assert.equal(details.reopenedHasAnswer, false, "The answer came twice: also to the reopened side thread.");
  });

  if (also) {
    const alsoId = also;
    await step("side thread asks two agents", async (details) => {
      const word = `M7${run}`;
      const alsoInfo = await bridge.agent(alsoId);
      const fromEither = (m: ConversationMessage) =>
        (m.senderAgentId === to || m.senderAgentId === alsoId) && m.text.includes("18");
      const answersBefore = count(await bridge.main(from), fromEither);
      const side = await bridge.startTask(
        from,
        [
          `Use openbot.send_message once, with recipientAgentIds ["${to}", "${alsoId}"] (${toAgentInfo.name} and ${alsoInfo.name}) and expectsReply true, to send:`,
          `"${word}: What is 9+9? Answer with only the number."`,
          "Then end your turn and reply with the single word SENT. Do not wait for the answers.",
        ].join("\n"),
      );
      details.taskId = side.id;
      const thread = await waitFor(
        page,
        "both answers come back to the side thread",
        () => bridge.side(from, side.id),
        (s) =>
          has(s, (m) => fromEither(m) && m.senderAgentId === to) &&
          has(s, (m) => fromEither(m) && m.senderAgentId === alsoId),
        TURN_MS,
      );
      details.answersInSide = thread.messages.filter(fromEither).length;
      await waitFor(
        page,
        "the side thread reads them",
        () => task(from, side.id),
        (e) => e?.state === "idle",
        TURN_MS,
      );
      details.answersInMain = count(await bridge.main(from), fromEither) - answersBefore;
      assert.equal(details.answersInMain, 0, "A's own chat got an answer to its side thread.");
    });
  } else stepNumber += 1;

  await step("thread delete keeps the teammate's history", async (details) => {
    const word = `M8${run}`;
    const answer = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes("16");
    const side = await bridge.startTask(from, ask(word, "What is 8+8?", toAgentInfo.name));
    details.taskId = side.id;
    await waitFor(
      page,
      "the answer comes back",
      () => bridge.side(from, side.id),
      (s) => has(s, answer),
      TURN_MS,
    );
    await waitFor(
      page,
      "the side thread reads it",
      () => task(from, side.id),
      (e) => e?.state === "idle",
      TURN_MS,
    );
    const recipientBefore = await bridge.main(to);
    const sent = (s: ConversationSnapshot) =>
      s.messages.slice(s.messages.findIndex(fromAgent(from, word)) + 1).some((m) => m.text.includes("16"));
    details.recipientAnsweredBefore = has(recipientBefore, fromAgent(from, word)) && sent(recipientBefore);
    await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId: from, taskId: side.id });
    started.splice(
      started.findIndex((entry) => entry.taskId === side.id),
      1,
    );
    details.deleted = (await task(from, side.id)) === undefined;
    const recipientAfter = await bridge.main(to);
    details.recipientKeptRequest = has(recipientAfter, fromAgent(from, word));
    details.recipientKeptAnswer = sent(recipientAfter);
    const ownChat = await bridge.main(from);
    details.senderChatShowsIt = has(ownChat, (m) => m.text.includes(word) || answer(m));
    assert.ok(details.deleted, "The thread is still there.");
    assert.ok(details.recipientKeptRequest && details.recipientKeptAnswer, "B's own chat lost the exchange.");
    assert.equal(details.senderChatShowsIt, false, "The deleted thread's exchange moved to A's own chat.");
  });

  if (claude) {
    await step("Claude subagent in a side thread", async (details) => {
      const word = `SUBOK${run}`;
      const mainBefore = await bridge.main(from);
      const side = await bridge.startTask(
        from,
        `Use your Agent tool to start one subagent and tell it to reply with the single word ${word}, with no tools. Wait for it, then reply with its answer.`,
      );
      details.taskId = side.id;
      const thread = await waitFor(
        page,
        "the side thread ends",
        () => bridge.side(from, side.id),
        (s) => idle(s) && has(s, answerWith(word)),
        TURN_MS,
      );
      details.subagentsInSide = thread.messages.filter((m) => m.subagents?.length).length;
      const mainAfter = await bridge.main(from);
      details.subagentsAddedToMain = mainAfter.messages.filter(
        (m) => m.subagents?.length && !mainBefore.messages.some((n) => n.id === m.id),
      ).length;
      assert.ok(Number(details.subagentsInSide) > 0, "The side thread shows no subagent.");
      assert.equal(details.subagentsAddedToMain, 0, "The own chat shows the side thread's subagent.");
    });

    await step("background Claude subagent in a side thread", async (details) => {
      const word = `SUB2${run}`;
      const follow = `FOLLOWUP2-${run}`;
      const side = await bridge.startTask(
        from,
        [
          "Use your Agent tool with run_in_background set to true to start one subagent. Tell it:",
          `${busyFor(20)} once, then reply with the single word ${word}.`,
          "Do not wait for it: reply with the single word STARTED2 now and end your turn.",
          `When its result comes later, reply with ${follow} and its answer.`,
        ].join(" "),
      );
      details.taskId = side.id;
      const mainBefore = await bridge.main(from);
      await waitFor(
        page,
        "the first turn ends",
        () => bridge.side(from, side.id),
        (s) => has(s, answerWith("STARTED2")),
        TURN_MS,
      );
      const lane = await waitFor(
        page,
        "the subagent's answer comes back",
        async () => {
          const [thread, main] = [await bridge.side(from, side.id), await bridge.main(from)];
          const followed = (s: ConversationSnapshot) => has(s, (m) => answerWith(follow)(m) && m.text.includes(word));
          if (followed(thread)) return "side";
          const added = main.messages.filter((m) => !mainBefore.messages.some((n) => n.id === m.id));
          return added.some((m) => m.author === "assistant" && m.text.includes(word)) ? "main" : null;
        },
        (value) => value !== null,
        TURN_MS,
      );
      details.answerLane = lane;
      await waitFor(
        page,
        "the side thread is idle",
        () => task(from, side.id),
        (entry) => entry?.state === "idle",
        TURN_MS,
      );
      details.finalState = "idle";
      assert.equal(lane, "side", "The background subagent's answer went to the own chat.");
    });
  } else stepNumber += 2;

  await step("stop keeps a waiting answer", async (details) => {
    const word = `M11${run}`;
    const answer = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes("12");
    const got = `GOT${run}`;
    const answersBefore = count(await bridge.main(from), answer);
    const side = await bridge.startTask(
      from,
      [
        `Use openbot.send_message to send ${toAgentInfo.name} (agent id "${to}") this message, with expectsReply true:`,
        `"${word}: What is 9+3? Answer with only the number."`,
        `Then ${busyFor(120)}, and then reply DONE.`,
        `When the answer comes, reply with ${got} and the number.`,
      ].join("\n"),
    );
    details.taskId = side.id;
    const waiting = await waitFor(
      page,
      "B's answer waits in the running side thread",
      () => task(from, side.id),
      (e) => e?.state === "running" && e.queuedMessages.length > 0,
      TURN_MS,
    );
    details.queuedAtStop = waiting?.queuedMessages.length ?? 0;
    await bridge.stop(from, side.id);
    const lane = await waitFor(
      page,
      "A reads the answer",
      async () => {
        const [main, thread] = [await bridge.main(from), await bridge.side(from, side.id)];
        return count(main, answer) > answersBefore
          ? "main"
          : idle(thread) && has(thread, answerWith(got))
            ? "side"
            : null;
      },
      (value) => value !== null,
      TURN_MS,
    );
    details.answerLane = lane;
    details.threadQueued = (await task(from, side.id))?.queuedMessages.length ?? null;
    assert.equal(lane, "side", "The answer did not run in the stopped side thread.");
    assert.equal(details.threadQueued, 0, "The stopped side thread still holds the answer.");
  });

  await step("archive moves a waiting answer to the own chat", async (details) => {
    const word = `M12${run}`;
    const answer = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes("13");
    const answersBefore = count(await bridge.main(from), answer);
    const side = await bridge.startTask(
      from,
      [
        `Use openbot.send_message to send ${toAgentInfo.name} (agent id "${to}") this message, with expectsReply true:`,
        `"${word}: What is 9+4? Answer with only the number."`,
        `Then ${busyFor(120)}, and then reply DONE.`,
      ].join("\n"),
    );
    details.taskId = side.id;
    const waiting = await waitFor(
      page,
      "B's answer waits in the running side thread",
      () => task(from, side.id),
      (e) => e?.state === "running" && e.queuedMessages.length > 0,
      TURN_MS,
    );
    details.queuedAtArchive = waiting?.queuedMessages.length ?? 0;
    await bridge.close(from, side.id);
    await waitFor(
      page,
      "A's own chat reads the answer",
      () => bridge.main(from),
      (s) => idle(s) && count(s, answer) > answersBefore,
      TURN_MS,
    );
    details.answerLane = "main";
    details.threadHasAnswer = has(await bridge.side(from, side.id), answer);
    assert.equal(details.threadHasAnswer, false, "The archived side thread also shows the answer.");
  });

  await step("notice and request steer the recipient's running turn", async (details) => {
    const provider = toAgentInfo.provider;
    if (!isAgentProvider(provider) || agentProviderDescriptor(provider).steer !== "native") {
      details.skipped = `${provider} cannot steer a running turn.`;
      return;
    }
    const word = `M13${run}`;
    const notice = `N13${run}`;
    const start = `S13${run}`;
    const personNotice = `P13${run}`;
    const personSlept = `PSLEPT13${run}`;
    const settings = await page.evaluate((agentId) => window.openbot.agent.getAgentHostSettings(agentId), to);
    const mode = (busyMessageMode: "steer" | "queue" | null) =>
      page.evaluate((input) => window.openbot.agent.updateAgentHostSettings(input), {
        agentId: to,
        busyMessageMode,
      });
    const fromA = async (text: string) => {
      const queue = await page.evaluate((agentId) => window.openbot.agent.listQueue(agentId), to);
      return queue.deliveries.find((entry) => entry.sender.kind === "agent" && entry.text.includes(text)) ?? null;
    };
    const sendFromA = (text: string) =>
      bridge.send(
        from,
        [
          `Use openbot.send_message to send ${toAgentInfo.name} (agent id "${to}") this message, with expectsReply false:`,
          `"${text}"`,
          "Then end your turn and reply with the single word SENT.",
        ].join("\n"),
      );
    await waitFor(page, "B's own chat is idle", () => bridge.main(to), idle, TURN_MS);
    await page.evaluate((agentId) => window.openbot.agent.clearContext(agentId), to);
    await mode("steer");
    try {
      await bridge.send(to, `First ${busyFor(120)}, then reply with the single word ${personSlept}.`);
      const personBusy = await waitFor(
        page,
        "B's own chat runs the person's turn",
        () => bridge.main(to),
        (s) => !idle(s),
        TURN_MS,
      );
      const personTurnId = personBusy.activeTurnId;
      await sendFromA(`${personNotice}: For your information, the build number is 12. No answer is necessary.`);
      await waitFor(page, "A's own chat is idle", () => bridge.main(from), idle, TURN_MS);
      const waiting = await fromA(personNotice);
      details.personTurnStillRuns = (await bridge.main(to)).activeTurnId === personTurnId;
      details.personNoticeStatus = waiting?.status ?? null;
      assert.equal(details.personTurnStillRuns, true, "B's turn ended before A sent the notice.");
      assert.equal(details.personNoticeStatus, "queued", "The notice joined the person's running turn.");
      await waitFor(page, "B's person turn ends", () => bridge.main(to), idle, TURN_MS);
      const noticeTurn = (s: ConversationSnapshot) =>
        s.messages.find((m) => m.senderAgentId === from && m.text.includes(personNotice))?.turnId ?? null;
      const after = await waitFor(
        page,
        "the notice runs in a turn of B",
        () => bridge.main(to),
        (s) => noticeTurn(s) !== null,
        TURN_MS,
      );
      details.personNoticeTurnId = noticeTurn(after);
      assert.notEqual(details.personNoticeTurnId, personTurnId, "The notice ran in the person's turn.");
      await waitFor(page, "B's own chat is idle again", () => bridge.main(to), idle, TURN_MS);

      await page.evaluate((agentId) => window.openbot.agent.clearContext(agentId), to);
      await bridge.send(
        from,
        [
          `Use openbot.send_message to send ${toAgentInfo.name} (agent id "${to}") this request, with expectsReply true:`,
          `"${start}: Please check that the local network stays up for two minutes: ${busyFor(120)}. Then send me only the packet loss percentage."`,
          "Then end your turn and reply with the single word SENT. Do not wait for the answer.",
        ].join("\n"),
      );
      const started = await waitFor(
        page,
        "A's message starts B's turn",
        () => fromA(start),
        (entry) => entry !== null && entry.status !== "queued" && Boolean(entry.turnId),
        TURN_MS,
      );
      const turnId = started?.turnId;
      await waitFor(page, "A's own chat is idle", () => bridge.main(from), idle, TURN_MS);
      await sendFromA(`${notice}: For your information, the build number is 14. No answer is necessary.`);
      const joined = await waitFor(
        page,
        "the notice leaves B's queue",
        () => fromA(notice),
        (entry) => entry !== null && entry.status !== "queued",
        TURN_MS,
      );
      details.noticeStatus = joined?.status;
      details.noticeSteerFallback = joined?.steerFallback ?? null;
      details.noticeJoinedRunningTurn = joined?.turnId === turnId;
      assert.equal(details.noticeJoinedRunningTurn, true, "The notice waited for a new turn of B.");
      await waitFor(page, "A's own chat is idle", () => bridge.main(from), idle, TURN_MS);
      const startId = (await bridge.main(to)).messages.find((m) => m.text.includes(start))?.id;
      const result = (m: ConversationMessage) =>
        m.senderAgentId === to &&
        (startId === undefined || m.replyToMessageId !== startId) &&
        m.text.replaceAll(run, "").includes("17");
      const resultsBefore = count(await bridge.main(from), result);
      details.turnRunsBeforeRequest = (await bridge.main(to)).activeTurnId === turnId;
      assert.equal(details.turnRunsBeforeRequest, true, "B's turn ended before A sent the request.");
      await bridge.send(from, ask(word, "What is 9+8?", toAgentInfo.name));
      const joinedRequest = await waitFor(
        page,
        "the request leaves B's queue",
        () => fromA(word),
        (entry) => entry !== null && entry.status !== "queued",
        TURN_MS,
      );
      details.requestStatus = joinedRequest?.status;
      details.requestJoinedRunningTurn = joinedRequest?.turnId === turnId;
      assert.equal(details.requestJoinedRunningTurn, true, "The request waited for a new turn of B.");
      await waitFor(page, "B's turn ends", () => bridge.main(to), idle, TURN_MS);
      await waitFor(
        page,
        "A gets the result in its own chat",
        () => bridge.main(from),
        (s) => count(s, result) > resultsBefore,
        TURN_MS,
      );
      details.resultInSenderChat = true;
      await waitFor(page, "A's own chat is idle at the end", () => bridge.main(from), idle, TURN_MS);
      await waitFor(page, "B's own chat is idle at the end", () => bridge.main(to), idle, TURN_MS);
    } finally {
      await mode(settings.busyMessageMode);
    }
  });
  await step("question back without replyToMessageId", async (details) => {
    const word = `M14${run}`;
    const question = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes(`Q14${run}`);
    const answer = (m: ConversationMessage) =>
      m.senderAgentId === to && !question(m) && m.text.replaceAll(run, "").includes("11");
    const questionsBefore = count(await bridge.main(from), question);
    const answersBefore = count(await bridge.main(from), answer);
    const side = await bridge.startTask(
      from,
      [
        `Use openbot.send_message to send ${toAgentInfo.name} (agent id "${to}") this message, with expectsReply true:`,
        `"${word}: Before you answer, ask me which two numbers to add. Ask with openbot.send_message as a new message:`,
        `recipientAgentIds ["${from}"], no replyToMessageId, expectsReply true, and text that starts with Q14${run}.`,
        "Then end your turn. When I give you the numbers, send me only their sum with openbot.send_message,",
        'no replyToMessageId."',
        `When ${toAgentInfo.name} asks which numbers, answer "5 and 6" with openbot.send_message, replyToMessageId`,
        "and expectsReply false.",
        "Then end your turn and reply with the single word SENT. Do not wait for the answer.",
      ].join("\n"),
    );
    details.taskId = side.id;
    const asked = await waitFor(
      page,
      "the question comes to the side thread",
      () => bridge.side(from, side.id),
      (s) => has(s, question),
      TURN_MS,
    );
    details.questionReplyTo = asked.messages.find(question)?.replyToMessageId ?? null;
    assert.equal(details.questionReplyTo, null, "B sent the question with replyToMessageId.");
    await waitFor(
      page,
      "the answer comes to the side thread",
      () => bridge.side(from, side.id),
      (s) => has(s, answer),
      TURN_MS,
    );
    await waitFor(
      page,
      "the side thread reads it",
      () => task(from, side.id),
      (e) => e?.state === "idle",
      TURN_MS,
    );
    const numbers = (await bridge.main(to)).messages.findLast(
      (m) => m.senderAgentId === from && m.text.includes("5 and 6"),
    );
    details.numbersExpectReply = numbers?.exchange?.expectsReply ?? true;
    details.sumReplyTo = (await bridge.side(from, side.id)).messages.find(answer)?.replyToMessageId ?? null;
    assert.equal(details.numbersExpectReply, false, "A sent the numbers with expectsReply true.");
    assert.equal(details.sumReplyTo, null, "B sent the sum with replyToMessageId.");
    const ownChat = await bridge.main(from);
    details.questionInSenderChat = count(ownChat, question) > questionsBefore;
    details.answerInSenderChat = count(ownChat, answer) > answersBefore;
    assert.equal(details.questionInSenderChat, false, "A's own chat got the question to its side thread.");
    assert.equal(details.answerInSenderChat, false, "A's own chat got the answer to its side thread.");
  });
  await step("new message after a side thread's notice goes to the own chat", async (details) => {
    const notice = `N15${run}`;
    const marker = `R15${run}`;
    const request = (m: ConversationMessage) => m.senderAgentId === from && m.text.includes(marker);
    const answersBefore = count(await bridge.main(from), (m) => m.author === "assistant");
    await bridge.send(
      from,
      [
        `When ${toAgentInfo.name} sends you a message that starts with ${notice}, send ${toAgentInfo.name}`,
        `(agent id "${to}") a new message with openbot.send_message: no replyToMessageId, expectsReply false,`,
        `and text that starts with ${marker}. Now reply with the single word OK.`,
      ].join("\n"),
    );
    await waitFor(
      page,
      "A reads the instruction",
      () => bridge.main(from),
      (s) => idle(s) && count(s, (m) => m.author === "assistant") > answersBefore,
      TURN_MS,
    );
    const side = await bridge.startTask(
      to,
      [
        `Use openbot.send_message to send ${fromAgentInfo.name} (agent id "${from}") the message "${notice}",`,
        "with expectsReply false. Then end your turn and reply with the single word SENT.",
      ].join("\n"),
    );
    details.taskId = side.id;
    const [ownChat, sideThread] = await waitFor(
      page,
      "A's new message comes to B",
      () => Promise.all([bridge.main(to), bridge.side(to, side.id)]),
      (snapshots) => snapshots.some((s) => has(s, request)),
      TURN_MS,
    );
    const sent = [...ownChat.messages, ...sideThread.messages].find(request);
    details.requestReplyTo = sent?.replyToMessageId ?? null;
    assert.equal(details.requestReplyTo, null, "A sent the new message with replyToMessageId.");
    const received = (await bridge.main(from)).messages.find((m) => m.senderAgentId === to && m.text.includes(notice));
    details.noticeExpectsReply = received?.exchange?.expectsReply ?? true;
    assert.equal(details.noticeExpectsReply, false, "B sent the notice with expectsReply true.");
    details.requestInOwnChat = has(ownChat, request);
    details.requestInSideThread = has(sideThread, request);
    assert.equal(details.requestInSideThread, false, "B's side thread got A's new message.");
    assert.equal(details.requestInOwnChat, true, "B's own chat did not get A's new message.");
  });
  await step("answer steers the side thread's running turn", async (details) => {
    const provider = fromAgentInfo.provider;
    if (!isAgentProvider(provider) || agentProviderDescriptor(provider).steer !== "native") {
      details.skipped = `${provider} cannot steer a running turn.`;
      return;
    }
    const first = `M16${run}`;
    const second = `L16${run}`;
    const settings = await page.evaluate((agentId) => window.openbot.agent.getAgentHostSettings(agentId), from);
    const mode = (busyMessageMode: "steer" | "queue" | null) =>
      page.evaluate((input) => window.openbot.agent.updateAgentHostSettings(input), {
        agentId: from,
        busyMessageMode,
      });
    const answersFromB = (snapshot: ConversationSnapshot) =>
      snapshot.messages.filter((m) => m.senderAgentId === to && Boolean(m.turnId));
    const secondAnswer = (m: ConversationMessage) =>
      m.senderAgentId === to && m.text.replaceAll(run, "").includes("10");
    const answersBefore = count(await bridge.main(from), secondAnswer);
    await mode("steer");
    try {
      const side = await bridge.startTask(
        from,
        [
          `Use openbot.send_message to send ${toAgentInfo.name} (agent id "${to}") this message, with expectsReply true:`,
          `"${first}: What is 2+2? Answer with only the number."`,
          `When the answer comes, send ${toAgentInfo.name} this second message with openbot.send_message, expectsReply true:`,
          `"${second}: First ${busyFor(20)}. Then answer: what is 5+5? Answer with only the number."`,
          `Right after you send it, ${busyFor(150)}, then reply with the single word DONE.`,
          "Now end your turn and reply with the single word SENT. Do not wait for the answer.",
        ].join("\n"),
      );
      details.taskId = side.id;
      const [firstAnswer] = answersFromB(
        await waitFor(
          page,
          "B's first answer starts a side thread turn of A",
          () => bridge.side(from, side.id),
          (s) => answersFromB(s).length > 0,
          TURN_MS,
        ),
      );
      const turnId = firstAnswer?.turnId;
      details.sideTurnId = turnId ?? null;
      await waitFor(
        page,
        "B gets the second request",
        () => bridge.main(to),
        (s) => has(s, fromAgent(from, second)),
        TURN_MS,
      );
      const later = await waitFor(
        page,
        "B's second answer reaches the side thread",
        async () => answersFromB(await bridge.side(from, side.id)).find((m) => m.id !== firstAnswer?.id),
        (m) => m !== undefined,
        TURN_MS,
      );
      details.sideTurnStillRan = (await task(from, side.id))?.state === "running";
      details.secondAnswerTurnId = later?.turnId ?? null;
      details.secondAnswerJoinedSideTurn = later?.turnId === turnId;
      assert.equal(details.secondAnswerJoinedSideTurn, true, "The answer waited for a new turn of the side thread.");
      details.secondAnswerInSenderChat = count(await bridge.main(from), secondAnswer) > answersBefore;
      assert.equal(details.secondAnswerInSenderChat, false, "A's own chat got the answer to its side thread.");
      await bridge.stop(from, side.id);
      await waitFor(
        page,
        "the side thread stops",
        () => task(from, side.id),
        (entry) => entry?.state !== "running",
        TURN_MS,
      );
    } finally {
      await mode(settings.busyMessageMode);
    }
  });

  await step("a thread's attached file shows in the own chat", async (details) => {
    const title = `Smoke file ${run}`;
    const name = `task-file-${run}.txt`;
    const filed = `FILED${run}`;
    const fileRow = (m: ConversationMessage) =>
      m.author === "assistant" && (m.attachments ?? []).some((attachment) => attachment.name === name);
    await bridge.send(
      from,
      `Call openbot.start_task with the title "${title}" and the brief "Write the text ${filed} to the file ${name} in your working directory, attach it with openbot.attach_files_to_response, then reply with the single word ${filed}." Then reply with the single word STARTED.`,
    );
    const created = await waitFor(
      page,
      "the thread starts",
      async () => (await bridge.tasks(from)).find((entry) => entry.title === title),
      Boolean,
      TURN_MS,
    );
    assert.ok(created);
    started.push({ agentId: from, taskId: created.id });
    const thread = await waitFor(
      page,
      "the thread attaches the file",
      () => bridge.side(from, created.id),
      (s) => idle(s) && has(s, fileRow) && has(s, answerWith(filed)),
      TURN_MS,
    );
    const main = await waitFor(
      page,
      "the own chat gets the report and ends its turn",
      () => bridge.main(from),
      (s) => idle(s) && has(s, (m) => m.exchange?.senderTaskId === created.id),
      TURN_MS,
    );
    const copies = main.messages.filter(fileRow);
    const reportIndex = main.messages.findIndex((m) => m.exchange?.senderTaskId === created.id);
    const copyIndex = main.messages.findIndex(fileRow);
    details.threadFileRows = count(thread, fileRow);
    details.ownChatFileRows = copies.length;
    details.copyBeforeReport = copyIndex >= 0 && copyIndex < reportIndex;
    details.copyHasOwnFile = copies.every((copy) =>
      (copy.attachments ?? []).every((attachment) =>
        thread.messages.every((m) => (m.attachments ?? []).every((source) => source.id !== attachment.id)),
      ),
    );
    assert.equal(details.ownChatFileRows, 1, "The own chat does not show the thread's file once.");
    assert.equal(details.copyBeforeReport, true, "The file copy is not before the task report.");
    assert.equal(details.copyHasOwnFile, true, "The own chat shows the thread's file, not a copy.");
  });
  report.passed = report.steps.every((entry) => entry.passed);
} finally {
  for (const { agentId, taskId } of started.reverse()) {
    await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId }).catch(() => undefined);
    await waitFor(
      page,
      "the cleanup stop",
      () => task(agentId, taskId),
      (entry) => entry?.state !== "running",
      30_000,
    ).catch(() => undefined);
    await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId }).catch(() => undefined);
  }
  writeReport("agent-threads-messaging-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
