import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { continuesSenderRun } from "./chat-grouping";
import { agentConversationKey, agentMessageKey, composerDraftKey } from "./conversation-keys";
import {
  mergeConversationFragment,
  mergeConversationPage,
  retainLatestConversationRows,
  windowedSnapshotMessages,
} from "./conversation-merge";

const message = (id: string) => ({ id });
const ids = (messages: readonly { id: string }[]) => messages.map((entry) => entry.id);

describe("mergeConversationPage", () => {
  it("shows a replacing page on its own", () => {
    const merged = mergeConversationPage([message("old"), message("older")], [message("fresh")], "replace");

    expect(ids(merged)).toEqual(["fresh"]);
  });

  it("puts an older page above what is loaded", () => {
    const merged = mergeConversationPage([message("b"), message("c")], [message("a")], "older");

    expect(ids(merged)).toEqual(["a", "b", "c"]);
  });

  it("puts a later page below what is loaded", () => {
    const merged = mergeConversationPage([message("a"), message("b")], [message("c")], "latest");

    expect(ids(merged)).toEqual(["a", "b", "c"]);
  });

  it("moves an overlapping message rather than showing it twice", () => {
    const loaded = [message("a"), message("b")];
    const page = [message("b"), message("c")];

    expect(ids(mergeConversationPage(loaded, page, "latest"))).toEqual(["a", "b", "c"]);
    expect(ids(mergeConversationPage(loaded, page, "older"))).toEqual(["b", "c", "a"]);
  });

  it("keeps the page's copy of a message that is in both", () => {
    const stale = { id: "b", text: "streaming" };
    const fresh = { id: "b", text: "final" };

    const merged = mergeConversationPage([{ id: "a", text: "a" }, stale], [fresh], "latest");

    expect(merged.at(-1)).toBe(fresh);
  });
});

describe("windowedSnapshotMessages", () => {
  it("shows a complete conversation whole, however little is loaded", () => {
    const windowed = windowedSnapshotMessages([message("c")], [message("a"), message("b"), message("c")], {
      hasOlder: false,
      mode: "latest",
    });

    expect(ids(windowed)).toEqual(["a", "b", "c"]);
  });

  it("keeps the loaded older messages when a refresh arrives with new replies", () => {
    const windowed = windowedSnapshotMessages(
      [message("b"), message("c")],
      [message("a"), message("b"), message("c"), message("d")],
      { hasOlder: true, mode: "latest" },
    );

    expect(ids(windowed)).toEqual(["b", "c", "d"]);
  });

  it("takes new replies from a refresh that no longer reaches the loaded messages", () => {
    const windowed = windowedSnapshotMessages([message("a")], [message("y"), message("z")], {
      hasOlder: true,
      mode: "latest",
    });

    expect(ids(windowed)).toEqual(["y", "z"]);
  });

  it("holds a window loaded around a message to what is already on screen", () => {
    const windowed = windowedSnapshotMessages(
      [message("b"), message("c")],
      [message("b"), message("c"), message("y"), message("z")],
      { hasOlder: true, mode: "around" },
    );

    expect(ids(windowed)).toEqual(["b", "c"]);
  });
});

const timedMessage = (id: string, seconds: number, fields: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id,
  author: "assistant",
  text: id,
  createdAt: new Date(Date.UTC(2026, 9, 8, 0, 0, seconds)).toISOString(),
  status: "completed",
  ...fields,
});

