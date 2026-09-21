import { continuesSenderRun } from "./chat-grouping";
import { agentConversationKey, agentMessageKey, composerDraftKey } from "./conversation-keys";
import { mergeConversationPage, windowedSnapshotMessages } from "./conversation-merge";

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
