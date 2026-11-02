// Checks messages between agents and provider subagents together with side threads, in this worktree's
// running dev app, through the preload bridge, agent service and a real provider. It changes the data
// of the profile, so start the app with `bun run dev` (never `--shared`), and pass two agents whose
// provider is signed in and runs turns at the same time. Subagent checks need Claude agents:
// `bun scripts/agent-threads-messaging-e2e.ts --allow-mutations --from=<agent id> --to=<agent id>`.
//
// 1. From the agent's own chat, A asks B. B answers in its own chat, and the answer comes back to A's
//    own chat. No thread starts.
// 2. From a side thread, A asks B. The request arrives in B's own chat, and B answers there. The answer
//    comes back to A's side thread, and A's own chat shows neither the request nor the answer.
// 3. B runs a long turn in a side thread when A asks it. B answers in its own chat while the side
//    thread still runs, and neither conversation gets the other's messages.
// 4. A starts a thread with `start_task` from its own chat. The thread runs the brief; the own chat
//    gets neither the brief nor the thread's answer, also after the thread is deleted.
// 5. In a side thread, `start_task` and `start_new_chat` are refused: no thread starts and the own
//    chat keeps its messages.
// 6. A's side thread is archived while B is busy. B's answer then comes to A's own chat, and the
//    reopened side thread does not get it again.
// 7. With `--also=<agent id>`, a side thread asks B and C in one message. Both answers come back to
//    the side thread.
// 8. A deletes a side thread after B's answer. B's own chat keeps the request and the answer, and A's
//    own chat does not get them.
// 9. A Claude subagent in a side thread shows in that thread only.
// 10. A background Claude subagent in a side thread ends after its turn. Its answer comes back to that
//    side thread, not to the agent's own chat.
// 11. B's answer waits in A's running side thread, and A stops the thread. The Stop does not cancel
//    the answer: it runs next in the side thread, and A's own chat does not get it.
// 12. The same, but A archives the side thread. The answer goes to A's own chat.
// 13. B steers busy messages and runs a turn in a new own chat when A asks it. The request goes into
//    that running turn, not into a new one. It needs a provider that steers natively.
// At the end it stops and deletes each thread that it started.
// Writes .openbot-build/agent-threads-messaging-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentTask, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const fromArgument = argument("from");
const toArgument = argument("to");
assert.ok(fromArgument && toArgument, "Pass --from=<agent id> and --to=<agent id> of two signed-in agents.");
const from: string = fromArgument;
const to: string = toArgument;
/** `--also=<agent id>`: a third agent, for the request to two agents. */
const also = argument("also");
const run = crypto.randomUUID().slice(0, 6);
const TURN_MS = 240_000;
/** `--only=3,5` runs only those steps. */
const only = argument("only")?.split(",").map(Number);

/** What a step saw, for the report. */
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
/** Earlier runs leave answers with the same numbers in both chats; steps count only the new ones. */
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

/**
 * Keeps a turn busy for `seconds`. Claude Code refuses a standalone foreground `sleep`, and after one
 * refusal a chat also refuses other waits, so the command is a ping, which works for the stated time.
 */
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
  // 1. Own chat to own chat.
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

  // 2. Side thread to own chat, and the answer back to the side thread.
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

  // 3. The recipient is busy in a side thread.
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
    // A timeline of B's two lanes, in milliseconds from the request, with the side thread's state.
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

  // 4. The agent starts a thread.
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

  // 5. Refusals in a side thread.
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

  // 6. The side thread is archived before the answer comes, and opened again.
  await step("answer after the side thread is archived", async (details) => {
    const word = `M6${run}`;
    const busy = `BUSY${run}`;
    const answer = (m: ConversationMessage) => m.senderAgentId === to && m.text.includes("14");
    const answersBefore = count(await bridge.main(from), answer);
    // B's own chat is busy, so A's request waits there while A archives the side thread.
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

  // 7. From a side thread, A asks B and C together. Both answers come back to the side thread.
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
    // The later steps keep their numbers for `--only`.
  } else stepNumber += 1;

  // 8. A thread delete keeps the request and the answer in B's own chat.
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
    // 9. A subagent in a side thread.
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

    // 10. A background subagent ends after its side thread's turn.
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

  // 11. A Stop of the side thread does not cancel a teammate's answer that waits in it.
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

  // 12. An archive of the side thread moves a teammate's waiting answer to the own chat.
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

  // 13. A request steers the running turn of a recipient that steers busy messages.
  await step("request steers the recipient's running turn", async (details) => {
    const provider = toAgentInfo.provider;
    if (!isAgentProvider(provider) || agentProviderDescriptor(provider).steer !== "native") {
      details.skipped = `${provider} cannot steer a running turn.`;
      return;
    }
    const word = `M13${run}`;
    const slept = `SLEPT13${run}`;
    const settings = await page.evaluate((agentId) => window.openbot.agent.getAgentHostSettings(agentId), to);
    const mode = (busyMessageMode: "steer" | "queue" | null) =>
      page.evaluate((input) => window.openbot.agent.updateAgentHostSettings(input), {
        agentId: to,
        busyMessageMode,
      });
    // A new chat, so a wait that B refused earlier in its own chat does not make it refuse this one.
    await waitFor(page, "B's own chat is idle", () => bridge.main(to), idle, TURN_MS);
    await page.evaluate((agentId) => window.openbot.agent.clearContext(agentId), to);
    await mode("steer");
    try {
      await bridge.send(to, `First ${busyFor(60)}, then reply with the single word ${slept}.`);
      const busy = await waitFor(
        page,
        "B's own chat runs",
        () => bridge.main(to),
        (s) => !idle(s),
        TURN_MS,
      );
      const turnId = busy.activeTurnId;
      await bridge.send(from, ask(word, "What is 7+7?", toAgentInfo.name));
      const delivery = await waitFor(
        page,
        "the request leaves B's queue",
        async () => {
          const queue = await page.evaluate((agentId) => window.openbot.agent.listQueue(agentId), to);
          return queue.deliveries.find((entry) => entry.sender.kind === "agent" && entry.text.includes(word)) ?? null;
        },
        (entry) => entry !== null && entry.status !== "queued",
        TURN_MS,
      );
      details.deliveryStatus = delivery?.status;
      details.steerFallback = delivery?.steerFallback ?? null;
      details.steeredIntoRunningTurn = delivery?.turnId === turnId;
      const main = await bridge.main(to);
      details.turnStillRan = main.activeTurnId === turnId;
      assert.equal(details.steeredIntoRunningTurn, true, "The request waited for a new turn of B.");
      await waitFor(page, "B's turn ends", () => bridge.main(to), idle, TURN_MS);
    } finally {
      await mode(settings.busyMessageMode);
    }
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
