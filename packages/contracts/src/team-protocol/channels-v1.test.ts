import { describe, expect, it } from "vitest";
import { CHANNEL_ROUTES, channelEvent, channelRequest, channelResponse } from "./channels-v1";

const command = {
  type: "send",
  operationId: "operation-1",
  channelId: "channel-1",
  text: "Prepare the report",
  recipientAgentId: "agent-1",
  replyToMessageId: null,
  attachmentDraftIds: [],
};
const channel = {
  id: "channel-1",
  name: "Project",
  title: "Release coordination",
  instructions: "Ship the project",
  members: [{ agentId: "agent-1" }],
  leadAgentId: "agent-1",
  archived: false,
  revision: 1,
  createdAt: "2026-09-07T12:00:00.000Z",
};

describe("channel-chats-v1 payloads", () => {
  it("preserves the published command, list, page, and change fixtures", () => {
    expect(channelRequest(CHANNEL_ROUTES.command, command)).toEqual(command);
    const preview = { authorName: "Researcher", text: "Choose a format", at: channel.createdAt };
    expect(
      channelResponse(CHANNEL_ROUTES.list, 200, [
        { ...channel, unreadCount: 1, activeTasks: 0, lastMessage: preview },
        { ...channel, id: "channel-2", unreadCount: 0, activeTasks: 0, lastMessage: null },
      ]),
    ).toEqual([
      { ...channel, unreadCount: 1, activeTasks: 0, lastMessage: preview },
      { ...channel, id: "channel-2", unreadCount: 0, activeTasks: 0, lastMessage: null },
    ]);
    const page = {
      channel,
      messages: [
        {
          id: "message-1",
          channelId: channel.id,
          sequence: 1,
          author: { kind: "agent", id: "agent-1", name: "Researcher" },
          taskId: "task-1",
          superseded: false,
          message: {
            id: "message-1",
            turnId: "turn-1",
            author: "assistant",
            text: "Choose a format",
            createdAt: channel.createdAt,
            status: "completed",
            attachments: [
              {
                id: "attachment-1",
                name: "report.txt",
                size: 12,
                kind: "file",
                mimeType: "text/plain",
                previewKind: "text",
                previewUrl: null,
              },
            ],
            questionPrompt: {
              requestId: "question-1",
              questions: [
                { id: "format", header: "Format", question: "Which format?", isSecret: false, options: null },
              ],
              resolution: null,
            },
          },
        },
      ],
      tasks: [
        {
          id: "task-1",
          channelId: channel.id,
          parentTaskId: null,
          rootTaskId: "task-1",
          ownerAgentId: "agent-1",
          requestMessageId: "request-1",
          instruction: "Prepare a report",
          attachmentDraftIds: [],
          expectedResult: "Report",
          sourceMessageIds: ["request-1"],
          dependencies: [],
          resources: ["host"],
          state: "running",
          revision: 0,
          assignmentCount: 0,
          error: null,
        },
      ],
      olderCursor: null,
      throughSequence: 1,
    };
    expect(channelResponse(CHANNEL_ROUTES.read, 200, page)).toEqual(page);
    expect(channelResponse(CHANNEL_ROUTES.command, 200, { ...channel, providerSessionId: "private" })).toEqual(channel);
    expect(channelEvent({ type: "channels-changed", channelId: "channel-1", revision: 2 })).toEqual({
      type: "channels-changed",
      channelId: "channel-1",
      revision: 2,
    });
    expect(channelEvent({ type: "channel-memories-changed", channelId: "channel-1" })).toEqual({
      type: "channel-memories-changed",
      channelId: "channel-1",
    });
    expect(channelEvent({ type: "channel-routines-changed", channelId: "channel-1" })).toEqual({
      type: "channel-routines-changed",
      channelId: "channel-1",
    });
  });
  it("reads the older purpose key as instructions", () => {
    const save = {
      type: "save",
      operationId: "operation-3",
      channelId: channel.id,
      draft: {
        name: channel.name,
        purpose: "Ship the project",
        members: [{ agentId: "agent-1" }],
        leadAgentId: "agent-1",
      },
    };
    expect(channelRequest(CHANNEL_ROUTES.command, save)).toEqual({
      type: "save",
      operationId: "operation-3",
      channelId: channel.id,
      draft: {
        name: channel.name,
        title: "",
        instructions: "Ship the project",
        members: [{ agentId: "agent-1" }],
        leadAgentId: "agent-1",
      },
    });
  });
  it("drops the member and draft keys an older peer still sends", () => {
    const save = {
      type: "save",
      operationId: "operation-2",
      channelId: channel.id,
      draft: {
        name: channel.name,
        title: channel.title,
        instructions: channel.instructions,
        members: [{ agentId: "agent-1" }],
        leadAgentId: "agent-1",
      },
    };
    expect(channelRequest(CHANNEL_ROUTES.command, save)).toEqual(save);
    expect(
      channelRequest(CHANNEL_ROUTES.command, {
        ...save,
        draft: {
          ...save.draft,
          members: [{ agentId: "agent-1", responsibility: "Research" }],
          linkedThreadIds: ["thread-1"],
        },
      }),
    ).toEqual(save);
  });
  it("does not accept an asserted human author from a client", () => {
    expect(
      channelRequest(CHANNEL_ROUTES.command, { ...command, author: { id: "owner", name: "Impersonation" } }),
    ).toEqual(command);
  });
  it("encodes permanent deletion as an additive empty response", () => {
    expect(channelRequest(CHANNEL_ROUTES.delete, { channelId: channel.id })).toEqual({ channelId: channel.id });
    expect(channelResponse(CHANNEL_ROUTES.delete, 204, null)).toBeNull();
  });
  it("rejects malformed commands, memberships, pages, and known events", () => {
    expect(() => channelRequest(CHANNEL_ROUTES.command, { ...command, recipientAgentId: 8 })).toThrow();
    expect(() =>
      channelRequest(CHANNEL_ROUTES.command, {
        type: "save",
        channelId: "g",
        operationId: "o",
        draft: { ...channel, leadAgentId: "outsider" },
      }),
    ).toThrow();
    expect(() =>
      channelResponse(CHANNEL_ROUTES.read, 200, {
        channel,
        messages: [{}],
        tasks: [],
        throughSequence: 0,
        olderCursor: null,
      }),
    ).toThrow();
    expect(() => channelEvent({ type: "channels-changed", channelId: "g", revision: -1 })).toThrow();
    expect(() => channelEvent({ type: "channel-memories-changed", channelId: "" })).toThrow();
    expect(() => channelEvent({ type: "channel-routines-changed", channelId: "x".repeat(129) })).toThrow();
    expect(channelEvent({ type: "future-optional-event" })).toBeNull();
  });
});
