import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { describe, expect, it } from "vitest";
import { appendSkillCreationRequest, appendSkillExample, EMPTY_DRAFT } from "./composer-draft";

const skill = { id: "skill-notes", name: "Release notes", examplePrompt: "Summarize the latest commits." };

describe("skill example drafts", () => {
  it("inserts an author example and a real skill reference", () => {
    expect(appendSkillExample(EMPTY_DRAFT, skill).text).toBe(
      `${serializeChatTagReference("skill", skill.name, skill.id)} ${skill.examplePrompt}`,
    );
    expect(EMPTY_DRAFT.text).toBe("");
  });
  it("preserves existing text, attachments, and replies", () => {
    const attachments = [
      {
        id: "file-1",
        name: "notes.txt",
        size: 10,
        kind: "file" as const,
        mimeType: "text/plain",
        previewKind: "text" as const,
        previewUrl: null,
      },
    ];
    const draft = { text: "Keep my draft", attachments, replyToMessageId: "message-1" };
    const result = appendSkillExample(draft, skill);
    expect(result).toEqual({
      ...draft,
      text: `Keep my draft\n${serializeChatTagReference("skill", skill.name, skill.id)} ${skill.examplePrompt}`,
    });
    expect(draft.text).toBe("Keep my draft");
  });
  it("uses a fallback for old skills", () => {
    expect(appendSkillExample(EMPTY_DRAFT, { id: skill.id, name: skill.name }).text).toContain(
      "Help me use this skill.",
    );
  });
});

it("adds a skill creation request without changing the existing draft state", () => {
  const draft = { ...EMPTY_DRAFT, text: "Keep this text", replyToMessageId: "reply-1" };
  const result = appendSkillCreationRequest(draft);
  expect(result.text).toMatch(/^Keep this text\nHelp me create a new local skill/);
  expect(result.attachments).toBe(draft.attachments);
  expect(result.replyToMessageId).toBe("reply-1");
  expect(draft.text).toBe("Keep this text");
  expect(appendSkillCreationRequest(EMPTY_DRAFT).text).toMatch(/^Help me create a new local skill/);
});
