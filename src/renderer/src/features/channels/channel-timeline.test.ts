import type { ChannelMessage, ChannelPage } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../data";
import { channelTimelineEntries, firstUnreadChannelMessageId, isOwnChannelAuthor } from "./channel-timeline";

const now = new Date(2026, 8, 9, 14, 0);
const options = { now, locale: "en-US" };

function agent(id: string, name: string): AgentProfile {
  const profile: AgentProfile = {
    id,
    name,
    title: "",
    description: "",
    notifications: true,
    provider: "codex",
    model: "gpt-5-codex",
    reasoningEffort: "medium",
    threadId: null,
    avatarSeed: `${id}-seed`,
    avatarHue: null,
    avatarUrl: null,
    time: "",
    preview: "",
  };
  return profile;
}

function message(overrides: {
  id: string;
  sequence: number;
  author: ChannelMessage["author"];
  createdAt: Date;
  text?: string;
  status?: ChannelMessage["message"]["status"];
}): ChannelMessage {
  const entry: ChannelMessage = {
    id: overrides.id,
    channelId: "channel-1",
    sequence: overrides.sequence,
    author: overrides.author,
    taskId: null,
    superseded: false,
    message: {
      id: overrides.id,
      author: overrides.author.kind === "member" ? "user" : "assistant",
      text: overrides.text ?? "Hello",
      createdAt: overrides.createdAt.toISOString(),
      status: overrides.status ?? "completed",
    },
  };
  return entry;
}

function page(messages: ChannelMessage[]): ChannelPage {
  return {
    channel: {
      id: "channel-1",
      name: "Project Falcon",
      title: "",
      instructions: "",
      members: [],
      leadAgentId: null,
      archived: false,
      revision: 1,
      createdAt: new Date(2026, 8, 1).toISOString(),
    },
    messages,
    tasks: [],
    olderCursor: null,
    throughSequence: messages.at(-1)?.sequence ?? 0,
  };
}

const chief = agent("agent-chief", "Chief");
const member = { kind: "member" as const, id: "local", name: "Norbert" };

