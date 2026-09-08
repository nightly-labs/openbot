import { describe, expect, it } from "vitest";
import { GROUP_ROUTES, groupEvent, groupRequest, groupResponse } from "./groups-v1";

const command = {
  type: "send",
  operationId: "operation-1",
  groupId: "group-1",
  text: "Prepare the report",
  recipientAgentId: "agent-1",
  replyToMessageId: null,
  attachmentDraftIds: [],
};
const group = {
  id: "group-1",
  name: "Project",
  purpose: "Ship the project",
  members: [{ agentId: "agent-1", responsibility: "Research" }],
  leadAgentId: "agent-1",
  linkedThreadIds: [],
  archived: false,
  revision: 1,
  createdAt: "2026-09-07T12:00:00.000Z",
};

describe("group-chats-v1 payloads", () => {
  it("preserves the published command, list, page, and change fixtures", () => {
    expect(groupRequest(GROUP_ROUTES.command, command)).toEqual(command);
    expect(groupResponse(GROUP_ROUTES.list, 200, [{ ...group, unreadCount: 1, activeTasks: 0 }])).toEqual([
      { ...group, unreadCount: 1, activeTasks: 0 },
    ]);
    const page = {
      group,
      messages: [
        {
          id: "message-1",
          groupId: group.id,
          sequence: 1,
          author: { kind: "agent", id: "agent-1", name: "Researcher" },
          taskId: "task-1",
          superseded: false,
          message: {
            id: "message-1",
            turnId: "turn-1",
            author: "assistant",
            text: "Choose a format",
            createdAt: group.createdAt,
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
          groupId: group.id,
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
    expect(groupResponse(GROUP_ROUTES.read, 200, page)).toEqual(page);
    expect(groupResponse(GROUP_ROUTES.command, 200, { ...group, providerSessionId: "private" })).toEqual(group);
    expect(groupEvent({ type: "groups-changed", groupId: "group-1", revision: 2 })).toEqual({
      type: "groups-changed",
      groupId: "group-1",
      revision: 2,
    });
  });
  it("does not accept an asserted human author from a client", () => {
    expect(groupRequest(GROUP_ROUTES.command, { ...command, author: { id: "owner", name: "Impersonation" } })).toEqual(
      command,
    );
  });
  it("rejects malformed commands, memberships, pages, and known events", () => {
    expect(() => groupRequest(GROUP_ROUTES.command, { ...command, recipientAgentId: 8 })).toThrow();
    expect(() =>
      groupRequest(GROUP_ROUTES.command, {
        type: "save",
        groupId: "g",
        operationId: "o",
        draft: { ...group, leadAgentId: "outsider" },
      }),
    ).toThrow();
    expect(() =>
      groupResponse(GROUP_ROUTES.read, 200, {
        group,
        messages: [{}],
        tasks: [],
        throughSequence: 0,
        olderCursor: null,
      }),
    ).toThrow();
    expect(() => groupEvent({ type: "groups-changed", groupId: "g", revision: -1 })).toThrow();
    expect(groupEvent({ type: "future-optional-event" })).toBeNull();
  });
});