describe("latest snapshot membership after turn ordering", () => {
  const latest = { hasOlder: true, mode: "latest" } as const;

  it("keeps later inputs and progress in the upstream chronological order", () => {
    const initial = timedMessage("initial", 0, { author: "user", turnId: "current" });
    const reply = timedMessage("reply", 1, { turnId: "current" });
    const inputs = [
      timedMessage("first-input", 2, { author: "user", turnId: "current" }),
      timedMessage("second-input", 3, { author: "user", turnId: "current" }),
      timedMessage("plan", 4, { itemType: "plan", turnId: "current" }),
      timedMessage("commentary", 5, { itemType: "commentary", turnId: "current" }),
    ];
    const snapshot = sortConversationMessages([timedMessage("old", -1), initial, reply, ...inputs]);

    expect(ids(windowedSnapshotMessages([initial, reply], snapshot, latest))).toEqual([
      "initial",
      "reply",
      "first-input",
      "second-input",
      "plan",
      "commentary",
    ]);
  });

  it("keeps a later input without restoring the unloaded turn prefix", () => {
    const historicalInput = timedMessage("historical-input", 0, { author: "user", turnId: "current" });
    const historicalReply = timedMessage("historical-reply", 1, { turnId: "current" });
    const reply = timedMessage("reply", 2, { turnId: "current" });
    const input = timedMessage("new-input", 3, { author: "user", turnId: "current" });
    const snapshot = sortConversationMessages([historicalInput, historicalReply, reply, input]);

    expect(ids(windowedSnapshotMessages([reply], snapshot, latest))).toEqual(["reply", "new-input"]);
  });

  it("keeps incoming agent and routine messages through the same membership rule", () => {
    const reply = timedMessage("reply", 2, { turnId: "current" });
    const incoming = timedMessage("incoming", 3, {
      author: "agent",
      turnId: "current",
      exchange: {
        direction: "incoming",
        messageId: "incoming",
        senderAgentId: "peer",
        recipientAgentIds: ["chief"],
        replyToMessageId: null,
        deliveries: [],
      },
    });
    const routine = timedMessage("routine", 4, {
      author: "user",
      turnId: "current",
      routine: { routineId: "routine", runId: "run", name: "Routine", scheduledFor: "2026-10-08T00:00:04.000Z" },
    });
    const snapshot = sortConversationMessages([timedMessage("old", -1), reply, incoming, routine]);

    expect(ids(windowedSnapshotMessages([reply], snapshot, latest))).toEqual(["incoming", "reply", "routine"]);
  });

  it("does not use turn membership alone to restore old rows at the page boundary", () => {
    const reply = timedMessage("reply", 2, { turnId: "current" });
    const oldInput = timedMessage("old-input", 2, { author: "user", turnId: "current" });
    const currentInput = timedMessage("current-input", 3, { author: "user", turnId: "current" });
    const snapshot = sortConversationMessages([oldInput, reply, currentInput]);

    expect(ids(windowedSnapshotMessages([reply], snapshot, latest))).toEqual(["reply", "current-input"]);
  });

  it("uses the supplied raw-page boundary when projected rows start later", () => {
    const reply = timedMessage("reply", 2, { turnId: "current" });
    const inserted = timedMessage("inserted", 1, { author: "user", turnId: "current" });
    const snapshot = sortConversationMessages([timedMessage("old", -1), reply, inserted]);

    expect(
      ids(
        windowedSnapshotMessages([reply], snapshot, {
          ...latest,
          oldestLoadedMessageTime: Date.parse(timedMessage("hidden-page-row", 0).createdAt),
        }),
      ),
    ).toEqual(["inserted", "reply"]);
  });

  it("keeps an around window restricted even when a time boundary is supplied", () => {
    const reply = timedMessage("reply", 2, { turnId: "current" });
    const inserted = timedMessage("inserted", 3, { author: "user", turnId: "current" });
    const snapshot = sortConversationMessages([reply, inserted]);

    expect(
      ids(
        windowedSnapshotMessages([reply], snapshot, {
          hasOlder: true,
          mode: "around",
          oldestLoadedMessageTime: Date.parse(reply.createdAt),
        }),
      ),
    ).toEqual(["reply"]);
  });

  it("keeps a new message between loaded turns without restoring earlier history", () => {
    const earlier = timedMessage("earlier", -1, { turnId: "earlier" });
    const first = timedMessage("first", 0, { turnId: "first" });
    const inserted = timedMessage("inserted", 1, { author: "user", turnId: "inserted" });
    const last = timedMessage("last", 2, { turnId: "last" });
    const snapshot = sortConversationMessages([earlier, first, inserted, last]);

    expect(ids(windowedSnapshotMessages([first, last], snapshot, latest))).toEqual(["first", "inserted", "last"]);
  });
});

describe("conversation keys", () => {
  it("keys drafts by server and agent", () => {
    expect(composerDraftKey({ agentId: "chief", serverId: "local" })).toBe("chief");
    expect(composerDraftKey({ agentId: "chief", serverId: "team-1" })).toBe("team-1:chief");
    expect(composerDraftKey({ agentId: "chief", serverId: "team-1" })).not.toBe(
      composerDraftKey({ agentId: "chief", serverId: "team-2" }),
    );
  });

  it("keeps conversation and message keys unambiguous", () => {
    expect(agentConversationKey("s", "a:b")).not.toBe(agentConversationKey("s:a", "b"));
    expect(agentMessageKey("chief", "m1")).toBe("chief\0m1");
  });
});

const openRow = { previousDrawsTime: true, startsDay: false };

function chatRow(author: string, minute: number) {
  return { author, createdAt: new Date(2026, 8, 9, 14, minute).toISOString() };
}

