import type {
  ConversationPage,
  ConversationReadState,
  DirectConversationPage,
  DirectConversationSnapshot,
  DirectThreadSummary,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { AppAccessGate } from "./AppView";
import { AppProviders } from "./app-providers";
import {
  emitAgentEvent,
  emitDirectMessage,
  emitDynamicIslandAction,
  emitPresence,
  emitServers,
  installOpenbotStub,
  presenceMember,
  testConversationPage,
  testServer,
} from "./app-test-harness";
import { useChannels } from "./features/channels/channels-context";
import { useConversation } from "./features/conversation/conversation-context";
import { useDirectMessages } from "./features/conversation/direct-messages-context";
import { useServerScope } from "./features/servers/server-scope";
import { useServers } from "./features/servers/servers-context";
import { useUsage } from "./features/usage/usage-context";

/**
 * The tree `App` mounts, plus controls that open and close the Usage report. The report
 * covers the workspace content and marks it inert, so a message that arrives or waits
 * behind it was never seen, however focused the window is.
 */
function UsageProbe() {
  const { activeServerId } = useServers();
  const usage = useUsage();
  return (
    <>
      <button type="button" onClick={() => usage.openUsage(activeServerId(), null)}>
        Open usage
      </button>
      <button type="button" onClick={() => usage.closeUsage()}>
        Close usage
      </button>
    </>
  );
}

/**
 * Opens a channel over the workspace. The agent stays selected under it, which is the state the
 * read predicate has to refuse: the reply is on a chat the channel covers.
 */
function ChannelProbe() {
  const channels = useChannels();
  return (
    <button
      type="button"
      onClick={() => {
        void (async () => {
          await window.openbot.agent.channelCommand({
            type: "save",
            operationId: "channel-read-op",
            channelId: "channel-read",
            draft: { name: "Project", title: "", instructions: "", members: [{ agentId: "chief" }], leadAgentId: null },
          });
          await channels.open("channel-read");
        })();
      }}
    >
      Open channel
    </button>
  );
}

function CloseChannelProbe() {
  const channels = useChannels();
  return (
    <button type="button" onClick={() => channels.close()}>
      Close channel
    </button>
  );
}

describe("OpenBot connected desktop shell", () => {
  beforeEach(() => {
    installOpenbotStub();
  });

  it.each(["older response", "older failure", "latest failure"])(
    "retains current direct-thread unread state after an %s",
    async (outcome) => {
      let refresh = async (): Promise<void> => {
        throw new Error("The provider is not ready.");
      };
      function Probe() {
        const direct = useDirectMessages();
        const scope = useServerScope();
        refresh = direct.refreshDirectThreads;
        return (
          <output aria-label="Direct unread">
            {scope.loaded() ? (direct.directThreads()[0]?.unreadCount ?? 0) : "Loading"}
          </output>
        );
      }
      render(() => (
        <AppProviders>
          <Probe />
        </AppProviders>
      ));
      await waitFor(() => expect(screen.getByLabelText("Direct unread")).toHaveTextContent("0"));
      emitPresence?.({
        serverId: "local",
        updatedAt: "2026-09-08T00:00:00Z",
        members: [presenceMember("self", "person@example.com", "Person")],
      });
      const threads: DirectThreadSummary[] = [
        {
          threadId: "direct-1",
          otherMemberId: "alice",
          unreadCount: 2,
          updatedAt: "2026-09-08T00:00:00Z",
          lastMessage: {
            id: "message-1",
            threadId: "direct-1",
            senderMemberId: "alice",
            recipientMemberId: "self",
            text: "Hello",
            sequence: 2,
            createdAt: "2026-09-08T00:00:00Z",
          },
        },
      ];
      vi.mocked(window.openbot.servers.listDirectThreads).mockResolvedValueOnce(threads);
      await refresh();
      flush();
      expect(screen.getByLabelText("Direct unread")).toHaveTextContent("2");
      let resolvePending: ((value: DirectThreadSummary[]) => void) | undefined;
      let rejectPending: ((error: Error) => void) | undefined;
      vi.mocked(window.openbot.servers.listDirectThreads).mockReturnValueOnce(
        new Promise((resolve, reject) => {
          resolvePending = resolve;
          rejectPending = reject;
        }),
      );
      const pending = refresh();
      if (outcome !== "latest failure") {
        vi.mocked(window.openbot.servers.listDirectThreads).mockResolvedValueOnce(threads);
        await refresh();
      }
      if (outcome === "older response") resolvePending?.([]);
      else rejectPending?.(new Error("The host is offline."));
      await pending;
      flush();
      expect(screen.getByLabelText("Direct unread")).toHaveTextContent("2");
    },
  );

  it.each(["success", "failure", "late response", "received message", "visible message", "sent message"])(
    "refreshes the open direct conversation on reconnect (%s)",
    async (outcome) => {
      const remote = { ...testServer("remote-1", true), connectionSequence: 1 };
      vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([remote]);
      vi.mocked(window.openbot.servers.getPresence).mockResolvedValue({
        serverId: remote.id,
        updatedAt: "2026-09-08T00:00:00Z",
        members: [
          presenceMember("self", "person@example.com", "Person"),
          presenceMember("alice", "alice@example.com", "Alice"),
        ],
      });
      const page = (text: string, revision: number): DirectConversationPage => ({
        threadId: "direct-1",
        otherMemberId: "alice",
        revision,
        messages: [
          {
            id: `message-${revision}`,
            threadId: "direct-1",
            senderMemberId: "alice",
            recipientMemberId: "self",
            text,
            sequence: revision,
            createdAt: "2026-09-08T00:00:00Z",
          },
        ],
        readState: { unreadCount: 0, firstUnreadMessageId: null, throughSequence: revision },
        pageInfo: { hasOlder: false, olderCursor: null },
      });
      vi.mocked(window.openbot.servers.readDirectConversationPage).mockResolvedValueOnce(
        page("Cached direct message", 1),
      );
      let loadedMessage: () => string | undefined = () => undefined;
      let readState: () => DirectConversationSnapshot["readState"] = () => undefined;
      let send = async (): Promise<void> => {
        throw new Error("The provider is not ready.");
      };
      function Probe() {
        const direct = useDirectMessages();
        loadedMessage = () => direct.directConversations().alice?.messages[0]?.text;
        readState = () => direct.directConversations().alice?.readState;
        send = async () => {
          await direct.sendDirectMessage("Sent during refresh", "sent-3");
        };
        return null;
      }
      render(() => (
        <AppProviders peopleEnabled>
          <AppAccessGate />
          <Probe />
        </AppProviders>
      ));
      await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
      await screen.findByText("Cached direct message");
      let resolvePage: ((value: DirectConversationPage) => void) | undefined;
      let rejectPage: ((error: Error) => void) | undefined;
      const pendingPage = new Promise<DirectConversationPage>((resolve, reject) => {
        resolvePage = resolve;
        rejectPage = reject;
      });
      vi.mocked(window.openbot.servers.readDirectConversationPage).mockReturnValueOnce(pendingPage);
      emitServers?.([{ ...remote, connectionSequence: 2 }]);
      await waitFor(() => expect(window.openbot.servers.readDirectConversationPage).toHaveBeenCalledTimes(2));
      expect(screen.getByText("Cached direct message")).toBeInTheDocument();
      if (outcome === "late response") {
        vi.mocked(window.openbot.servers.readDirectConversationPage).mockResolvedValueOnce(
          page("Missed direct message", 3),
        );
        emitServers?.([{ ...remote, connectionSequence: 3 }]);
        await screen.findByText("Missed direct message");
      }
      const incoming = outcome === "received message" || outcome === "visible message";
      if (incoming) {
        if (outcome === "received message") window.dispatchEvent(new Event("blur"));
        emitDirectMessage?.({
          type: "team-direct-message",
          memberIds: ["self", "alice"],
          message: {
            id: "live-3",
            threadId: "direct-1",
            senderMemberId: "alice",
            recipientMemberId: "self",
            text: "Received during refresh",
            sequence: 3,
            createdAt: "2026-09-08T00:00:00Z",
          },
        });
        await screen.findByText("Received during refresh");
      }
      if (outcome === "sent message") {
        vi.mocked(window.openbot.servers.sendDirectMessage).mockResolvedValueOnce({
          id: "sent-3",
          threadId: "direct-1",
          senderMemberId: "self",
          recipientMemberId: "alice",
          text: "Sent during refresh",
          sequence: 3,
          createdAt: "2026-09-08T00:00:00Z",
        });
        await send();
      }
      if (outcome === "visible message" || outcome === "sent message") {
        await waitFor(() => expect(readState()?.throughSequence).toBe(3));
      }
      if (outcome === "failure") rejectPage?.(new Error("The host is offline."));
      else resolvePage?.(page(outcome === "late response" ? "Stale direct message" : "Missed direct message", 2));
      await pendingPage.catch(() => undefined);
      flush();
      expect(loadedMessage()).toBe(outcome === "failure" ? "Cached direct message" : "Missed direct message");
      if (incoming) {
        expect(await screen.findByText("Received during refresh")).toBeInTheDocument();
        expect(readState()?.unreadCount).toBe(outcome === "received message" ? 1 : 0);
      }
      if (outcome === "sent message") expect(await screen.findByText("Sent during refresh")).toBeInTheDocument();
      if (outcome === "visible message" || outcome === "sent message") expect(readState()?.throughSequence).toBe(3);
      expect(
        await screen.findByText(outcome === "failure" ? "Cached direct message" : "Missed direct message"),
      ).toBeInTheDocument();
    },
  );

  it("clears desktop unread state when the same member reads on another device", async () => {
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(
      testConversationPage("chief", [], {
        readState: { unreadCount: 1, firstUnreadMessageId: "reply", throughMessageId: null },
      }),
    );
    let unreadCount = 1;
    vi.mocked(window.openbot.agent.listConversationReads).mockImplementation(async () => ({
      chief: {
        unreadCount,
        firstUnreadMessageId: unreadCount ? "reply" : null,
        throughMessageId: unreadCount ? null : "reply",
      },
    }));
    function Probe() {
      const conversation = useConversation();
      const scope = useServerScope();
      return (
        <output aria-label="Unread replies">
          {scope.loaded() ? (conversation.conversations.chief?.read?.unreadCount ?? -1) : "Loading"}
        </output>
      );
    }
    render(() => (
      <AppProviders>
        <Probe />
      </AppProviders>
    ));
    await waitFor(() => expect(screen.getByLabelText("Unread replies")).toHaveTextContent("1"));
    unreadCount = 0;
    emitAgentEvent?.({ type: "conversation-invalidated", agentId: "chief", revision: 1 });
    await waitFor(() => expect(screen.getByLabelText("Unread replies")).toHaveTextContent("0"));
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
  });

  it("merges a refreshed remote conversation page without dropping loaded messages", async () => {
    const message = (id: string, text: string) => ({
      id,
      author: "assistant" as const,
      text,
      createdAt: "2026-08-30T02:00:00.000Z",
      status: "completed" as const,
    });
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(
      testConversationPage("chief", [message("reply-old", "Loaded earlier")], {
        pageInfo: { hasOlder: true, olderCursor: "older" },
      }),
    );
    render(() => <App />);
    expect(await screen.findByText("Loaded earlier")).toBeInTheDocument();

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage("chief", [message("reply-new", "Fresh remote reply")], {
        revision: 2,
        pageInfo: { hasOlder: true, olderCursor: "older" },
      }),
    });

    expect(await screen.findByText("Fresh remote reply")).toBeInTheDocument();
    expect(screen.getByText("Loaded earlier")).toBeInTheDocument();
  });

  it.each(["commentary", "answer"])("loads past commentary-only pages after a latest %s", async (latestKind) => {
    const thought = (id: string) => ({
      id,
      author: "assistant" as const,
      text: "Checking sources",
      itemType: "commentary",
      createdAt: "2026-08-30T02:02:00.000Z",
      status: "completed" as const,
    });
    vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(async (input) => {
      if (input.anchor?.type !== "before") {
        return testConversationPage(
          "chief",
          [{ ...thought("thought-latest"), itemType: latestKind === "commentary" ? "commentary" : undefined }],
          {
            pageInfo: { hasOlder: true, olderCursor: "middle" },
          },
        );
      }
      if (input.anchor.cursor === "middle") {
        return testConversationPage("chief", [thought("thought-middle")], {
          pageInfo: { hasOlder: true, olderCursor: "first" },
        });
      }
      return testConversationPage("chief", [
        {
          id: "earlier-answer",
          author: "assistant",
          text: "Earlier answer is reachable",
          createdAt: "2026-08-30T02:00:00.000Z",
          status: "completed",
        },
      ]);
    });
    render(() => <App />);
    expect(await screen.findByText("Earlier answer is reachable")).toBeInTheDocument();
  });

  it("keeps the current read state when an older page returns stale read data", async () => {
    const latestMessage = {
      id: "reply-latest-page",
      author: "assistant" as const,
      text: "Latest reply",
      createdAt: "2026-08-30T02:02:00.000Z",
      status: "completed" as const,
    };
    const latestPage = testConversationPage("chief", [latestMessage], {
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
      pageInfo: { hasOlder: true, olderCursor: "older" },
    });
    let resolveOlderPage: ((page: ConversationPage) => void) | undefined;
    vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(async (input) => {
      if (input.anchor?.type !== "before") return latestPage;
      return await new Promise((resolve) => {
        resolveOlderPage = resolve;
      });
    });

    // The probe reads the conversation domain from *under* `AppProviders`,
    // exactly where `App` mounts the view.
    function Harness() {
      return (
        <AppProviders>
          <HarnessBody />
        </AppProviders>
      );
    }

    function HarnessBody() {
      const conversation = useConversation();
      return (
        <>
          <button type="button" onClick={() => void conversation.loadOlderAgentMessages("chief")}>
            Load older agent messages
          </button>
          <output aria-label="agent read state">
            {conversation.conversations.chief?.read?.unreadCount ?? -1}|
            {conversation
              .activeMessages()
              .map((message) => message.id)
              .join(",")}
          </output>
        </>
      );
    }

    render(() => <Harness />);
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "agent read state" })).toHaveTextContent("0|reply-latest-page"),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Load older agent messages" }));
    await waitFor(() => expect(resolveOlderPage).toBeDefined());

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage("chief", [latestMessage], {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: latestMessage.id, throughMessageId: null },
        pageInfo: { hasOlder: true, olderCursor: "older" },
      }),
    });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "agent read state" })).toHaveTextContent("0|reply-latest-page"),
    );

    resolveOlderPage?.(
      testConversationPage(
        "chief",
        [
          {
            id: "reply-older-page",
            author: "assistant",
            text: "Older reply",
            createdAt: "2026-08-30T02:01:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: latestMessage.id, throughMessageId: null },
        },
      ),
    );

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "agent read state" })).toHaveTextContent(
        "0|reply-older-page,reply-latest-page",
      ),
    );
  });

  it("can load older messages after a latest-page request replaces the pending page", async () => {
    const page = testConversationPage("chief", [], {
      pageInfo: { hasOlder: true, olderCursor: "older" },
    });
    const older = Promise.withResolvers<ConversationPage>();
    const readOlder = vi.fn().mockReturnValue(older.promise);
    vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(async (input) =>
      input.anchor?.type === "before" ? readOlder() : page,
    );
    let conversation: ReturnType<typeof useConversation> | undefined;
    function Probe() {
      conversation = useConversation();
      const scope = useServerScope();
      return <output aria-label="Conversation loaded">{scope.loaded() ? "Ready" : "Loading"}</output>;
    }
    render(() => (
      <AppProviders>
        <Probe />
      </AppProviders>
    ));
    await waitFor(() => expect(screen.getByRole("status", { name: "Conversation loaded" })).toHaveTextContent("Ready"));
    const pendingOlder = conversation?.loadOlderAgentMessages("chief");
    await waitFor(() => expect(readOlder).toHaveBeenCalledOnce());
    await conversation?.loadLatestAgentMessages("chief");
    older.resolve(page);
    await pendingOlder;
    flush();
    readOlder.mockResolvedValue(
      testConversationPage("chief", [
        {
          id: "earlier-reply",
          author: "assistant",
          text: "Earlier reply",
          createdAt: "2026-08-30T02:00:00.000Z",
          status: "completed",
        },
      ]),
    );
    await conversation?.loadOlderAgentMessages("chief");
    flush();
    expect(conversation?.conversations.chief?.messages.map((message) => message.id)).toContain("earlier-reply");
  });

  it.each(["resolve", "reject"] as const)(
    "does not restore a removed conversation when its pending read and older page %s",
    async (outcome) => {
      const page = testConversationPage("chief", [], {
        pageInfo: { hasOlder: true, olderCursor: "older" },
      });
      const older = Promise.withResolvers<ConversationPage>();
      const read = Promise.withResolvers<ConversationReadState>();
      vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(async (input) =>
        input.anchor?.type === "before" ? older.promise : page,
      );
      vi.mocked(window.openbot.agent.markConversationRead).mockReturnValue(read.promise);
      let conversation: ReturnType<typeof useConversation> | undefined;
      function Probe() {
        conversation = useConversation();
        const scope = useServerScope();
        return (
          <output aria-label="Cached conversations">
            {scope.loaded() ? Object.keys(conversation.conversations).join(",") || "Empty" : "Loading"}
          </output>
        );
      }
      render(() => (
        <AppProviders>
          <Probe />
        </AppProviders>
      ));
      await waitFor(() =>
        expect(screen.getByRole("status", { name: "Cached conversations" })).toHaveTextContent("chief"),
      );
      const pendingOlder = conversation?.loadOlderAgentMessages("chief");
      const pendingRead = conversation?.markAgentMessagesRead("chief", "reply");
      await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalled());
      flush(() => conversation?.removeConversation("chief"));
      expect(screen.getByRole("status", { name: "Cached conversations" })).toHaveTextContent("Empty");
      if (outcome === "resolve") older.resolve(page);
      else older.reject(new Error("The conversation was removed."));
      read.resolve({ unreadCount: 0, firstUnreadMessageId: null, throughMessageId: "reply" });
      await Promise.all([pendingOlder, pendingRead]);
      flush();
      expect(screen.getByRole("status", { name: "Cached conversations" })).toHaveTextContent("Empty");
    },
  );

  it("does not persist a redundant read for an already-read refreshed page", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-already-read",
            author: "assistant",
            text: "Historical visible reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: "reply-already-read" },
        },
      ),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: /new messages?/ })).not.toBeInTheDocument();
  });

  it("keeps a successful realtime read when a pending reload resolves later", async () => {
    let resolveInitialPage: ((page: ConversationPage) => void) | undefined;
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({
      chief: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    });
    vi.mocked(window.openbot.agent.readConversationPage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitialPage = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(resolveInitialPage).toBeDefined());
    const unreadPage = testConversationPage(
      "chief",
      [
        {
          id: "reply-reload-race",
          author: "assistant",
          text: "Reply before the reload resolves",
          createdAt: "2026-08-30T02:02:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: "reply-reload-race", throughMessageId: null },
      },
    );

    emitAgentEvent?.({ type: "conversation-page", page: unreadPage });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());

    resolveInitialPage?.(unreadPage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "New messages" })).not.toBeInTheDocument();
  });

  it("keeps a duplicate refreshed page read while persistence is pending", async () => {
    let resolveRead: ((state: NonNullable<ConversationPage["readState"]>) => void) | undefined;
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({
      chief: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    });
    vi.mocked(window.openbot.agent.markConversationRead).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const duplicatePage = testConversationPage(
      "chief",
      [
        {
          id: "reply-pending-read",
          author: "assistant",
          text: "Reply with a pending read",
          createdAt: "2026-08-30T02:02:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: "reply-pending-read", throughMessageId: null },
      },
    );

    emitAgentEvent?.({ type: "conversation-page", page: duplicatePage });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument();

    emitAgentEvent?.({ type: "conversation-page", page: duplicatePage });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument();

    resolveRead?.({ unreadCount: 0, firstUnreadMessageId: null, throughMessageId: "reply-pending-read" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("restores a newer unread reply when its queued read fails", async () => {
    let resolveFirstRead: ((state: NonNullable<ConversationPage["readState"]>) => void) | undefined;
    let rejectSecondRead: ((error: Error) => void) | undefined;
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({
      chief: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    });
    vi.mocked(window.openbot.agent.markConversationRead)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSecondRead = reject;
          }),
      );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-read-a",
            author: "assistant",
            text: "First queued reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-read-a", throughMessageId: null },
        },
      ),
    });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-read-a",
            author: "assistant",
            text: "First queued reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
          {
            id: "reply-read-b",
            author: "assistant",
            text: "Newer queued reply",
            createdAt: "2026-08-30T02:03:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 3,
          readState: { unreadCount: 2, firstUnreadMessageId: "reply-read-a", throughMessageId: null },
        },
      ),
    });
    await screen.findByText("Newer queued reply");
    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce();

    resolveFirstRead?.({ unreadCount: 0, firstUnreadMessageId: null, throughMessageId: "reply-read-a" });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledTimes(2));
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValueOnce(
      testConversationPage(
        "chief",
        [
          {
            id: "reply-read-b",
            author: "assistant",
            text: "Newer queued reply",
            createdAt: "2026-08-30T02:03:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 3,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-read-b", throughMessageId: "reply-read-a" },
        },
      ),
    );
    rejectSecondRead?.(new Error("Newer read unavailable"));

    expect(await screen.findByText("Newer read unavailable")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
  });

  it("retries an automatic read for the same message after persistence fails", async () => {
    vi.mocked(window.openbot.agent.markConversationRead).mockRejectedValueOnce(new Error("Read unavailable"));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const page = testConversationPage(
      "chief",
      [
        {
          id: "reply-read-retry",
          author: "assistant",
          text: "Visible reply that needs a retry",
          createdAt: "2026-08-30T02:02:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: "reply-read-retry", throughMessageId: null },
      },
    );
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValueOnce(page);

    emitAgentEvent?.({ type: "conversation-page", page });
    expect(await screen.findByText("Read unavailable")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();

    emitAgentEvent?.({ type: "conversation-page", page });
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenNthCalledWith(
        2,
        {
          agentId: "chief",
          throughMessageId: "reply-read-retry",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("does not carry a failed automatic read to the same agent on another server", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let selectedServerId = "local";
    let returningToLocal = false;
    let rejectLocalRead: ((error: Error) => void) | undefined;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.openbot.servers.select).mockImplementation(async (serverId) => {
      selectedServerId = serverId;
      returningToLocal = serverId === "local";
      return [
        { ...local, active: serverId === "local" },
        { ...remote, active: serverId === "remote-1" },
      ];
    });
    vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(async (input) => {
      if (selectedServerId === "remote-1") {
        return testConversationPage(
          input.agentId,
          [
            {
              id: "reply-remote-loaded",
              author: "assistant",
              text: "Remote loaded reply",
              createdAt: "2026-08-30T02:02:30.000Z",
              status: "completed",
            },
          ],
          {
            readState: { unreadCount: 1, firstUnreadMessageId: "reply-remote-loaded", throughMessageId: null },
          },
        );
      }
      if (returningToLocal) {
        return testConversationPage(
          input.agentId,
          [
            {
              id: "reply-local",
              author: "assistant",
              text: "Local reply after returning",
              createdAt: "2026-08-30T02:02:00.000Z",
              status: "completed",
            },
          ],
          {
            readState: { unreadCount: 1, firstUnreadMessageId: "reply-local", throughMessageId: null },
          },
        );
      }
      return testConversationPage(input.agentId);
    });
    vi.mocked(window.openbot.agent.listConversationReads)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        chief: { unreadCount: 1, firstUnreadMessageId: "reply-remote", throughMessageId: null },
      })
      .mockResolvedValueOnce({
        chief: { unreadCount: 1, firstUnreadMessageId: "reply-local", throughMessageId: null },
      });
    vi.mocked(window.openbot.agent.markConversationRead).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectLocalRead = reject;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-local",
            author: "assistant",
            text: "Local visible reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-local", throughMessageId: null },
        },
      ),
    });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(window.openbot.servers.select).toHaveBeenCalledWith("remote-1"));
    await waitFor(() => expect(window.openbot.agent.listConversationReads).toHaveBeenCalledTimes(2));
    await screen.findByText("Remote loaded reply");
    expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument();
    rejectLocalRead?.(new Error("Local read unavailable"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-remote",
            author: "assistant",
            text: "Remote unread reply",
            createdAt: "2026-08-30T02:03:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-remote", throughMessageId: null },
        },
      ),
    });
    await screen.findByText("Remote unread reply");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce();
    expect(screen.queryByText("Local read unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Local server" }));
    await waitFor(() => expect(window.openbot.agent.listConversationReads).toHaveBeenCalledTimes(3));
    await screen.findByText("Local reply after returning");
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenNthCalledWith(
        2,
        { agentId: "chief", throughMessageId: "reply-local" },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("keeps a queued read scoped to its original server", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveFirstRead: ((state: NonNullable<ConversationPage["readState"]>) => void) | undefined;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.openbot.servers.select).mockResolvedValueOnce([
      { ...local, active: false },
      { ...remote, active: true },
    ]);
    vi.mocked(window.openbot.agent.markConversationRead)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockImplementationOnce(async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughMessageId: input.throughMessageId,
      }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-first-local",
            author: "assistant",
            text: "First local reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-first-local", throughMessageId: null },
        },
      ),
    });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-first-local",
            author: "assistant",
            text: "First local reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
          {
            id: "reply-second-local",
            author: "assistant",
            text: "Second local reply",
            createdAt: "2026-08-30T02:03:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 3,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-second-local", throughMessageId: null },
        },
      ),
    });
    await screen.findByText("Second local reply");
    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(window.openbot.agent.listConversationReads).toHaveBeenCalledTimes(2));
    resolveFirstRead?.({
      unreadCount: 1,
      firstUnreadMessageId: "reply-second-local",
      throughMessageId: "reply-first-local",
    });

    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledTimes(2));
    expect(window.openbot.agent.markConversationRead).toHaveBeenNthCalledWith(
      2,
      { agentId: "chief", throughMessageId: "reply-second-local" },
      "local",
    );
  });

  it("does not mark an older boundary from a rejected conversation page", async () => {
    let resolveInitialPage: ((page: ConversationPage) => void) | undefined;
    vi.mocked(window.openbot.agent.readConversationPage).mockImplementation(
      async (): Promise<ConversationPage> =>
        await new Promise((resolve) => {
          resolveInitialPage = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-newer-boundary",
            author: "assistant",
            text: "Newest visible reply",
            createdAt: "2026-08-30T02:02:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-newer-boundary", throughMessageId: null },
        },
      ),
    });
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "reply-newer-boundary",
        },
        "local",
      ),
    );

    resolveInitialPage?.(
      testConversationPage(
        "chief",
        [
          {
            id: "reply-older-boundary",
            author: "assistant",
            text: "Older reply",
            createdAt: "2026-08-30T02:01:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 1,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-older-boundary", throughMessageId: null },
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalledWith(
      {
        agentId: "chief",
        throughMessageId: "reply-older-boundary",
      },
      "local",
    );
    expect(screen.getByText("Newest visible reply")).toBeInTheDocument();
  });

  it("retries an explicit chat-open reload when its page revision is stale", async () => {
    const unreadState = {
      unreadCount: 1,
      firstUnreadMessageId: "reply-current-revision",
      throughMessageId: null,
    };
    const currentPage = testConversationPage(
      "chief",
      [
        {
          id: "reply-current-revision",
          author: "assistant",
          text: "Current revision reply",
          createdAt: "2026-08-30T02:03:00.000Z",
          status: "completed",
        },
      ],
      { revision: 2, readState: unreadState },
    );
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({ chief: unreadState });
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValue({
      agentId: "chief",
      threadId: currentPage.threadId,
      activeTurnId: null,
      revision: currentPage.revision,
      readState: unreadState,
      messages: currentPage.messages,
    });
    render(() => <App />);
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    // The retry only has something to be stale against once the opening load
    // has landed, so wait for revision 2 to be on screen before queueing the
    // stale page. Without this the click can outrun the first page and the
    // test measures microtask order instead of the revision guard.
    await screen.findByText("Current revision reply");

    vi.mocked(window.openbot.agent.readConversationPage)
      .mockResolvedValueOnce(
        testConversationPage(
          "chief",
          [
            {
              id: "reply-stale-revision",
              author: "assistant",
              text: "Stale revision reply",
              createdAt: "2026-08-30T02:02:00.000Z",
              status: "completed",
            },
          ],
          {
            revision: 1,
            readState: { unreadCount: 1, firstUnreadMessageId: "reply-stale-revision", throughMessageId: null },
          },
        ),
      )
      .mockResolvedValueOnce(currentPage);
    const readsBeforeOpen = vi.mocked(window.openbot.agent.readConversationPage).mock.calls.length;
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "reply-current-revision",
        },
        "local",
      ),
    );
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalledWith(
      {
        agentId: "chief",
        throughMessageId: "reply-stale-revision",
      },
      "local",
    );
    // Opening reads once and the stale revision costs a second read. Falling
    // back to whatever was already on screen would reach the same read state
    // with one, so the count is what says the reload was retried.
    expect(vi.mocked(window.openbot.agent.readConversationPage).mock.calls.length - readsBeforeOpen).toBe(2);
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("uses the latest visible reply after one stale retry without reloading the queue", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-applied-revision",
            author: "assistant",
            text: "Applied revision reply",
            createdAt: "2026-08-30T02:03:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: "reply-applied-revision" },
        },
      ),
    });
    await screen.findByText("Applied revision reply");
    const stalePage = testConversationPage("chief", [], {
      revision: 1,
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    });
    const callsBeforeOpen = vi.mocked(window.openbot.agent.readConversationPage).mock.calls.length;
    const queueCallsBeforeOpen = vi.mocked(window.openbot.agent.listQueue).mock.calls.length;
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(stalePage);

    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() => expect(window.openbot.agent.readConversationPage).toHaveBeenCalledTimes(callsBeforeOpen + 2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.openbot.agent.readConversationPage).toHaveBeenCalledTimes(callsBeforeOpen + 2);
    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
      { agentId: "chief", throughMessageId: "reply-applied-revision" },
      "local",
    );
    expect(window.openbot.agent.listQueue).toHaveBeenCalledTimes(queueCallsBeforeOpen);
  });

  it("applies an explicit read after an older automatic read", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const firstPage = testConversationPage(
      "chief",
      [
        {
          id: "reply-automatic-first",
          author: "assistant",
          text: "First automatic reply",
          createdAt: "2026-08-30T02:03:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: "reply-automatic-first", throughMessageId: null },
      },
    );
    emitAgentEvent?.({ type: "conversation-page", page: firstPage });
    await waitFor(() => expect(window.openbot.agent.markConversationRead).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    await screen.findByRole("heading", { name: "Sales Outbound" });
    const newerPage = testConversationPage(
      "chief",
      [
        ...firstPage.messages,
        {
          id: "reply-explicit-newer",
          author: "assistant",
          text: "Newer reply while closed",
          createdAt: "2026-08-30T02:04:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 3,
        readState: {
          unreadCount: 1,
          firstUnreadMessageId: "reply-explicit-newer",
          throughMessageId: "reply-automatic-first",
        },
      },
    );
    emitAgentEvent?.({ type: "conversation-page", page: newerPage });
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValueOnce(newerPage);

    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenNthCalledWith(
        2,
        { agentId: "chief", throughMessageId: "reply-explicit-newer" },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("marks the latest visible reply when a chat-open reload fails", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    await screen.findByRole("heading", { name: "Sales Outbound" });
    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "reply-before-load-failure",
            author: "assistant",
            text: "Visible reply before load failure",
            createdAt: "2026-08-30T02:04:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-before-load-failure", throughMessageId: null },
        },
      ),
    });
    vi.mocked(window.openbot.agent.readConversationPage).mockRejectedValueOnce(new Error("Reload unavailable"));

    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    expect(await screen.findByText("Reload unavailable")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        { agentId: "chief", throughMessageId: "reply-before-load-failure" },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("shows and clears the unread boundary in an agent conversation", async () => {
    const readState = {
      unreadCount: 2,
      firstUnreadMessageId: "agent-new-1",
      throughMessageId: "agent-old",
    };
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({
      chief: readState,
    });
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValue({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 3,
      readState,
      messages: [
        {
          id: "agent-old",
          author: "user",
          text: "Old message",
          createdAt: "2026-08-19T09:00:00.000Z",
          status: "completed",
        },
        {
          id: "agent-new-1",
          author: "agent",
          source: "agent",
          senderAgentId: "sales-outbound",
          text: "First unseen agent answer",
          createdAt: "2026-08-19T09:01:00.000Z",
          status: "completed",
          exchange: {
            direction: "incoming",
            messageId: "agent-new-1",
            senderAgentId: "sales-outbound",
            recipientAgentIds: ["chief"],
            replyToMessageId: null,
            deliveries: [
              {
                id: "agent-new-1",
                recipientAgentId: "chief",
                status: "completed",
                position: null,
                error: null,
              },
            ],
          },
        },
        {
          id: "agent-new-2",
          author: "assistant",
          text: "Second unseen answer",
          createdAt: "2026-08-19T09:02:00.000Z",
          status: "completed",
        },
      ],
    });
    vi.mocked(window.openbot.agent.markConversationRead).mockResolvedValueOnce({
      unreadCount: 0,
      firstUnreadMessageId: null,
      throughMessageId: "agent-new-2",
    });

    render(() => <App />);
    expect(await screen.findByRole("status", { name: "2 new messages" })).toBeInTheDocument();
    await screen.findByText("Message from");
    expect(screen.getByRole("separator", { name: "New messages" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Jump to 2 new messages" }));

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "agent-new-2",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "2 new messages" })).not.toBeInTheDocument());
  });

  it("keeps a reply unread while the open agent chat is in the background and clears it on focus", async () => {
    const unreadPage = testConversationPage(
      "chief",
      [
        {
          id: "agent-background-answer",
          author: "assistant",
          text: "Ready while OpenBot was in the background",
          createdAt: "2026-08-19T09:03:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: {
          unreadCount: 1,
          firstUnreadMessageId: "agent-background-answer",
          throughMessageId: null,
        },
      },
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(emitDynamicIslandAction).toBeDefined());
    vi.mocked(window.openbot.agent.markConversationRead).mockClear();
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(unreadPage);

    window.dispatchEvent(new Event("blur"));
    emitAgentEvent?.({ type: "conversation-page", page: unreadPage });

    expect(await screen.findByText("Ready while OpenBot was in the background")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(vi.mocked(window.openbot.dynamicIsland.publishPresentation).mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "message",
        message: { messageId: "agent-background-answer" },
      }),
    );

    window.dispatchEvent(new Event("focus"));

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "agent-background-answer",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(vi.mocked(window.openbot.dynamicIsland.publishPresentation).mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "idle",
      }),
    );
  });

  it("keeps a queued snapshot unread when the app loses focus before rendering it", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    vi.mocked(window.openbot.agent.markConversationRead).mockClear();

    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 2,
        messages: [
          {
            id: "agent-focus-race",
            author: "assistant",
            text: "Rendered after focus was lost",
            createdAt: "2026-08-19T09:03:30.000Z",
            status: "completed",
          },
        ],
      },
    });
    window.dispatchEvent(new Event("blur"));

    expect(await screen.findByText("Rendered after focus was lost")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
  });

  it("extends an in-flight focus read to a newer visible agent reply", async () => {
    const oldPage = testConversationPage(
      "chief",
      [
        {
          id: "agent-focus-old",
          author: "assistant",
          text: "Older background reply",
          createdAt: "2026-08-19T09:03:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: "agent-focus-old", throughMessageId: null },
      },
    );
    const newPage = testConversationPage(
      "chief",
      [
        ...oldPage.messages,
        {
          id: "agent-focus-new",
          author: "assistant",
          text: "Newer reply during focus read",
          createdAt: "2026-08-19T09:04:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 3,
        readState: { unreadCount: 2, firstUnreadMessageId: "agent-focus-old", throughMessageId: null },
      },
    );
    let resolveFirstRead: ((state: NonNullable<ConversationPage["readState"]>) => void) | undefined;
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    window.dispatchEvent(new Event("blur"));
    emitAgentEvent?.({ type: "conversation-page", page: oldPage });
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(oldPage);
    vi.mocked(window.openbot.agent.markConversationRead)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockImplementation(async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughMessageId: input.throughMessageId,
      }));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        { agentId: "chief", throughMessageId: "agent-focus-old" },
        "local",
      ),
    );
    emitAgentEvent?.({ type: "conversation-page", page: newPage });
    expect(await screen.findByText("Newer reply during focus read")).toBeInTheDocument();
    resolveFirstRead?.({
      unreadCount: 1,
      firstUnreadMessageId: "agent-focus-new",
      throughMessageId: "agent-focus-old",
    });

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        { agentId: "chief", throughMessageId: "agent-focus-new" },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: /new messages?/ })).not.toBeInTheDocument());
  });

  it("keeps a newer agent reply unread when an earlier focus read resolves in the background", async () => {
    const oldPage = testConversationPage(
      "chief",
      [
        {
          id: "agent-stale-read-old",
          author: "assistant",
          text: "Reply visible before focus",
          createdAt: "2026-08-19T09:03:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: { unreadCount: 1, firstUnreadMessageId: "agent-stale-read-old", throughMessageId: null },
      },
    );
    const newPage = testConversationPage(
      "chief",
      [
        ...oldPage.messages,
        {
          id: "agent-stale-read-new",
          author: "assistant",
          text: "Reply received after focus was lost",
          createdAt: "2026-08-19T09:04:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 3,
        readState: { unreadCount: 2, firstUnreadMessageId: "agent-stale-read-old", throughMessageId: null },
      },
    );
    let resolveFirstRead: ((state: NonNullable<ConversationPage["readState"]>) => void) | undefined;
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    window.dispatchEvent(new Event("blur"));
    emitAgentEvent?.({ type: "conversation-page", page: oldPage });
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(oldPage);
    vi.mocked(window.openbot.agent.markConversationRead)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockImplementation(async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughMessageId: input.throughMessageId,
      }));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        { agentId: "chief", throughMessageId: "agent-stale-read-old" },
        "local",
      ),
    );
    window.dispatchEvent(new Event("blur"));
    emitAgentEvent?.({ type: "conversation-page", page: newPage });
    expect(await screen.findByText("Reply received after focus was lost")).toBeInTheDocument();
    resolveFirstRead?.({
      unreadCount: 0,
      firstUnreadMessageId: null,
      throughMessageId: "agent-stale-read-old",
    });

    await waitFor(() => expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument());
    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        { agentId: "chief", throughMessageId: "agent-stale-read-new" },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: /new messages?/ })).not.toBeInTheDocument());
  });

  it("keeps another agent new until that agent is opened after focus returns", async () => {
    const unreadPage = testConversationPage(
      "sales-outbound",
      [
        {
          id: "sales-background-answer",
          author: "assistant",
          text: "Sales result from the background",
          createdAt: "2026-08-19T09:04:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: {
          unreadCount: 1,
          firstUnreadMessageId: "sales-background-answer",
          throughMessageId: null,
        },
      },
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    vi.mocked(window.openbot.agent.markConversationRead).mockClear();

    window.dispatchEvent(new Event("blur"));
    emitAgentEvent?.({ type: "conversation-page", page: unreadPage });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sales Outbound/ })).toHaveTextContent("1 new reply"),
    );
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(vi.mocked(window.openbot.dynamicIsland.publishPresentation).mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "message",
        message: { agent: { id: "sales-outbound" }, messageId: "sales-background-answer" },
      }),
    );

    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(unreadPage);
    const sales = screen.getByRole("button", { name: /Sales Outbound/ });
    await fireEvent.click(sales);

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "sales-outbound",
          throughMessageId: "sales-background-answer",
        },
        "local",
      ),
    );
    await waitFor(() => expect(sales).not.toHaveTextContent("1 new reply"));
    await waitFor(() =>
      expect(vi.mocked(window.openbot.dynamicIsland.publishPresentation).mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "idle",
      }),
    );
  });

  it("shows a completed indicator only until the background app receives focus", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const chief = screen.getByRole("button", { name: /Chief/ });

    emitAgentEvent?.({
      type: "turn-completed",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-foreground",
      status: "completed",
    });
    expect(chief).not.toHaveTextContent("Responded");

    window.dispatchEvent(new Event("blur"));
    emitAgentEvent?.({
      type: "turn-completed",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-background",
      status: "completed",
    });
    expect(chief).toHaveTextContent("Responded");

    window.dispatchEvent(new Event("focus"));
    expect(chief).not.toHaveTextContent("Responded");
  });

  it("keeps a message read when it arrives in the open agent chat", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(window.openbot.agent.readConversation).toHaveBeenCalledWith("chief"));

    emitAgentEvent?.({
      type: "conversation-delta",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-live",
      messageId: "agent-visible-answer",
      delta: "Visible as it arrives",
      createdAt: "2026-08-19T09:03:00.000Z",
      revision: 1,
    });

    await waitFor(() =>
      expect(document.querySelector('[data-chat-search-message="agent-visible-answer"]')).toHaveTextContent(
        "Visible as it arrives",
      ),
    );
    expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "New messages" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "agent-visible-answer",
        },
        "local",
      ),
    );
  });

  it("keeps an agent reply unread while the Usage report covers the conversation", async () => {
    const unreadPage = testConversationPage(
      "chief",
      [
        {
          id: "agent-hidden-answer",
          author: "assistant",
          text: "Ready while the report was open",
          createdAt: "2026-08-19T09:04:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: {
          unreadCount: 1,
          firstUnreadMessageId: "agent-hidden-answer",
          throughMessageId: null,
        },
      },
    );

    render(() => (
      <AppProviders>
        <AppAccessGate />
        <UsageProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });
    vi.mocked(window.openbot.agent.markConversationRead).mockClear();
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(unreadPage);

    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    flush();
    emitAgentEvent?.({ type: "conversation-page", page: unreadPage });

    expect(await screen.findByText("Ready while the report was open")).toBeInTheDocument();
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();

    // Back uncovers the conversation, and the reply is still waiting there. The unread state
    // is queryable only now: while the report is open the content it covers is aria-hidden,
    // which is the same reason the reply must not count as seen.
    fireEvent.click(screen.getByRole("button", { name: "Close usage" }));
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
  });

  it("keeps an agent reply unread while an open channel covers the conversation", async () => {
    const unreadPage = testConversationPage(
      "chief",
      [
        {
          id: "agent-channel-answer",
          author: "assistant",
          text: "Ready while the channel was open",
          createdAt: "2026-08-19T09:06:00.000Z",
          status: "completed",
        },
      ],
      {
        revision: 2,
        readState: {
          unreadCount: 1,
          firstUnreadMessageId: "agent-channel-answer",
          throughMessageId: null,
        },
      },
    );

    render(() => (
      <AppProviders>
        <AppAccessGate />
        <ChannelProbe />
        <CloseChannelProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });
    vi.mocked(window.openbot.agent.markConversationRead).mockClear();
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(unreadPage);

    fireEvent.click(screen.getByRole("button", { name: "Open channel" }));
    await screen.findByRole("heading", { level: 1, name: "Project" });
    emitAgentEvent?.({ type: "conversation-page", page: unreadPage });

    // Leaving the channel uncovers the chat, and the reply is still waiting there. The boundary is
    // queryable only now, which is the same reason the reply could not count as seen before.
    fireEvent.click(screen.getByRole("button", { name: "Close channel" }));
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
  });

  it("keeps a private message unread while an open channel covers the conversation", async () => {
    function DirectUnreadProbe() {
      const direct = useDirectMessages();
      return (
        <output aria-label="Alice unread">
          {direct.directConversations()["member-alice"]?.readState?.unreadCount ?? 0}
        </output>
      );
    }
    render(() => (
      <AppProviders peopleEnabled>
        <AppAccessGate />
        <ChannelProbe />
        <DirectUnreadProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(window.openbot.servers.readDirectConversationPage).toHaveBeenCalled());
    vi.mocked(window.openbot.servers.markDirectRead).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Open channel" }));
    await screen.findByRole("heading", { level: 1, name: "Project" });
    emitDirectMessage?.({
      type: "team-direct-message",
      memberIds: ["member-alice", "member-self"],
      message: {
        id: "direct-under-channel",
        threadId: "thread-member-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "Private result while the channel was open",
        createdAt: "2026-08-19T10:01:00.000Z",
        sequence: 1,
      },
    });

    // The channel covers the private conversation, so the message is still waiting for the reader.
    await waitFor(() => expect(screen.getByLabelText("Alice unread")).toHaveTextContent("1"));
    expect(window.openbot.servers.markDirectRead).not.toHaveBeenCalled();
  });

  it("keeps a channel message unread while the Usage report covers the channel", async () => {
    render(() => (
      <AppProviders>
        <AppAccessGate />
        <ChannelProbe />
        <UsageProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });
    fireEvent.click(screen.getByRole("button", { name: "Open channel" }));
    await screen.findByRole("heading", { level: 1, name: "Project" });
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));

    const command = vi.spyOn(window.openbot.agent, "channelCommand");
    const read = vi.spyOn(window.openbot.agent, "readChannel");
    await window.openbot.agent.channelCommand({
      type: "send",
      operationId: "channel-usage-send",
      channelId: "channel-read",
      text: "The report is ready",
      recipientAgentId: "chief",
      replyToMessageId: null,
      attachmentDraftIds: [],
    });

    // The report covers the channel, so the message behind it is still waiting for the reader.
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(command).not.toHaveBeenCalledWith(expect.objectContaining({ type: "read" }));
  });

  it("uncovers the conversation a global search result opens", async () => {
    const result = {
      id: "sales-search-hit",
      author: "assistant" as const,
      source: "assistant" as const,
      text: "Found while the report was open",
      createdAt: "2026-08-19T09:05:00.000Z",
      status: "completed" as const,
    };
    vi.mocked(window.openbot.agent.searchConversationMessages).mockResolvedValue({
      results: [{ agentId: "sales-outbound", message: result }],
      total: 1,
      nextCursor: null,
    });
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
      agentId,
      threadId: null,
      activeTurnId: null,
      revision: 1,
      messages: agentId === "sales-outbound" ? [result] : [],
      readState:
        agentId === "sales-outbound"
          ? { unreadCount: 1, firstUnreadMessageId: result.id, throughMessageId: null }
          : { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    }));

    render(() => (
      <AppProviders>
        <AppAccessGate />
        <UsageProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });

    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    flush();

    // Command K reaches the document while the report is open, so the report has to give
    // way to the conversation the result names: opening it reads every message through
    // the match, and a read behind the report is a read of messages nobody saw.
    await fireEvent.keyDown(window, { key: "k", metaKey: true });
    await fireEvent.click(await screen.findByRole("tab", { name: "Messages" }));
    await fireEvent.input(screen.getByRole("combobox", { name: "Search OpenBot" }), { target: { value: "report" } });
    await fireEvent.click(await screen.findByRole("option", { name: /Found while the report was open/ }));

    expect(await screen.findByRole("heading", { name: "Sales Outbound" })).toBeInTheDocument();
  });

  it("uncovers the workspace when the sidebar opens a person or the create-agent form", async () => {
    render(() => (
      <AppProviders peopleEnabled>
        <AppAccessGate />
        <UsageProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    await screen.findByRole("button", { name: /Alice/ });

    // The sidebar is outside the markup the report covers, so both of these are one
    // click away while the report hides the place they open. Opening a private
    // conversation also reads it, and neither destination was seen behind the report.
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    flush();
    await fireEvent.click(screen.getByRole("button", { name: /Alice/ }));

    expect(await screen.findByRole("main", { name: "Direct conversation with Alice" })).toBeInTheDocument();

    const openCreateAgent = async () => {
      await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
      await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New agent" }), { button: 0 });
    };
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    flush();
    await openCreateAgent();

    expect(await screen.findByRole("main", { name: "Create a new agent" })).toBeInTheDocument();

    // The form is open now, so the second press only has the report to remove. It has
    // to: the press does nothing else the user can see.
    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    flush();
    await openCreateAgent();

    expect(await screen.findByRole("main", { name: "Create a new agent" })).toBeInTheDocument();
  });

  it("clears unread messages when entering an agent chat", async () => {
    const unreadState = {
      unreadCount: 1,
      firstUnreadMessageId: "sales-new",
      throughMessageId: null,
    };
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({
      "sales-outbound": unreadState,
    });
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) =>
      agentId === "sales-outbound"
        ? {
            agentId,
            threadId: "thread-sales",
            activeTurnId: null,
            revision: 1,
            readState: unreadState,
            messages: [
              {
                id: "sales-new",
                author: "assistant",
                text: "A new sales reply",
                createdAt: "2026-08-19T09:03:00.000Z",
                status: "completed",
              },
            ],
          }
        : {
            agentId,
            threadId: null,
            activeTurnId: null,
            revision: 0,
            readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
            messages: [],
          },
    );

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));

    expect(await screen.findByText("A new sales reply")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "sales-outbound",
          throughMessageId: "sales-new",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
    expect(screen.queryByRole("separator", { name: "New messages" })).not.toBeInTheDocument();
  });

  it("clears unread messages in the selected agent chat when queue loading fails", async () => {
    const unreadState = {
      unreadCount: 1,
      firstUnreadMessageId: "chief-new",
      throughMessageId: null,
    };
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({ chief: unreadState });
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValue({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      readState: unreadState,
      messages: [
        {
          id: "chief-new",
          author: "assistant",
          text: "A new reply from Chief",
          createdAt: "2026-08-19T09:03:00.000Z",
          status: "completed",
        },
      ],
    });
    vi.mocked(window.openbot.agent.listQueue).mockRejectedValue(new Error("Queue unavailable"));

    render(() => <App />);
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    await screen.findByText("A new reply from Chief");
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "chief-new",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
    expect(screen.queryByRole("separator", { name: "New messages" })).not.toBeInTheDocument();
  });

  it("preserves explicit read intent when an agent status change supersedes the page request", async () => {
    const unreadState = {
      unreadCount: 1,
      firstUnreadMessageId: "chief-status-reply",
      throughMessageId: null,
    };
    const unreadPage = testConversationPage(
      "chief",
      [
        {
          id: "chief-status-reply",
          author: "assistant",
          text: "Reply visible after status change",
          createdAt: "2026-08-19T09:05:00.000Z",
          status: "completed",
        },
      ],
      { readState: unreadState },
    );
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({ chief: unreadState });
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValue({
      agentId: "chief",
      threadId: unreadPage.threadId,
      activeTurnId: null,
      revision: unreadPage.revision,
      readState: unreadState,
      messages: unreadPage.messages,
    });
    render(() => <App />);
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();

    let resolveFirstPage: ((page: ConversationPage) => void) | undefined;
    let resolveSecondPage: ((page: ConversationPage) => void) | undefined;
    vi.mocked(window.openbot.agent.readConversationPage)
      .mockImplementationOnce(
        async (): Promise<ConversationPage> =>
          await new Promise((resolve) => {
            resolveFirstPage = resolve;
          }),
      )
      .mockImplementationOnce(
        async (): Promise<ConversationPage> =>
          await new Promise((resolve) => {
            resolveSecondPage = resolve;
          }),
      );
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() => expect(resolveFirstPage).toBeDefined());

    const currentStatus = await window.openbot.agent.getStatus();
    emitAgentEvent?.({ type: "status", status: { ...currentStatus, phase: "starting" } });
    await waitFor(() => expect(resolveSecondPage).toBeDefined());
    resolveFirstPage?.(unreadPage);
    resolveSecondPage?.(unreadPage);

    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "chief-status-reply",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("marks a newer reply that arrives while an opened agent chat is being marked read", async () => {
    const unreadState = {
      unreadCount: 1,
      firstUnreadMessageId: "chief-old-reply",
      throughMessageId: null,
    };
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({ chief: unreadState });
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValue({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      readState: unreadState,
      messages: [
        {
          id: "chief-old-reply",
          author: "assistant",
          text: "First visible reply",
          createdAt: "2026-08-19T09:03:00.000Z",
          status: "completed",
        },
      ],
    });
    let resolveInitialMark: ((state: NonNullable<ConversationPage["readState"]>) => void) | undefined;
    vi.mocked(window.openbot.agent.markConversationRead)
      .mockImplementationOnce(
        async (): Promise<NonNullable<ConversationPage["readState"]>> =>
          await new Promise((resolve) => {
            resolveInitialMark = resolve;
          }),
      )
      .mockImplementation(async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughMessageId: input.throughMessageId,
      }));

    render(() => <App />);
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "chief-old-reply",
        },
        "local",
      ),
    );

    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "chief",
        [
          {
            id: "chief-old-reply",
            author: "assistant",
            text: "First visible reply",
            createdAt: "2026-08-19T09:03:00.000Z",
            status: "completed",
          },
          {
            id: "chief-newer-reply",
            author: "assistant",
            text: "Newer visible reply",
            createdAt: "2026-08-19T09:04:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 2, firstUnreadMessageId: "chief-old-reply", throughMessageId: null },
        },
      ),
    });

    expect(await screen.findByText("Newer visible reply")).toBeInTheDocument();
    resolveInitialMark?.({
      unreadCount: 1,
      firstUnreadMessageId: "chief-newer-reply",
      throughMessageId: "chief-old-reply",
    });
    await waitFor(() =>
      expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
        {
          agentId: "chief",
          throughMessageId: "chief-newer-reply",
        },
        "local",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: /new messages?/ })).not.toBeInTheDocument());
  });

  it("keeps the agent unread state when marking it fails", async () => {
    const readState = {
      unreadCount: 1,
      firstUnreadMessageId: "agent-new",
      throughMessageId: null,
    };
    vi.mocked(window.openbot.agent.listConversationReads).mockResolvedValueOnce({
      chief: readState,
    });
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValue({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 2,
      readState,
      messages: [
        {
          id: "agent-old-user",
          author: "user",
          text: "Previous request",
          createdAt: "2026-08-19T09:00:00.000Z",
          status: "completed",
        },
        {
          id: "agent-new",
          author: "assistant",
          text: "Unseen answer",
          createdAt: "2026-08-19T09:01:00.000Z",
          status: "completed",
        },
      ],
    });
    vi.mocked(window.openbot.agent.markConversationRead).mockRejectedValueOnce(new Error("Read state unavailable"));

    render(() => <App />);
    const banner = await screen.findByRole("status", { name: "1 new message" });
    await screen.findByText("Unseen answer");
    await fireEvent.click(within(banner).getByRole("button", { name: "Jump to 1 new message" }));

    expect(await screen.findByText("Read state unavailable")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "New messages" })).toBeInTheDocument();
    expect(window.openbot.agent.markConversationRead).toHaveBeenCalledWith(
      {
        agentId: "chief",
        throughMessageId: "agent-new",
      },
      "local",
    );
  });

  it("keeps an open private message unread in the background and clears it on focus", async () => {
    render(() => <App peopleEnabled />);
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(window.openbot.servers.readDirectConversationPage).toHaveBeenCalled());
    vi.mocked(window.openbot.servers.markDirectRead).mockClear();

    window.dispatchEvent(new Event("blur"));
    emitDirectMessage?.({
      type: "team-direct-message",
      memberIds: ["member-alice", "member-self"],
      message: {
        id: "direct-background",
        threadId: "thread-member-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "Private result from the background",
        createdAt: "2026-08-19T10:01:00.000Z",
        sequence: 1,
      },
    });

    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(window.openbot.servers.markDirectRead).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() =>
      expect(window.openbot.servers.markDirectRead).toHaveBeenCalledWith({
        memberId: "member-alice",
        throughSequence: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });

  it("keeps a private message unread when focus returns to the Usage report", async () => {
    render(() => (
      <AppProviders peopleEnabled>
        <AppAccessGate />
        <UsageProbe />
      </AppProviders>
    ));
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(window.openbot.servers.readDirectConversationPage).toHaveBeenCalled());
    vi.mocked(window.openbot.servers.markDirectRead).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Open usage" }));
    flush();
    window.dispatchEvent(new Event("blur"));
    emitDirectMessage?.({
      type: "team-direct-message",
      memberIds: ["member-alice", "member-self"],
      message: {
        id: "direct-behind-usage",
        threadId: "thread-member-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "Private result behind the report",
        createdAt: "2026-08-19T10:01:00.000Z",
        sequence: 1,
      },
    });

    // Focus returns to the report, not to the conversation the report covers.
    window.dispatchEvent(new Event("focus"));
    flush();

    // Back uncovers the conversation, and the message is still waiting there. The unread
    // state is queryable only now: the covered content is aria-hidden, which is the same
    // reason the message must not count as seen. Reaching this badge is also the barrier
    // that lets the negative assertion below see a read the focus handler started.
    fireEvent.click(screen.getByRole("button", { name: "Close usage" }));
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(window.openbot.servers.markDirectRead).not.toHaveBeenCalled();
  });

  it("extends an in-flight focus read to a newer visible private message", async () => {
    let resolveFirstRead: ((state: NonNullable<DirectConversationSnapshot["readState"]>) => void) | undefined;
    vi.mocked(window.openbot.servers.readDirectConversation).mockResolvedValueOnce({
      threadId: "thread-member-alice",
      otherMemberId: "member-alice",
      revision: 1,
      readState: { unreadCount: 1, firstUnreadMessageId: "direct-focus-old", throughSequence: 0 },
      messages: [
        {
          id: "direct-focus-old",
          threadId: "thread-member-alice",
          senderMemberId: "member-alice",
          recipientMemberId: "member-self",
          text: "Older private background message",
          createdAt: "2026-08-19T10:00:00.000Z",
          sequence: 1,
        },
      ],
    });
    render(() => <App peopleEnabled />);
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    window.dispatchEvent(new Event("blur"));
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    vi.mocked(window.openbot.servers.markDirectRead)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockImplementation(async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughSequence: input.throughSequence,
      }));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(window.openbot.servers.markDirectRead).toHaveBeenCalledWith({
        memberId: "member-alice",
        throughSequence: 1,
      }),
    );
    emitDirectMessage?.({
      type: "team-direct-message",
      memberIds: ["member-alice", "member-self"],
      message: {
        id: "direct-focus-new",
        threadId: "thread-member-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "Newer private message during focus read",
        createdAt: "2026-08-19T10:01:00.000Z",
        sequence: 2,
      },
    });
    resolveFirstRead?.({
      unreadCount: 1,
      firstUnreadMessageId: "direct-focus-new",
      throughSequence: 1,
    });

    await waitFor(() =>
      expect(window.openbot.servers.markDirectRead).toHaveBeenCalledWith({
        memberId: "member-alice",
        throughSequence: 2,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: /new messages?/ })).not.toBeInTheDocument());
  });

  it("keeps a newer private message unread when an earlier focus read resolves in the background", async () => {
    let resolveFirstRead: ((state: NonNullable<DirectConversationSnapshot["readState"]>) => void) | undefined;
    vi.mocked(window.openbot.servers.readDirectConversation).mockResolvedValueOnce({
      threadId: "thread-member-alice",
      otherMemberId: "member-alice",
      revision: 1,
      readState: { unreadCount: 1, firstUnreadMessageId: "direct-stale-read-old", throughSequence: 0 },
      messages: [
        {
          id: "direct-stale-read-old",
          threadId: "thread-member-alice",
          senderMemberId: "member-alice",
          recipientMemberId: "member-self",
          text: "Private reply visible before focus",
          createdAt: "2026-08-19T10:00:00.000Z",
          sequence: 1,
        },
      ],
    });
    render(() => <App peopleEnabled />);
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    window.dispatchEvent(new Event("blur"));
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    vi.mocked(window.openbot.servers.markDirectRead)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRead = resolve;
          }),
      )
      .mockImplementation(async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughSequence: input.throughSequence,
      }));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(window.openbot.servers.markDirectRead).toHaveBeenCalledWith({
        memberId: "member-alice",
        throughSequence: 1,
      }),
    );
    window.dispatchEvent(new Event("blur"));
    emitDirectMessage?.({
      type: "team-direct-message",
      memberIds: ["member-alice", "member-self"],
      message: {
        id: "direct-stale-read-new",
        threadId: "thread-member-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "Private reply received after focus was lost",
        createdAt: "2026-08-19T10:01:00.000Z",
        sequence: 2,
      },
    });
    expect(await screen.findByText("Private reply received after focus was lost")).toBeInTheDocument();
    resolveFirstRead?.({ unreadCount: 0, firstUnreadMessageId: null, throughSequence: 1 });

    await waitFor(() => expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument());
    expect(window.openbot.servers.markDirectRead).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(window.openbot.servers.markDirectRead).toHaveBeenCalledWith({
        memberId: "member-alice",
        throughSequence: 2,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: /new messages?/ })).not.toBeInTheDocument());
  });

  it("shows and clears the unread boundary in a private conversation", async () => {
    vi.mocked(window.openbot.servers.readDirectConversation).mockResolvedValueOnce({
      threadId: "thread-member-alice",
      otherMemberId: "member-alice",
      revision: 1,
      readState: {
        unreadCount: 1,
        firstUnreadMessageId: "direct-new",
        throughSequence: 0,
      },
      messages: [
        {
          id: "direct-new",
          threadId: "thread-member-alice",
          senderMemberId: "member-alice",
          recipientMemberId: "member-self",
          text: "Private unseen message",
          createdAt: "2026-08-19T09:00:00.000Z",
          sequence: 1,
        },
      ],
    });
    render(() => <App peopleEnabled />);
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    window.dispatchEvent(new Event("blur"));
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));

    expect(await screen.findByRole("status", { name: "1 new message" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "New messages" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Jump to 1 new message" }));

    await waitFor(() =>
      expect(window.openbot.servers.markDirectRead).toHaveBeenCalledWith({
        memberId: "member-alice",
        throughSequence: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("status", { name: "1 new message" })).not.toBeInTheDocument());
  });
});
