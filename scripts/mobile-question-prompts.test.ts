import type { AgentPromptQuestion, ConversationSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  latestReadableMessage,
  type PendingChatMessage,
  presentChatMessages,
  projectChatMessages,
} from "../apps/mobile/src/features/chat/model/chat-messages";
import {
  answeredPromptResolution,
  nextUnansweredQuestion,
  promptAnswerLabel,
} from "../apps/mobile/src/features/chat/model/question-prompt";
import { conversationMessageId, decodeConversation } from "../apps/mobile/src/features/workspace/model/conversation";

const questions: AgentPromptQuestion[] = [
  {
    id: "place",
    header: "Place",
    question: "Where to?",
    isSecret: false,
    options: [{ label: "Garden", description: "Outside" }],
  },
  { id: "token", header: "Token", question: "Private token?", isSecret: true, options: null },
  { id: "extra", header: "Extra", question: "Anything else?", isSecret: false, options: null },
];

function conversation(): ConversationSnapshot {
  return {
    agentId: "agent-test",
    threadId: "thread-test",
    activeTurnId: "turn-test",
    revision: 1,
    messages: [
      {
        id: "prompt-message",
        turnId: "turn-test",
        author: "assistant",
        text: "Question: Where to?",
        status: "completed",
        createdAt: "2026-09-04T13:08:00.000Z",
        questionPrompt: { requestId: "request-test", questions, resolution: null },
      },
    ],
  };
}

describe("mobile question forms", () => {
  it("keeps attachment-only messages visible and advances their read boundary", () => {
    const snapshot = conversation();
    const attachment = {
      id: "attachment-test",
      name: "note.txt",
      size: 5,
      kind: "file" as const,
      mimeType: "text/plain",
      previewKind: "text" as const,
      previewUrl: null,
    };
    snapshot.messages = [
      {
        id: "file-message",
        author: "user",
        text: "",
        status: "completed",
        createdAt: "2026-09-09T10:00:00Z",
        attachments: [attachment],
      },
    ];
    expect({
      projected: projectChatMessages(snapshot.messages),
      read: latestReadableMessage(snapshot.messages)?.id,
    }).toEqual({
      projected: [
        { id: "file-message", kind: "message", author: "user", body: "", streaming: false, attachments: [attachment] },
      ],
      read: "file-message",
    });
  });
  it("reconciles the pending bubble by receipt ID, without merging another member's identical text", () => {
    const pending: PendingChatMessage = {
      message: { id: "local", kind: "message", author: "user", body: "Hello", streaming: false },
      baseline: new Set(),
      serverId: null,
    };
    const receipt = {
      messageId: "mailbox-message",
      deliveries: [
        { id: "other-delivery", recipientAgentId: "other-agent", status: "completed" as const, position: null },
        { id: "mine", recipientAgentId: "agent-test", status: "completed" as const, position: null },
      ],
    };
    const serverId = conversationMessageId(receipt, "agent-test");
    const messages = [
      { ...pending.message, id: "other-member" },
      { ...pending.message, id: "mine" },
    ];
    expect(presentChatMessages(messages, pending, new Map()).map((message) => message.id)).toEqual(["local"]);
    expect(
      presentChatMessages(messages, { ...pending, serverId }, new Map([[serverId, "local"]])).map(
        (message) => message.id,
      ),
    ).toEqual(["other-member", "local"]);
  });
  it("advances custom answers past skipped questions and submits only when every question is handled", () => {
    const answers: Record<string, string[]> = { extra: [] };
    expect(nextUnansweredQuestion(questions, answers, 2)).toBe(0);
    answers.place = ["A different garden"];
    expect(nextUnansweredQuestion(questions, answers, 0)).toBe(1);
    answers.token = ["private-value"];
    expect(nextUnansweredQuestion(questions, answers, 1)).toBeNull();
  });

  it("keeps the form and its choices when opening chat from downloaded history", () => {
    const snapshot = decodeConversation(conversation());
    expect(projectChatMessages(snapshot.messages)).toEqual([
      {
        id: "prompt-message",
        kind: "question",
        turnId: "turn-test",
        prompt: { requestId: "request-test", questions, resolution: null },
      },
    ]);
  });

  it("shows a structured form even when its fallback message text is empty", () => {
    const snapshot = conversation();
    snapshot.messages[0].text = "";
    expect(projectChatMessages(decodeConversation(snapshot).messages)[0]?.kind).toBe("question");
  });

  it("advances the read boundary to a visible prompt with no fallback text", () => {
    const snapshot = conversation();
    snapshot.messages[0].text = "";
    const prompt = snapshot.messages[0];
    snapshot.messages.unshift({ ...prompt, id: "earlier", text: "Hello", questionPrompt: undefined });
    snapshot.messages.push({ ...prompt, id: "empty", questionPrompt: undefined });
    const boundary = latestReadableMessage(decodeConversation(snapshot).messages);
    expect(boundary?.id).toBe("prompt-message");
    expect(boundary?.status).toBe("completed");
  });

  it("preserves an answer sent from another device when history refreshes", () => {
    const snapshot = conversation();
    const resolution = answeredPromptResolution(questions, { place: ["Garden"], token: [], extra: [] });
    snapshot.messages[0].questionPrompt = { requestId: "request-test", questions, resolution };
    const projected = projectChatMessages(decodeConversation(snapshot).messages)[0];
    expect(projected?.kind === "question" && projected.prompt.resolution).toEqual(resolution);
  });

  it("rejects malformed form choices from the host instead of offering an invalid answer", () => {
    const snapshot = conversation();
    const invalid = {
      ...snapshot,
      messages: [
        {
          ...snapshot.messages[0],
          questionPrompt: {
            requestId: "request-test",
            resolution: null,
            questions: [{ ...questions[0], options: [{ label: 42, description: "Invalid" }] }],
          },
        },
      ],
    };
    expect(() => decodeConversation(invalid)).toThrow("The server returned an invalid conversation message.");
  });

  it("redacts private answers while distinguishing answered, skipped and cancelled forms", () => {
    const answers = { place: ["Garden"], token: ["private-value"], extra: [] };
    const resolution = answeredPromptResolution(questions, answers);
    expect(resolution).toEqual({
      status: "answered",
      responses: {
        place: { status: "answered", answers: ["Garden"] },
        token: { status: "answered" },
        extra: { status: "skipped" },
      },
    });
    expect(promptAnswerLabel(questions[1], resolution)).toBe("Private answer");
    expect(promptAnswerLabel(questions[2], resolution)).toBe("Skipped");
    expect(answeredPromptResolution(questions, {})).toEqual({ status: "cancelled" });
    expect(answers.token).toEqual(["private-value"]);
  });
});
