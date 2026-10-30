import {
  AGENT_EXCHANGE_ITEM_TYPE,
  type ClientAgentSummary,
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
  conversationPlanText,
  conversationSubagentsText,
  type DirectMessage,
  type QueueDelivery,
} from "@openbot/contracts/ipc";
import {
  LANDING_DEMO_SCENES,
  LANDING_DIRECT_DEMO_SCRIPTS,
  LANDING_DIRECT_SCRIPT_MESSAGE_PREFIX,
  LANDING_SCRIPT_MESSAGE_PREFIX,
  LANDING_TYPED_REPLIES,
  type LandingDemoScene,
  type LandingDirectDemoScript,
  type LandingPromptAnswers,
  type LandingSceneStep,
} from "./landing-demo-scripts";
import { LANDING_CONTEXT_TOKENS, LANDING_LEAD_AGENT_ID, landingRuntimeSnapshot } from "./landing-fixtures";
import type { MockOpenBotControls, MockSentMessage } from "./mock-openbot";

interface LandingDemoControllerOptions {
  agents: readonly ClientAgentSummary[];
  reducedMotion?: boolean;
  scenes?: Record<string, LandingDemoScene>;
  directScripts?: Record<string, LandingDirectDemoScript>;
}

type Timer = ReturnType<typeof setTimeout>;

interface SceneRun {
  runId: number;
  agentId: string;
  /** False for the reply to a message that the visitor typed. */
  scripted: boolean;
  steps: LandingSceneStep[];
  turnId: string;
  turnActive: boolean;
  timers: Set<Timer>;
  touchedAgentIds: Set<string>;
  /** The turn of each teammate that works on the lead's message. */
  backgroundTurns: Map<string, string>;
  exchangeId: string | null;
  subagentStarts: Map<string, string>;
  prompt: { requestId: string; resume: (answers: LandingPromptAnswers) => void } | null;
  answers: LandingPromptAnswers;
  answerId: string | null;
  /** True when the steps run at once: with reduced motion, or after the visitor leaves the chat. */
  instant: boolean;
  /** The index of the first step that has not started. */
  nextStep: number;
  /** Ends the step that holds the scene now: answers the question or ends the stream. */
  settle: (() => void) | null;
}

interface DirectScriptRun {
  memberId: string;
  timers: Set<Timer>;
  typing: boolean;
}

type SelectedConversation = { kind: "agent"; id: string } | { kind: "direct"; id: string };

const STREAM_CHUNK_SIZE = 24;
const STREAM_CHUNK_DELAY_MS = 45;
const SCENE_END_DELAY_MS = 300;

function runPrefix(runId: number): string {
  return `${LANDING_SCRIPT_MESSAGE_PREFIX}${runId}:`;
}

function isDirectScriptMessage(message: DirectMessage): boolean {
  return message.id.startsWith(LANDING_DIRECT_SCRIPT_MESSAGE_PREFIX);
}

function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += STREAM_CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + STREAM_CHUNK_SIZE));
  }
  return chunks;
}

function isBarrier(step: LandingSceneStep): boolean {
  return step.kind === "prompt" || step.kind === "answer";
}

/**
 * Plays the home page demo on the preview mock. Each agent has one scene that plays the first time
 * the visitor opens it. Opening another conversation ends the scene at once, so the visitor finds it
 * complete on return. A message that the visitor types stops the scene and removes what it added.
 */