describe("channelTimelineEntries", () => {
  it("puts the reader's own message on the right and every other author on the left", () => {
    const entries = channelTimelineEntries(
      page([
        message({ id: "m1", sequence: 1, author: member, createdAt: new Date(2026, 8, 9, 12, 0) }),
        message({
          id: "m2",
          sequence: 2,
          author: { kind: "agent", id: chief.id, name: "Chief" },
          createdAt: new Date(2026, 8, 9, 12, 1),
        }),
      ]),
      [chief],
      (id) => id === "local",
      options,
    );
    expect(entries.map((entry) => entry.author.kind)).toEqual(["you", "agent"]);
    expect(entries[0].message.author).toBe("you");
    expect(entries[1].author.agent?.id).toBe(chief.id);
  });

  it("draws another person of the team as an author, not as the reader", () => {
    const entries = channelTimelineEntries(
      page([
        message({
          id: "m1",
          sequence: 1,
          author: { kind: "member", id: "member-2", name: "Ada" },
          createdAt: new Date(2026, 8, 9, 12, 0),
        }),
      ]),
      [],
      (id) => id === "local",
      options,
    );
    expect(entries[0].author).toMatchObject({ kind: "agent", name: "Ada" });
  });

  it("draws the lead routing dispatch as the lead agent", () => {
    // The lead posts its own choice of owner. It is authored by the lead agent, not by the
    // anonymous coordinator, so the row has to resolve to that agent's face and colour.
    const entries = channelTimelineEntries(
      page([
        message({
          id: "m1",
          sequence: 1,
          author: { kind: "agent", id: chief.id, name: "Chief" },
          text: "Assigned to Ada.",
          createdAt: new Date(2026, 8, 9, 12, 0),
        }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(entries[0].author).toMatchObject({ kind: "agent", name: "Chief", agent: chief, avatarSeed: undefined });
  });

  it("draws the coordinator as an author, whatever the reader check says of its id", () => {
    const entries = channelTimelineEntries(
      page([
        message({
          id: "m1",
          sequence: 1,
          author: { kind: "coordinator", id: "coordinator", name: "Channel" },
          createdAt: new Date(2026, 8, 9, 12, 0),
        }),
      ]),
      [],
      () => true,
      options,
    );
    expect(entries[0].author).toMatchObject({ kind: "agent", name: "Channel" });
  });

  it("hides the repeated name inside a run by one author", () => {
    const author = { kind: "agent" as const, id: chief.id, name: "Chief" };
    const entries = channelTimelineEntries(
      page([
        message({ id: "m1", sequence: 1, author, createdAt: new Date(2026, 8, 9, 12, 0) }),
        message({ id: "m2", sequence: 2, author, createdAt: new Date(2026, 8, 9, 12, 2) }),
        message({ id: "m3", sequence: 3, author, createdAt: new Date(2026, 8, 9, 12, 30) }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(entries.map((entry) => entry.showAuthor)).toEqual([true, false, true]);
  });

  it("names the author again under a day separator", () => {
    const author = { kind: "agent" as const, id: chief.id, name: "Chief" };
    const entries = channelTimelineEntries(
      page([
        message({ id: "m1", sequence: 1, author, createdAt: new Date(2026, 8, 8, 23, 59) }),
        message({ id: "m2", sequence: 2, author, createdAt: new Date(2026, 8, 9, 0, 1) }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(entries[1].dayMarker).toBe("Today 12:01 AM");
    expect(entries[1].showAuthor).toBe(true);
  });

  it("seeds the face of a deleted author from its id", () => {
    const entries = channelTimelineEntries(
      page([
        message({
          id: "m1",
          sequence: 1,
          author: { kind: "agent", id: "agent-gone", name: "Sales Outbound" },
          createdAt: new Date(2026, 8, 9, 12, 0),
        }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(entries[0].author).toMatchObject({ name: "Sales Outbound", avatarSeed: "agent-gone" });
    expect(entries[0].author.agent).toBeUndefined();
  });

  it("marks a streaming message so the bubble can reveal it", () => {
    const entries = channelTimelineEntries(
      page([
        message({
          id: "m1",
          sequence: 1,
          author: { kind: "agent", id: chief.id, name: "Chief" },
          createdAt: new Date(2026, 8, 9, 12, 0),
          status: "streaming",
        }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(entries[0].message.streaming).toBe(true);
  });

  it("starts the unread part the counted number of messages back", () => {
    const author = { kind: "agent" as const, id: chief.id, name: "Chief" };
    const entries = channelTimelineEntries(
      page([
        message({ id: "m1", sequence: 1, author, createdAt: new Date(2026, 8, 9, 12, 0) }),
        message({ id: "m2", sequence: 2, author, createdAt: new Date(2026, 8, 9, 12, 1) }),
        message({ id: "m3", sequence: 3, author, createdAt: new Date(2026, 8, 9, 12, 2) }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(firstUnreadChannelMessageId(entries, 2)).toBe("m2");
  });

  it("skips the reader's own messages while it counts back to the unread boundary", () => {
    const author = { kind: "agent" as const, id: chief.id, name: "Chief" };
    const entries = channelTimelineEntries(
      page([
        message({ id: "m1", sequence: 1, author, createdAt: new Date(2026, 8, 9, 12, 0) }),
        message({ id: "m2", sequence: 2, author: member, createdAt: new Date(2026, 8, 9, 12, 1) }),
        message({ id: "m3", sequence: 3, author, createdAt: new Date(2026, 8, 9, 12, 2) }),
      ]),
      [chief],
      (id) => id === "local",
      options,
    );
    expect(firstUnreadChannelMessageId(entries, 2)).toBe("m1");
  });

  it("draws no unread divider when the reader has seen everything", () => {
    const entries = channelTimelineEntries(
      page([
        message({
          id: "m1",
          sequence: 1,
          author: { kind: "agent", id: chief.id, name: "Chief" },
          createdAt: new Date(2026, 8, 9, 12, 0),
        }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(firstUnreadChannelMessageId(entries, 0)).toBeNull();
  });

  it("leaves out a message with no text, no attachment and no question", () => {
    const author = { kind: "agent" as const, id: chief.id, name: "Chief" };
    const entries = channelTimelineEntries(
      page([
        message({ id: "m1", sequence: 1, author, createdAt: new Date(2026, 8, 9, 12, 0), text: "  " }),
        message({ id: "m2", sequence: 2, author, createdAt: new Date(2026, 8, 9, 12, 1) }),
      ]),
      [chief],
      () => false,
      options,
    );
    expect(entries.map((entry) => entry.id)).toEqual(["m2"]);
  });
});

describe("isOwnChannelAuthor", () => {
  const host = { memberId: "member-9", accountUserId: "user-1", onOwnComputer: true };

  it("keeps a message the host wrote before signing in their own", () => {
    expect(isOwnChannelAuthor("local", host)).toBe(true);
    expect(isOwnChannelAuthor("local", { memberId: null, accountUserId: null, onOwnComputer: true })).toBe(true);
  });

  it("reads the signed-out author as the host, not as the reader, on a server they joined", () => {
    // The reader here is a member of another person's server. That person wrote the message.
    expect(isOwnChannelAuthor("local", { ...host, onOwnComputer: false })).toBe(false);
  });

  it("answers for the reader's own member and account ids", () => {
    expect(isOwnChannelAuthor("member-9", host)).toBe(true);
    expect(isOwnChannelAuthor("local-user:user-1", host)).toBe(true);
    expect(isOwnChannelAuthor("member-2", host)).toBe(false);
    expect(isOwnChannelAuthor("local-user:user-2", host)).toBe(false);
  });
});
