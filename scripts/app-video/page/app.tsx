// The real OpenBot app, in its browser preview with the preview mock. The director plays the agent
// turns at fixed video times; the user's clicks and keys come from render.ts as real input.

import type { ConversationMessage, QueueDelivery, SendMessageInput } from "@openbot/contracts/ipc";
import { render } from "@solidjs/web";
import { App } from "../../../src/renderer/src/App";
import { createMockOpenBot, type MockOpenBotControls } from "../../../src/renderer/src/preview/mock-openbot";
import { OpenBotPlayground } from "../../../src/renderer/src/preview/OpenBotPlayground";
import "../../../src/renderer/src/preview/preview.css";
import { CUE } from "../cues";
import {
  AGENTS,
  CHIEF_TURN,
  RESEARCH_REQUEST,
  RESEARCH_TURN,
  type ScriptedTurn,
  SNAPSHOTS,
  UPDATE_STATUS,
  USAGE,
  USER,
} from "./fixtures";

export interface Director {
  /** Plays every agent event that is due at `t`. */
  tick(t: number): void;
}

declare global {
  interface Window {
    director?: Director;
  }
}

interface TurnTimes {
  start: number;
  thinking: number[];
  answerFrom: number;
  answerTo: number;
  handoff: number;
}

function createDirector(mock: MockOpenBotControls): Director {
  const now = () => new Date().toISOString();
  const threadId = (agentId: string) => mock.readConversationSnapshot(agentId).threadId ?? `thread-${agentId}`;
  /** Each event runs one time, in time order, at the first frame at or after its time. */
  const events: { time: number; run: (t: number) => void; done: boolean }[] = [];
  const on = (time: number, run: (t: number) => void) => events.push({ time, run, done: false });
  /** Runs on every frame from `from` to `to`. */
  const streams: { from: number; to: number; run: (t: number) => void }[] = [];

  // The user's message: the composer sends it through the mock API, and the director answers.
  mock.api.agent.sendMessage = async (input: SendMessageInput) => {
    const id = `video-user-${input.agentId}`;
    const turnId = `video-turn-${input.agentId}`;
    const message: ConversationMessage = {
      id,
      turnId,
      author: "user",
      source: "user",
      text: input.text,
      createdAt: now(),
      status: "completed",
    };
    mock.updateConversationSnapshot(input.agentId, (snapshot) => {
      snapshot.activeTurnId = turnId;
      snapshot.messages = [...snapshot.messages, message];
    });
    mock.setQueueSnapshot(input.agentId, [delivery(input.agentId, id, turnId, input.text, { kind: "user" })]);
    mock.emitAgentEvent({ type: "turn-started", agentId: input.agentId, threadId: threadId(input.agentId), turnId });
    return { messageId: id, deliveries: [{ id, recipientAgentId: input.agentId, status: "running", position: null }] };
  };

  function delivery(
    agentId: string,
    messageId: string,
    turnId: string,
    text: string,
    sender: QueueDelivery["sender"],
  ): QueueDelivery {
    return {
      id: `${messageId}-delivery`,
      messageId,
      recipientAgentId: agentId,
      sender,
      text,
      attachments: [],
      replyToMessageId: null,
      status: "running",
      position: null,
      turnId,
      error: null,
      createdAt: now(),
    };
  }

  function turn(script: ScriptedTurn, times: TurnTimes) {
    const { agentId } = script;
    const turnId = `video-turn-${agentId}`;
    const answerId = `video-answer-${agentId}`;
    const thinkingId = (index: number) => `video-thinking-${agentId}-${index}`;
    let streamed = 0;

    script.thinking.forEach((text, index) => {
      on(times.thinking[index] ?? times.start, () => {
        mock.updateConversationSnapshot(agentId, (snapshot) => {
          snapshot.messages = [
            ...snapshot.messages.map((message) =>
              message.id === thinkingId(index - 1) ? { ...message, status: "completed" as const } : message,
            ),
            {
              id: thinkingId(index),
              turnId,
              author: "assistant",
              source: "assistant",
              itemType: "commentary",
              text,
              createdAt: now(),
              status: "streaming",
            },
          ];
        });
      });
    });

    // The answer streams in whole words, at an even pace from `answerFrom` to `answerTo`.
    const words = script.answer.split(/(?<=\s)/u);
    streams.push({
      from: times.answerFrom,
      to: times.answerTo,
      run: (t) => {
        const amount = Math.min(1, Math.max(0, (t - times.answerFrom) / (times.answerTo - times.answerFrom)));
        const count = Math.floor(words.length * amount);
        if (count <= streamed) return;
        const delta = words.slice(streamed, count).join("");
        streamed = count;
        mock.emitConversationDelta({
          agentId,
          threadId: threadId(agentId),
          turnId,
          messageId: answerId,
          delta,
          createdAt: now(),
        });
      },
    });

    on(times.answerTo, () => {
      const answer: ConversationMessage = {
        id: answerId,
        turnId,
        author: "assistant",
        source: "assistant",
        itemType: "final_answer",
        text: script.answer,
        createdAt: now(),
        status: "completed",
        attachments: script.attachments,
      };
      mock.updateConversationSnapshot(agentId, (snapshot) => {
        snapshot.messages = [
          ...snapshot.messages.map((message) =>
            message.id.startsWith(`video-thinking-${agentId}`) ? { ...message, status: "completed" as const } : message,
          ),
          answer,
        ];
      });
    });

    on(times.handoff, () => {
      const exchangeId = `video-handoff-${agentId}`;
      mock.updateConversationSnapshot(agentId, (snapshot) => {
        snapshot.activeTurnId = null;
        snapshot.messages = [
          ...snapshot.messages,
          {
            id: exchangeId,
            turnId,
            author: "system",
            source: "system",
            text: "",
            createdAt: now(),
            status: "completed",
            exchange: {
              direction: "outgoing",
              messageId: exchangeId,
              senderAgentId: agentId,
              recipientAgentIds: script.handoffTo,
              replyToMessageId: answerId,
              deliveries: script.handoffTo.map((recipientAgentId) => ({
                id: `${exchangeId}-${recipientAgentId}`,
                recipientAgentId,
                status: "completed",
                position: null,
                error: null,
              })),
            },
          },
        ];
      });
      mock.setQueueSnapshot(agentId, []);
      mock.emitAgentEvent({
        type: "turn-completed",
        agentId,
        threadId: threadId(agentId),
        turnId,
        status: "completed",
      });
    });
  }

  turn(CHIEF_TURN, {
    start: CUE.turnStart,
    thinking: [...CUE.thinking],
    answerFrom: CUE.answerFrom,
    answerTo: CUE.answerTo,
    handoff: CUE.handoff,
  });

  // Chief's handoff reaches Research, which starts work before the user opens it.
  on(CUE.handoff + 0.05, () => {
    const turnId = "video-turn-research";
    const incoming: ConversationMessage = {
      id: "video-incoming-research",
      turnId,
      author: "agent",
      source: "agent",
      senderAgentId: "chief",
      text: RESEARCH_REQUEST,
      createdAt: now(),
      status: "completed",
      exchange: {
        direction: "incoming",
        messageId: "video-handoff-chief",
        senderAgentId: "chief",
        recipientAgentIds: ["research"],
        replyToMessageId: null,
        deliveries: [],
      },
    };
    mock.updateConversationSnapshot("research", (snapshot) => {
      snapshot.activeTurnId = turnId;
      snapshot.messages = [...snapshot.messages, incoming];
    });
    mock.setQueueSnapshot("research", [
      delivery("research", incoming.id, turnId, RESEARCH_REQUEST, { kind: "agent", agentId: "chief" }),
    ]);
    mock.emitAgentEvent({ type: "turn-started", agentId: "research", threadId: threadId("research"), turnId });
  });

  turn(RESEARCH_TURN, {
    start: CUE.researchThinking,
    thinking: [CUE.researchThinking],
    answerFrom: CUE.researchAnswerFrom,
    answerTo: CUE.researchAnswerTo,
    handoff: CUE.researchAnswerTo + 0.4,
  });

  events.sort((left, right) => left.time - right.time);
  return {
    tick(t) {
      for (const stream of streams) if (t >= stream.from && t < stream.to) stream.run(t);
      for (const event of events) {
        if (event.time > t) break;
        if (event.done) continue;
        event.done = true;
        event.run(t);
      }
    },
  };
}

// A real user has closed the iPhone app announcement long ago.
window.localStorage.setItem("openbot:ios-beta-card-dismissed", "true");

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");
render(
  () => (
    <OpenBotPlayground
      options={{
        authState: { status: "signed_in", user: USER },
        agents: AGENTS,
        snapshots: SNAPSHOTS,
        updateStatus: UPDATE_STATUS,
        usage: USAGE,
        queues: {},
        browserTabs: [],
        browserControlState: { sessions: [] },
        remoteDesktopSessions: [],
      }}
      dependencies={{
        createMock: (options) => {
          const mock = createMockOpenBot(options);
          window.director = createDirector(mock);
          return mock;
        },
        renderApp: () => <App />,
      }}
    />
  ),
  root,
);
