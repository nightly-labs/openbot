import {
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationMessage,
  type ConversationSnapshot,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { isNoUpdateAnswer, ROUTINE_NO_UPDATE_MARKER, settleQuietRoutineTurn } from "./routine-quiet-runs";

function message(id: string, text: string, fields: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id,
    author: "assistant",
    source: "assistant",
    text,
    createdAt: "2026-10-08T09:00:00.000Z",
    status: "completed",
    turnId: "turn-1",
    ...fields,
  };
}

function snapshot(messages: ConversationMessage[]): ConversationSnapshot {
  return { agentId: "watch", threadId: "thread-1", activeTurnId: null, messages, revision: 1 };
}

const ids = (value: ConversationSnapshot) => value.messages.map((item) => item.id);

describe("isNoUpdateAnswer", () => {
  it("accepts only the marker with white space around it", () => {
    expect(isNoUpdateAnswer(ROUTINE_NO_UPDATE_MARKER)).toBe(true);
    expect(isNoUpdateAnswer(` \n${ROUTINE_NO_UPDATE_MARKER}\t\n`)).toBe(true);
    expect(isNoUpdateAnswer(`Nothing new. ${ROUTINE_NO_UPDATE_MARKER}`)).toBe(false);
    expect(isNoUpdateAnswer(`\`${ROUTINE_NO_UPDATE_MARKER}\``)).toBe(false);
    expect(isNoUpdateAnswer("No response requested.")).toBe(false);
    expect(isNoUpdateAnswer("")).toBe(false);
  });
});

describe("settleQuietRoutineTurn", () => {
  it("drops the marker answer with the turn's thinking and plan, and keeps other turns", () => {
    const value = snapshot([
      message("routine-delivery", "Check the alert queue.", { author: "user", source: "routine", itemType: "routine" }),
      message("thinking", "Reading the queue.", { itemType: "commentary" }),
      message("plan", "1. Read", { itemType: CONVERSATION_PLAN_ITEM_TYPE }),
      message("answer", ROUTINE_NO_UPDATE_MARKER),
      message("earlier", ROUTINE_NO_UPDATE_MARKER, { turnId: "turn-0" }),
    ]);

    expect(settleQuietRoutineTurn(value, "turn-1", false)).toBe(true);
    expect(ids(value)).toEqual(["routine-delivery", "earlier"]);
  });

  it("keeps a report and drops only the marker answer next to it", () => {
    const value = snapshot([
      message("thinking", "Reading the queue.", { itemType: "commentary" }),
      message("report", "Disk full on db-1."),
      message("answer", ROUTINE_NO_UPDATE_MARKER),
    ]);

    expect(settleQuietRoutineTurn(value, "turn-1", false)).toBe(false);
    expect(ids(value)).toEqual(["thinking", "report"]);
  });

  it("is not quiet when the turn gave the user a file, an image or a question", () => {
    for (const extra of [
      message("file", "", {
        itemType: "agent_attachment",
        attachments: [
          {
            id: "a",
            name: "report.csv",
            size: 1,
            kind: "file",
            mimeType: "text/csv",
            previewKind: "text",
            previewUrl: null,
          },
        ],
      }),
      message("image", "", { imageGeneration: { resolution: "1024x1024", aspectRatio: "square" } }),
      message("question", "", { itemType: "question_prompt" }),
    ]) {
      const value = snapshot([extra, message("answer", ROUTINE_NO_UPDATE_MARKER)]);
      expect(settleQuietRoutineTurn(value, "turn-1", false)).toBe(false);
      expect(ids(value)).toEqual([extra.id]);
    }
  });

  it("drops each text answer after a no-update tool call, also when there is none", () => {
    const answered = snapshot([
      message("thinking", "Reading the queue.", { itemType: "commentary" }),
      message("answer", "Nada acionável nesta varredura."),
    ]);
    expect(settleQuietRoutineTurn(answered, "turn-1", true)).toBe(true);
    expect(ids(answered)).toEqual([]);

    const silent = snapshot([message("thinking", "Reading the queue.", { itemType: "commentary" })]);
    expect(settleQuietRoutineTurn(silent, "turn-1", true)).toBe(true);
    expect(ids(silent)).toEqual([]);
  });

  it("is not quiet after a no-update tool call when the turn gave the user an image", () => {
    const value = snapshot([
      message("image", "", { imageGeneration: { resolution: "1024x1024", aspectRatio: "square" } }),
      message("answer", "Nothing new."),
    ]);

    expect(settleQuietRoutineTurn(value, "turn-1", true)).toBe(false);
    expect(ids(value)).toEqual(["image"]);
  });

  it("changes nothing when the turn has no marker answer", () => {
    const value = snapshot([message("answer", "No response requested.")]);

    expect(settleQuietRoutineTurn(value, "turn-1", false)).toBe(false);
    expect(ids(value)).toEqual(["answer"]);
  });
});