export function createLandingDemoController(
  mock: MockOpenBotControls,
  options: LandingDemoControllerOptions,
): { activate: () => void; dispose: () => void } {
  const scenes = options.scenes ?? LANDING_DEMO_SCENES;
  const directScripts = options.directScripts ?? LANDING_DIRECT_DEMO_SCRIPTS;
  const instant = options.reducedMotion === true;
  const contextTokens: Record<string, number> = Object.fromEntries(
    Object.entries(LANDING_CONTEXT_TOKENS).map(([agentId, tokens]) => [agentId, tokens.before]),
  );
  const playedScenes = new Set<string>();
  const playedDirectScripts = new Set<string>();
  let activated = false;
  let disposed = false;
  let selectedConversation: SelectedConversation | null = null;
  let activeRun: SceneRun | null = null;
  let activeDirectRun: DirectScriptRun | null = null;
  let runCounter = 0;

  const now = () => new Date().toISOString();
  const threadIdOf = (agentId: string) => mock.readConversationSnapshot(agentId).threadId ?? `thread-${agentId}`;

  function clearRunTimers(run: { timers: Set<Timer> }): void {
    for (const timer of run.timers) clearTimeout(timer);
    run.timers.clear();
  }

  function schedule(run: SceneRun, callback: () => void, delay: number): void {
    if (run.instant) {
      if (!disposed && activeRun === run) callback();
      return;
    }
    const timer = setTimeout(() => {
      run.timers.delete(timer);
      if (disposed || activeRun !== run) return;
      callback();
    }, delay);
    run.timers.add(timer);
  }

  function scheduleDirect(run: DirectScriptRun, callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      run.timers.delete(timer);
      if (disposed || activeDirectRun !== run) return;
      callback();
    }, delay);
    run.timers.add(timer);
  }

  function messageId(run: SceneRun, part: string): string {
    return `${runPrefix(run.runId)}${part}`;
  }

  /** Adds the message, or replaces the one with the same id. */
  function putMessage(run: SceneRun, agentId: string, message: ConversationMessage): void {
    run.touchedAgentIds.add(agentId);
    mock.updateConversationSnapshot(agentId, (snapshot) => {
      const index = snapshot.messages.findIndex((candidate) => candidate.id === message.id);
      snapshot.messages =
        index < 0
          ? [...snapshot.messages, message]
          : snapshot.messages.map((candidate, position) => (position === index ? message : candidate));
    });
  }

  function updateMessage(
    agentId: string,
    id: string,
    update: (message: ConversationMessage) => ConversationMessage,
  ): void {
    mock.updateConversationSnapshot(agentId, (snapshot) => {
      snapshot.messages = snapshot.messages.map((message) => (message.id === id ? update(message) : message));
    });
  }

  function emitTurnStarted(agentId: string, turnId: string): void {
    mock.emitAgentEvent({ type: "turn-started", agentId, threadId: threadIdOf(agentId), turnId });
  }

  function emitTurnCompleted(agentId: string, turnId: string, status: "completed" | "interrupted"): void {
    mock.emitAgentEvent({ type: "turn-completed", agentId, threadId: threadIdOf(agentId), turnId, status });
  }

  function completeMainTurn(run: SceneRun): void {
    if (!run.turnActive) return;
    run.turnActive = false;
    mock.updateConversationSnapshot(run.agentId, (snapshot) => {
      snapshot.activeTurnId = null;
    });
    mock.setQueueSnapshot(run.agentId, []);
    emitTurnCompleted(run.agentId, run.turnId, "completed");
  }

  function startUserTurn(run: SceneRun, text: string): void {
    const user: ConversationMessage = {
      id: messageId(run, "user"),
      turnId: run.turnId,
      author: "user",
      source: "user",
      text,
      createdAt: now(),
      status: "completed",
    };
    const delivery: QueueDelivery = {
      id: messageId(run, "queue"),
      messageId: user.id,
      recipientAgentId: run.agentId,
      sender: { kind: "user" },
      text,
      attachments: [],
      replyToMessageId: null,
      status: "running",
      position: null,
      turnId: run.turnId,
      error: null,
      createdAt: user.createdAt,
    };
    run.touchedAgentIds.add(run.agentId);
    mock.updateConversationSnapshot(run.agentId, (snapshot) => {
      snapshot.activeTurnId = run.turnId;
      snapshot.messages = [...snapshot.messages, user];
    });
    mock.setQueueSnapshot(run.agentId, [delivery]);
    run.turnActive = true;
    emitTurnStarted(run.agentId, run.turnId);
  }

  function sendExchange(run: SceneRun, text: string, recipientAgentIds: string[]): void {
    const exchangeId = messageId(run, "exchange");
    run.exchangeId = exchangeId;
    const deliveries = recipientAgentIds.map((recipientAgentId) => ({
      id: messageId(run, `delivery:${recipientAgentId}`),
      recipientAgentId,
      status: "running" as const,
      position: null,
      error: null,
    }));
    const createdAt = now();
    putMessage(run, run.agentId, {
      id: exchangeId,
      turnId: run.turnId,
      author: "system",
      source: "system",
      text,
      createdAt,
      status: "completed",
      itemType: AGENT_EXCHANGE_ITEM_TYPE,
      exchange: {
        direction: "outgoing",
        messageId: exchangeId,
        senderAgentId: run.agentId,
        recipientAgentIds,
        replyToMessageId: null,
        deliveries,
      },
    });
    for (const delivery of deliveries) {
      const recipientId = delivery.recipientAgentId;
      const turnId = messageId(run, `turn:${recipientId}`);
      run.backgroundTurns.set(recipientId, turnId);
      run.touchedAgentIds.add(recipientId);
      mock.updateConversationSnapshot(recipientId, (snapshot) => {
        snapshot.activeTurnId = turnId;
        snapshot.messages = [
          ...snapshot.messages,
          {
            id: delivery.id,
            turnId,
            author: "agent",
            source: "agent",
            text,
            senderAgentId: run.agentId,
            createdAt,
            status: "completed",
            itemType: AGENT_EXCHANGE_ITEM_TYPE,
            delivery: { id: delivery.id, status: "running", position: null },
            exchange: {
              direction: "incoming",
              messageId: exchangeId,
              senderAgentId: run.agentId,
              recipientAgentIds,
              replyToMessageId: null,
              deliveries,
            },
          },
        ];
      });
      emitTurnStarted(recipientId, turnId);
    }
  }

  function receiveTeammateReply(run: SceneRun, step: Extract<LandingSceneStep, { kind: "teammate-reply" }>): void {
    const turnId = run.backgroundTurns.get(step.agentId);
    const createdAt = now();
    run.touchedAgentIds.add(step.agentId);
    mock.updateConversationSnapshot(step.agentId, (snapshot) => {
      snapshot.activeTurnId = null;
      snapshot.messages = [
        ...snapshot.messages,
        {
          id: messageId(run, `answer:${step.agentId}`),
          turnId,
          author: "assistant",
          source: "assistant",
          itemType: "final_answer",
          text: step.answer,
          createdAt,
          status: "completed",
          ...(step.attachments ? { attachments: step.attachments } : {}),
        },
      ];
    });
    if (turnId) {
      run.backgroundTurns.delete(step.agentId);
      emitTurnCompleted(step.agentId, turnId, "completed");
    }
    const exchangeId = run.exchangeId;
    if (exchangeId) {
      updateMessage(run.agentId, exchangeId, (message) =>
        message.exchange
          ? {
              ...message,
              exchange: {
                ...message.exchange,
                deliveries: message.exchange.deliveries.map((delivery) =>
                  delivery.recipientAgentId === step.agentId ? { ...delivery, status: "completed" } : delivery,
                ),
              },
            }
          : message,
      );
    }
    const replyId = messageId(run, `reply:${step.agentId}`);
    putMessage(run, run.agentId, {
      id: replyId,
      turnId: run.turnId,
      author: "agent",
      source: "agent",
      text: step.summary,
      senderAgentId: step.agentId,
      createdAt,
      status: "completed",
      itemType: AGENT_EXCHANGE_ITEM_TYPE,
      delivery: { id: replyId, status: "completed", position: null },
      exchange: {
        direction: "incoming",
        messageId: replyId,
        senderAgentId: step.agentId,
        recipientAgentIds: [run.agentId],
        replyToMessageId: exchangeId,
        deliveries: [{ id: replyId, recipientAgentId: run.agentId, status: "completed", position: null, error: null }],
      },
    });
  }

  function askPrompt(run: SceneRun, step: Extract<LandingSceneStep, { kind: "prompt" }>, done: () => void): void {
    const requestId = messageId(run, "prompt");
    const resolve = (answers: LandingPromptAnswers) => {
      if (!run.instant && run.prompt?.requestId !== requestId) return;
      run.prompt = null;
      run.settle = null;
      run.answers = answers;
      putMessage(run, run.agentId, {
        id: requestId,
        turnId: run.turnId,
        author: "assistant",
        source: "assistant",
        itemType: "question_prompt",
        text: step.questions.map((question) => question.question).join("\n"),
        createdAt: now(),
        status: "completed",
        questionPrompt: {
          requestId,
          questions: step.questions,
          resolution: {
            status: "answered",
            responses: Object.fromEntries(
              step.questions.map((question) => [
                question.id,
                { status: "answered", answers: answers[question.id] ?? [] },
              ]),
            ),
          },
        },
      });
      mock.emitAgentEvent({ type: "agent-input-resolved", kind: "prompt", requestId, agentId: run.agentId });
      done();
    };
    if (run.instant) {
      resolve(step.autoAnswers);
      return;
    }
    run.prompt = { requestId, resume: resolve };
    run.settle = () => resolve(step.autoAnswers);
    mock.emitAgentEvent({
      type: "prompt",
      requestId,
      agentId: run.agentId,
      threadId: threadIdOf(run.agentId),
      turnId: run.turnId,
      questions: step.questions,
    });
    schedule(run, () => resolve(step.autoAnswers), step.autoAnswerAfter);
  }

  function streamAnswer(run: SceneRun, step: Extract<LandingSceneStep, { kind: "answer" }>, done: () => void): void {
    const id = messageId(run, "answer");
    const text = typeof step.text === "function" ? step.text(run.answers) : step.text;
    const finish = () => {
      run.settle = null;
      run.answerId = id;
      putMessage(run, run.agentId, {
        id,
        turnId: run.turnId,
        author: "assistant",
        source: "assistant",
        itemType: "final_answer",
        text,
        createdAt: now(),
        status: "completed",
        ...(step.attachments ? { attachments: step.attachments } : {}),
      });
      completeMainTurn(run);
      done();
    };
    if (run.instant) {
      finish();
      return;
    }
    run.settle = finish;
    const chunks = splitIntoChunks(text);
    let index = 0;
    const streamNext = () => {
      const delta = chunks[index];
      if (delta === undefined) {
        finish();
        return;
      }
      mock.emitConversationDelta({
        agentId: run.agentId,
        threadId: threadIdOf(run.agentId),
        turnId: run.turnId,
        messageId: id,
        delta,
        createdAt: now(),
      });
      index += 1;
      schedule(run, streamNext, STREAM_CHUNK_DELAY_MS);
    };
    streamNext();
  }

  function runStep(run: SceneRun, step: LandingSceneStep, done: () => void): void {
    switch (step.kind) {
      case "user":
        startUserTurn(run, step.text);
        return;
      case "progress":
        if (!run.instant && run.turnActive) {
          mock.emitAgentEvent({
            type: "turn-progress",
            agentId: run.agentId,
            threadId: threadIdOf(run.agentId),
            turnId: run.turnId,
            detail: step.detail,
          });
        }
        return;
      case "commentary":
        putMessage(run, run.agentId, {
          id: messageId(run, `commentary:${step.at}`),
          turnId: run.turnId,
          author: "assistant",
          source: "assistant",
          itemType: "commentary",
          text: step.text,
          createdAt: now(),
          status: "completed",
        });
        return;
      case "memory":
        putMessage(run, run.agentId, {
          id: messageId(run, "memory"),
          turnId: run.turnId,
          author: "system",
          source: "system",
          itemType: CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
          text: "Memory: 1 saved, 0 updated, 0 forgotten.",
          createdAt: now(),
          status: "completed",
          memoryChanges: [{ memoryId: messageId(run, "memory"), action: "saved", text: step.text }],
        });
        return;
      case "plan":
        putMessage(run, run.agentId, {
          id: messageId(run, "plan"),
          turnId: run.turnId,
          author: "assistant",
          source: "assistant",
          itemType: CONVERSATION_PLAN_ITEM_TYPE,
          text: conversationPlanText(step.plan),
          plan: step.plan,
          createdAt: now(),
          status: "completed",
        });
        return;
      case "subagents": {
        const subagents = step.subagents.map((subagent) => {
          const startedAt = run.subagentStarts.get(subagent.id) ?? now();
          run.subagentStarts.set(subagent.id, startedAt);
          return { ...subagent, startedAt, endedAt: subagent.status === "running" ? null : now(), error: null };
        });
        putMessage(run, run.agentId, {
          id: messageId(run, "subagents"),
          turnId: run.turnId,
          author: "assistant",
          source: "assistant",
          itemType: CONVERSATION_SUBAGENTS_ITEM_TYPE,
          text: conversationSubagentsText(subagents),
          subagents,
          createdAt: run.subagentStarts.values().next().value ?? now(),
          status: "completed",
        });
        return;
      }
      case "exchange":
        sendExchange(run, step.text, step.recipientAgentIds);
        return;
      case "teammate-reply":
        receiveTeammateReply(run, step);
        return;
      case "prompt":
        askPrompt(run, step, done);
        return;
      case "answer":
        streamAnswer(run, step, done);
        return;
      case "reactions": {
        const answerId = run.answerId;
        if (!answerId) return;
        updateMessage(run.agentId, answerId, (message) => ({
          ...message,
          reactions: step.reactions.map(({ emoji, agentId }) => ({ emoji, actor: { kind: "agent", agentId } })),
        }));
        return;
      }
    }
  }

  function finishRun(run: SceneRun): void {
    completeMainTurn(run);
    for (const [agentId, turnId] of run.backgroundTurns) {
      mock.updateConversationSnapshot(agentId, (snapshot) => {
        snapshot.activeTurnId = null;
      });
      emitTurnCompleted(agentId, turnId, "completed");
    }
    run.backgroundTurns.clear();
    if (run.scripted) {
      playedScenes.add(run.agentId);
      for (const agentId of run.touchedAgentIds) {
        const tokens = LANDING_CONTEXT_TOKENS[agentId];
        if (tokens) contextTokens[agentId] = tokens.after;
      }
    }
    activeRun = null;
    // The snapshot replaces every running turn, so it goes out only when none is left.
    mock.setRuntimeSnapshot(landingRuntimeSnapshot(options.agents, contextTokens));
  }

  /** Schedules the steps from `start` up to the next step that holds the scene. */
  function scheduleFrom(run: SceneRun, start: number, baseAt: number): void {
    for (let index = start; index < run.steps.length; index += 1) {
      const step = run.steps[index];
      if (!step) break;
      const next = () => scheduleFrom(run, index + 1, step.at);
      schedule(
        run,
        () => {
          run.nextStep = index + 1;
          runStep(run, step, next);
        },
        Math.max(0, step.at - baseAt),
      );
      if (isBarrier(step)) return;
    }
    const lastAt = run.steps.at(-1)?.at ?? baseAt;
    schedule(run, () => finishRun(run), Math.max(0, lastAt - baseAt) + SCENE_END_DELAY_MS);
  }

  function startRun(run: SceneRun): void {
    activeRun = run;
    scheduleFrom(run, 0, 0);
  }

  /** Runs the rest of the active scene at once. */
  function settleActiveRun(): void {
    const run = activeRun;
    if (!run) return;
    clearRunTimers(run);
    run.instant = true;
    if (run.settle) run.settle();
    else scheduleFrom(run, run.nextStep, 0);
  }

  function createRun(agentId: string, steps: LandingSceneStep[], scripted: boolean, turnId?: string): SceneRun {
    runCounter += 1;
    return {
      runId: runCounter,
      agentId,
      scripted,
      steps,
      turnId: turnId ?? `${runPrefix(runCounter)}turn`,
      turnActive: turnId !== undefined,
      timers: new Set(),
      touchedAgentIds: new Set(),
      backgroundTurns: new Map(),
      exchangeId: null,
      subagentStarts: new Map(),
      prompt: null,
      answers: {},
      answerId: null,
      instant,
      nextStep: 0,
      settle: null,
    };
  }

  /** Stops the run and removes every message that it added. */
  function cancelActiveRun(): void {
    const run = activeRun;
    if (!run) return;
    activeRun = null;
    clearRunTimers(run);
    if (run.prompt) {
      mock.emitAgentEvent({
        type: "agent-input-resolved",
        kind: "prompt",
        requestId: run.prompt.requestId,
        agentId: run.agentId,
      });
    }
    const prefix = runPrefix(run.runId);
    const runTurns = new Set([run.turnId, ...run.backgroundTurns.values()]);
    for (const agentId of new Set([run.agentId, ...run.touchedAgentIds])) {
      mock.updateConversationSnapshot(agentId, (snapshot) => {
        if (snapshot.activeTurnId && runTurns.has(snapshot.activeTurnId)) snapshot.activeTurnId = null;
        snapshot.messages = snapshot.messages.filter((message) => !message.id.startsWith(prefix));
      });
    }
    if (run.turnActive) {
      mock.setQueueSnapshot(run.agentId, []);
      emitTurnCompleted(run.agentId, run.turnId, "interrupted");
    }
    for (const [agentId, turnId] of run.backgroundTurns) emitTurnCompleted(agentId, turnId, "interrupted");
  }

  function startScene(agentId: string): void {
    const scene = scenes[agentId];
    if (!scene || playedScenes.has(agentId)) return;
    startRun(createRun(agentId, scene.steps, true));
  }

  function replyToTypedMessage(sent: MockSentMessage): boolean {
    const reply = LANDING_TYPED_REPLIES[sent.agentId];
    if (disposed || !reply) return false;
    if (activeRun) {
      // A visitor who writes to the agent mid-scene has seen enough of it.
      if (activeRun.scripted && activeRun.agentId === sent.agentId) playedScenes.add(sent.agentId);
      cancelActiveRun();
      mock.updateConversationSnapshot(sent.agentId, (snapshot) => {
        snapshot.activeTurnId = sent.turnId;
      });
      mock.setQueueSnapshot(sent.agentId, [sent.delivery]);
      emitTurnStarted(sent.agentId, sent.turnId);
    }
    startRun(
      createRun(
        sent.agentId,
        [
          { at: 300, kind: "progress", detail: reply.progress },
          { at: 900, kind: "answer", text: reply.answer },
        ],
        false,
        sent.turnId,
      ),
    );
    return true;
  }

  function emitDirectTyping(run: DirectScriptRun, typing: boolean): void {
    run.typing = typing;
    mock.emitDirectTyping({
      type: "team-direct-typing",
      senderMemberId: run.memberId,
      recipientMemberId: "member-self",
      typing,
    });
  }

  function cancelActiveDirectRun(): void {
    const run = activeDirectRun;
    if (!run) return;
    clearRunTimers(run);
    if (run.typing) emitDirectTyping(run, false);
    activeDirectRun = null;
  }

  function createDirectMessages(
    script: LandingDirectDemoScript,
  ): [DirectMessage, DirectMessage, DirectMessage, DirectMessage] {
    const snapshot = mock.readDirectConversationSnapshot(script.memberId);
    let sequence = snapshot.messages.reduce((highest, message) => Math.max(highest, message.sequence), 0);
    const startedAt = Date.now();
    const createMessage = (part: string, senderMemberId: string, recipientMemberId: string, text: string) => {
      sequence += 1;
      return {
        id: `${LANDING_DIRECT_SCRIPT_MESSAGE_PREFIX}${script.memberId}:${part}`,
        threadId: snapshot.threadId,
        senderMemberId,
        recipientMemberId,
        text,
        createdAt: new Date(startedAt + sequence * 1_000).toISOString(),
        sequence,
      } satisfies DirectMessage;
    };
    return [
      createMessage("question-1", "member-self", script.memberId, script.question),
      createMessage("answer-1", script.memberId, "member-self", script.answer),
      createMessage("question-2", "member-self", script.memberId, script.followUp),
      createMessage("answer-2", script.memberId, "member-self", script.finalAnswer),
    ];
  }

  function appendDirectMessage(memberId: string, message: DirectMessage): void {
    mock.updateDirectConversationSnapshot(memberId, (snapshot) => {
      if (snapshot.messages.some((candidate) => candidate.id === message.id)) return;
      snapshot.messages = [...snapshot.messages, message];
    });
    mock.emitDirectMessage({
      type: "team-direct-message",
      message,
      memberIds: [message.senderMemberId, message.recipientMemberId],
    });
  }

  function startDirectScript(script: LandingDirectDemoScript): void {
    if (playedDirectScripts.has(script.memberId)) return;
    mock.updateDirectConversationSnapshot(script.memberId, (snapshot) => {
      snapshot.messages = snapshot.messages.filter((message) => !isDirectScriptMessage(message));
    });
    const messages = createDirectMessages(script);
    if (instant) {
      for (const message of messages) appendDirectMessage(script.memberId, message);
      playedDirectScripts.add(script.memberId);
      return;
    }

    const run: DirectScriptRun = { memberId: script.memberId, timers: new Set(), typing: false };
    activeDirectRun = run;
    scheduleDirect(run, () => appendDirectMessage(script.memberId, messages[0]), 250);
    scheduleDirect(run, () => emitDirectTyping(run, true), 650);
    scheduleDirect(
      run,
      () => {
        emitDirectTyping(run, false);
        appendDirectMessage(script.memberId, messages[1]);
      },
      1_350,
    );
    scheduleDirect(run, () => appendDirectMessage(script.memberId, messages[2]), 1_900);
    scheduleDirect(run, () => emitDirectTyping(run, true), 2_250);
    scheduleDirect(
      run,
      () => {
        emitDirectTyping(run, false);
        appendDirectMessage(script.memberId, messages[3]);
        playedDirectScripts.add(script.memberId);
        activeDirectRun = null;
      },
      3_100,
    );
  }

  function selectAgent(agentId: string): void {
    if (selectedConversation?.kind === "agent" && selectedConversation.id === agentId) return;
    cancelActiveDirectRun();
    selectedConversation = { kind: "agent", id: agentId };
    // The first read of the lead's chat comes after its scene starts.
    if (activeRun?.agentId === agentId) return;
    settleActiveRun();
    if (activated) startScene(agentId);
  }

  function selectDirectMember(memberId: string): void {
    if (selectedConversation?.kind === "direct" && selectedConversation.id === memberId) return;
    settleActiveRun();
    cancelActiveDirectRun();
    selectedConversation = { kind: "direct", id: memberId };
    const script = directScripts[memberId];
    if (activated && script) startDirectScript(script);
  }

  const unsubscribeAgent = mock.onLatestConversationOpened(selectAgent);
  const unsubscribeDirect = mock.onLatestDirectConversationOpened(selectDirectMember);
  const unsubscribeSent = mock.onMessageSent(replyToTypedMessage);
  const unsubscribePrompt = mock.onPromptResponse((input) => {
    const prompt = activeRun?.prompt;
    if (prompt && prompt.requestId === String(input.requestId)) prompt.resume(input.answers);
  });

  return {
    activate: () => {
      if (activated || disposed) return;
      activated = true;
      if (selectedConversation?.kind === "direct") {
        const script = directScripts[selectedConversation.id];
        if (script) startDirectScript(script);
        return;
      }
      startScene(selectedConversation?.id ?? LANDING_LEAD_AGENT_ID);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeAgent();
      unsubscribeDirect();
      unsubscribeSent();
      unsubscribePrompt();
      cancelActiveRun();
      cancelActiveDirectRun();
    },
  };
}