describe("continuesSenderRun", () => {
  it("continues a run of one sender inside the window", () => {
    expect(continuesSenderRun(chatRow("agent", 0), chatRow("agent", 4), openRow)).toBe(true);
  });

  it("opens a run for the first row of the transcript", () => {
    expect(continuesSenderRun(undefined, chatRow("agent", 0), openRow)).toBe(false);
  });

  it("opens a run when the sender changes", () => {
    expect(continuesSenderRun(chatRow("you", 0), chatRow("agent", 1), openRow)).toBe(false);
  });

  it("opens a run after a pause longer than the window", () => {
    expect(continuesSenderRun(chatRow("agent", 0), chatRow("agent", 6), openRow)).toBe(false);
  });

  it("opens a run under a day separator", () => {
    expect(continuesSenderRun(chatRow("agent", 0), chatRow("agent", 1), { ...openRow, startsDay: true })).toBe(false);
  });

  it("opens a run under a row that draws no time", () => {
    expect(continuesSenderRun(chatRow("agent", 0), chatRow("agent", 1), { ...openRow, previousDrawsTime: false })).toBe(
      false,
    );
  });

  it("opens a run when either row has no stored time", () => {
    expect(continuesSenderRun({ author: "agent" }, chatRow("agent", 1), openRow)).toBe(false);
    expect(continuesSenderRun(chatRow("agent", 0), { author: "agent" }, openRow)).toBe(false);
  });
});

describe("authoritative window membership", () => {
  it("does not backfill old equal-time rows when a bounded snapshot has no overlap", () => {
    const createdAt = "2026-10-08T00:00:02.000Z";
    const loaded = [{ id: "reply", createdAt }];
    const snapshot = [
      { id: "old-prefix", createdAt, visibilityEpoch: 1 },
      { id: "input", createdAt, visibilityEpoch: 51 },
    ];
    expect(
      ids(
        windowedSnapshotMessages(loaded, snapshot, {
          hasOlder: true,
          mode: "latest",
          visibilityFloor: 50,
          pageRevision: 100,
          authoritative: true,
        }),
      ),
    ).toEqual(["input"]);
  });
  it("keeps an around window at the beginning of history from absorbing the remote tail", () => {
    expect(
      ids(
        windowedSnapshotMessages([message("anchor")], [message("anchor"), message("far")], {
          hasOlder: false,
          mode: "around",
        }),
      ),
    ).toEqual(["anchor"]);
  });
});

describe("equal-epoch membership review", () => {
  it.each([0, 1000])("does not admit a same-epoch old prefix before the loaded page (time offset: %s)", (offset) => {
    const createdAt = "2026-10-08T00:00:02.000Z";
    const prefix = {
      id: "old-prefix",
      createdAt: new Date(Date.parse(createdAt) + offset).toISOString(),
      visibilityEpoch: 10,
    };
    const reply = { id: "reply", createdAt, visibilityEpoch: 10 };
    expect(
      windowedSnapshotMessages([reply], [prefix, reply], {
        hasOlder: true,
        mode: "latest",
        visibilityFloor: 10,
        pageRevision: 20,
        authoritative: true,
      }).map((message) => message.id),
    ).toEqual(["reply"]);
  });
  it("keeps the ordinary chronological tail for inactive same-epoch history", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, visibilityEpoch: 10 }));
    expect(retainLatestConversationRows(rows, 50).map((message) => message.id)).toEqual(
      rows.slice(-50).map((message) => message.id),
    );
  });
});

describe("authoritative fragment anchors", () => {
  it("keeps an observed input before retained replies when the fresh tail skips those replies", () => {
    const loaded = ["first", "input", "reply-0", "reply-1", "reply-2"].map(message);
    const page = ["input", "reply-2", "reply-3"].map(message);
    const merged = mergeConversationFragment(loaded, page, "latest");
    expect(ids(merged)).toEqual(["first", "input", "reply-0", "reply-1", "reply-2", "reply-3"]);
    expect(merged[2]).toBe(loaded[2]);
    expect(merged[4]).toBe(page[1]);
  });

  it("keeps the new older fragment and the retained later tail without duplicate anchors", () => {
    const loaded = ["input", "reply-1", "reply-2", "reply-3"].map(message);
    const page = ["first", "input", "reply-0", "reply-1"].map(message);
    const merged = mergeConversationFragment(loaded, page, "older");
    expect(ids(merged)).toEqual(["first", "input", "reply-0", "reply-1", "reply-2", "reply-3"]);
    expect(merged[4]).toBe(loaded[2]);
  });
});
