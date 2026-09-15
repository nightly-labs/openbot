import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type ChannelPage,
  type ChannelSummary,
  type ChannelTask,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { createWorkspacePreferences } from "@openbot/team-client";
import { describe, expect, it, vi } from "vitest";
import { projectChannelMessages } from "../../chat/model/chat-messages";
import { reconcileChannelPins } from "../../workspace/model/agent-pins";
import { channelRecipient, toggleChannelMember } from "./channel-draft";
import { ChannelSend } from "./channel-send";
import { type ChannelRequest, MobileChannelStore, mergeLatestChannelPage } from "./channel-store";

import { channelTaskActivities } from "./channel-task-actions";

const channel: ChannelSummary = {
  id: "channel-one",
  name: "Travel",
  title: "Planning",
  instructions: "Compare options",
  members: [{ agentId: "agent-one" }, { agentId: "agent-two" }],
  leadAgentId: "agent-one",
  archived: false,
  revision: 1,
  createdAt: "2026-09-14T00:00:00Z",
  unreadCount: 1,
  activeTasks: 0,
  lastMessage: null,
};
function page(from: number, to: number): ChannelPage {
  return {
    channel,
    messages: Array.from({ length: to - from + 1 }, (_, index) => ({
      id: `message-${from + index}`,
      channelId: channel.id,
      sequence: from + index,
      author: { kind: "member", id: "user-one", name: "Member" },
      taskId: null,
      superseded: false,
      message: {
        id: `message-${from + index}`,
        author: "user",
        text: "Hello",
        status: "completed",
        createdAt: "2026-09-14T00:00:00Z",
      },
    })),
    tasks: [],
    olderCursor: from > 1 ? from : null,
    throughSequence: to,
  };
}
function fixture(
  response: (path: string, body: TeamProtocolV2Json | undefined, serverId: string) => Promise<unknown>,
  onList?: (serverId: string, channels: ChannelSummary[]) => void,
) {
  const calls = vi.fn(response);
  const request: ChannelRequest = async (_method, path, decode, body, serverId) =>
    decode(await calls(path, body, serverId));
  const store = new MobileChannelStore(request, onList);
  store.configure("host-one", [CHANNEL_CHATS_CAPABILITY, CHANNEL_DELETE_CAPABILITY]);
  return { store, calls };
}
function deferred<T>() {
  return Promise.withResolvers<T>();
}

describe("mobile channels", () => {
  it("preserves empty channel forms and expires superseded prompts", () => {
    const history = page(1, 1);
    const message = history.messages[0];
    message.message.text = "";
    message.message.questionPrompt = {
      requestId: "question-one",
      questions: [{ id: "choice", header: "Choice", question: "Which option?", isSecret: false, options: null }],
      resolution: null,
    };
    const projected = projectChannelMessages(history.messages, null);
    expect(projected).toEqual([
      {
        id: message.id,
        kind: "question",
        turnId: undefined,
        prompt: message.message.questionPrompt,
      },
    ]);
    expect(projectChannelMessages([{ ...message, superseded: true }], null)[0]).toMatchObject({
      kind: "question",
      prompt: { resolution: { status: "expired" } },
    });
    expect(projectChannelMessages(history.messages, null)[0]).toBe(projected[0]);
  });

  it("answers the channel form on its host without needing a single-chat snapshot", async () => {
    const history = page(1, 2);
    for (const [index, message] of history.messages.entries()) {
      message.author = { kind: "agent", id: "agent-two", name: "Research" };
      message.message.questionPrompt = {
        requestId: `question-${index}`,
        questions: [{ id: "secret", header: "Secret", question: "Enter value", isSecret: true, options: null }],
        resolution: null,
      };
    }
    let answered = false;
    const { store, calls } = fixture(async (path) => {
      if (path === TEAM_API_ROUTES.respond.prompt) {
        answered = true;
        return {};
      }
      if (answered) throw new Error("Connection lost after answer");
      return path === CHANNEL_ROUTES.list ? [channel] : history;
    });
    const release = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    await expect(
      store.respondToPrompt("host-one", channel.id, "agent-one", {
        requestId: "question-0",
        answers: {},
      }),
    ).rejects.toThrow("This form is no longer available.");
    await store.respondToPrompt("host-one", channel.id, "agent-two", {
      requestId: "question-0",
      answers: { secret: ["private-value"] },
    });
    expect(calls).toHaveBeenCalledWith(
      TEAM_API_ROUTES.respond.prompt,
      {
        requestId: "question-0",
        answers: { secret: ["private-value"] },
      },
      "host-one",
    );
    await store.refresh("host-one");
    const messages = store.get("host-one").pages.get(channel.id)?.messages;
    expect(messages?.[0].message.questionPrompt?.resolution).toEqual({
      status: "answered",
      responses: { secret: { status: "answered" } },
    });
    expect(messages?.[1].message.questionPrompt?.resolution).toBeNull();
    expect(JSON.stringify(messages)).not.toContain("private-value");
    await expect(
      store.respondToPrompt("host-one", channel.id, "agent-two", {
        requestId: "question-0",
        answers: {},
      }),
    ).rejects.toThrow("This form is no longer available.");
    release();
  });

  it("keeps a rejected prompt answer available for retry and supports cancellation", async () => {
    const history = page(1, 1);
    const message = history.messages[0];
    message.author = { kind: "agent", id: "agent-two", name: "Research" };
    message.message.questionPrompt = {
      requestId: "question-one",
      questions: [{ id: "choice", header: "Choice", question: "Which option?", isSecret: false, options: null }],
      resolution: null,
    };
    let attempts = 0;
    const { store } = fixture(async (path) => {
      if (path === TEAM_API_ROUTES.respond.prompt) {
        if (++attempts === 1) throw new Error("Offline");
        const prompt = message.message.questionPrompt;
        if (!prompt) throw new Error("Missing prompt fixture");
        message.message.questionPrompt = { ...prompt, resolution: { status: "cancelled" } };
        return {};
      }
      return path === CHANNEL_ROUTES.list ? [channel] : history;
    });
    const release = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const input = { requestId: "question-one", answers: {} };
    await expect(store.respondToPrompt("host-one", channel.id, "agent-two", input)).rejects.toThrow("Offline");
    expect(store.get("host-one").pages.get(channel.id)?.messages[0].message.questionPrompt?.resolution).toBeNull();
    await store.respondToPrompt("host-one", channel.id, "agent-two", input);
    expect(store.get("host-one").pages.get(channel.id)?.messages[0].message.questionPrompt?.resolution).toEqual({
      status: "cancelled",
    });
    release();
  });

  it("keeps a reconnect refresh queued when the previous connection fails", async () => {
    const oldConnection = deferred<unknown>();
    let reads = 0;
    const { store } = fixture(async () => (++reads === 1 ? oldConnection.promise : [channel]));
    const oldRead = store.refresh("host-one");
    void store.refresh("host-one");
    oldConnection.reject(new Error("Connection replaced"));
    await oldRead;
    expect(reads).toBe(2);
    expect(store.get("host-one").channels).toEqual([channel]);
    expect(store.get("host-one").error).toBeNull();
  });
  it("routes a leading member mention and keeps later mentions as references", () => {
    expect(channelRecipient("@[Travel](agent:agent-one) plan a trip", channel.members)).toBe("agent-one");
    expect(channelRecipient("Ask @[Travel](agent:agent-one)", channel.members)).toBeNull();
    expect(channelRecipient("@[Other](agent:agent-other) help", channel.members)).toBeNull();
  });
  it("does not replace a saved channel with a list response started before the save", async () => {
    const stale = deferred<unknown>();
    const newer = deferred<unknown>();
    let lists = 0;
    const saved = { ...channel, name: "Saved name", revision: 2 };
    const { store } = fixture(async (path) =>
      path === CHANNEL_ROUTES.list ? (++lists === 1 ? stale.promise : newer.promise) : saved,
    );
    const read = store.refresh("host-one");
    await store.command("host-one", {
      type: "save",
      channelId: channel.id,
      operationId: "save",
      draft: saved,
      update: true,
    });
    stale.resolve([channel]);
    await vi.waitFor(() => expect(lists).toBe(2));
    expect(store.get("host-one").channels[0]?.name).toBe("Saved name");
    newer.resolve([saved]);
    await read;
    expect(store.get("host-one").channels[0]?.name).toBe("Saved name");
  });
  it("keeps channel identity and settings in host commands, including update-only saves", async () => {
    const { store, calls } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? [channel] : channel));
    await store.command("host-one", {
      type: "save",
      operationId: "operation-one",
      channelId: channel.id,
      draft: channel,
      update: true,
    });
    expect(calls).toHaveBeenCalledWith(
      CHANNEL_ROUTES.command,
      expect.objectContaining({
        channelId: channel.id,
        update: true,
        draft: expect.objectContaining({ members: channel.members, leadAgentId: "agent-one" }),
      }),
      "host-one",
    );
    expect(store.get("host-one").channels[0]?.name).toBe("Travel");
  });
  it("coalesces an event burst and reads history only for an observed channel", async () => {
    const first = deferred<unknown>();
    let lists = 0;
    const { store, calls } = fixture(async (path) =>
      path === CHANNEL_ROUTES.list ? (++lists === 1 ? first.promise : [channel]) : page(1, 2),
    );
    const stop = store.observe("host-one", channel.id);
    const refresh = store.refresh("host-one");
    for (let index = 0; index < 40; index++) void store.refresh("host-one");
    expect(calls).toHaveBeenCalledTimes(2);
    first.resolve([channel]);
    await refresh;
    expect(lists).toBe(2);
    expect(store.get("host-one").pages.get(channel.id)?.messages).toHaveLength(2);
    stop();
    calls.mockClear();
    await store.refresh("host-one");
    expect(calls.mock.calls.map(([path]) => path)).toEqual([CHANNEL_ROUTES.list]);
    expect(store.get("host-one").pages.get(channel.id)?.messages).toHaveLength(2);
  });
  it("retains the latest history window while offline and trims older messages on exit", async () => {
    const { store, calls } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? [channel] : page(1, 50)));
    const close = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    close();
    store.setActive(false);
    calls.mockClear();
    const closeAgain = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    expect(store.get("host-one").pages.get(channel.id)?.messages).toHaveLength(50);
    expect(calls).not.toHaveBeenCalled();
    closeAgain();
    store.remove("host-one");
    expect(store.get("host-one").pages.size).toBe(0);
    const large = fixture(async (path) => (path === CHANNEL_ROUTES.list ? [channel] : page(1, 51)));
    const closeLarge = large.store.observe("host-one", channel.id);
    await large.store.refresh("host-one");
    closeLarge();
    expect(large.store.get("host-one").pages.get(channel.id)?.messages).toHaveLength(50);
    expect(large.store.get("host-one").pages.get(channel.id)?.olderCursor).toBe(2);
    large.store.setActive(false);
    const reopen = large.store.observe("host-one", channel.id);
    expect(large.store.get("host-one").pages.get(channel.id)?.messages.at(-1)?.sequence).toBe(51);
    reopen();
  });
  it("publishes history before the sidebar list completes and shares reads with a sheet", async () => {
    const list = deferred<unknown>();
    const { store, calls } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? list.promise : page(1, 2)));
    const closeChat = store.observe("host-one", channel.id);
    const closeSheet = store.observe("host-one", channel.id);
    await vi.waitFor(() => expect(store.get("host-one").pages.get(channel.id)?.messages).toHaveLength(2));
    expect(store.get("host-one").channels).toEqual([]);
    closeSheet();
    list.resolve([channel]);
    await vi.waitFor(() => expect(store.get("host-one").loading).toBe(false));
    expect(calls.mock.calls.map(([path]) => path)).toEqual([CHANNEL_ROUTES.list, CHANNEL_ROUTES.read]);
    closeChat();
  });
  it("does not restore a deleted channel from a late history response", async () => {
    const history = deferred<unknown>();
    const { store } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? [] : history.promise));
    const close = store.observe("host-one", channel.id);
    const done = store.refresh("host-one");
    history.resolve(page(1, 2));
    await done;
    expect(store.get("host-one").pages.size).toBe(0);
    close();
  });
  it("does not reload the open chat for an event in another channel", async () => {
    const { store, calls } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? [channel] : page(1, 2)));
    const close = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    calls.mockClear();
    await store.refresh("host-one", "another-channel");
    expect(calls.mock.calls.map(([path]) => path)).toEqual([CHANNEL_ROUTES.list]);
    close();
  });
  it("does not notify subscribers or replace history when a refresh has no changes", async () => {
    const { store } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? [channel] : page(1, 2)));
    const close = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const current = store.get("host-one");
    const listener = vi.fn();
    const unsubscribe = store.subscribe("host-one", listener);
    await store.refresh("host-one");
    expect(store.get("host-one")).toBe(current);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    close();
  });
  it("acknowledges read messages without an extra history refresh", async () => {
    const { store, calls } = fixture(async (path) =>
      path === CHANNEL_ROUTES.list ? [channel] : path === CHANNEL_ROUTES.command ? channel : page(1, 2),
    );
    const close = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const current = store.get("host-one").pages.get(channel.id);
    calls.mockClear();
    await store.command("host-one", { type: "read", operationId: "read", channelId: channel.id, throughSequence: 2 });
    expect(calls.mock.calls.map(([path]) => path)).toEqual([CHANNEL_ROUTES.command]);
    expect(store.get("host-one").channels[0]?.unreadCount).toBe(0);
    expect(store.get("host-one").pages.get(channel.id)).toBe(current);
    close();
  });
  it("does not clear a newer unread message when an earlier read receipt completes", async () => {
    const receipt = deferred<unknown>();
    let latest = page(1, 2);
    const { store } = fixture(async (path) =>
      path === CHANNEL_ROUTES.list ? [channel] : path === CHANNEL_ROUTES.command ? receipt.promise : latest,
    );
    const close = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const read = store.command("host-one", {
      type: "read",
      operationId: "read",
      channelId: channel.id,
      throughSequence: 2,
    });
    latest = page(1, 3);
    await store.refresh("host-one");
    receipt.resolve(channel);
    await read;
    expect(store.get("host-one").channels[0]?.unreadCount).toBe(1);
    close();
  });
  it("keeps unchanged bubbles during streaming and projects authors for the current member", () => {
    const current = page(1, 2);
    const update = page(1, 2);
    update.messages[1].message.text = "Updated";
    const merged = mergeLatestChannelPage(current, update);
    expect(merged.messages[0]).toBe(current.messages[0]);
    const before = projectChannelMessages(current.messages, "user-one");
    const after = projectChannelMessages(merged.messages, "user-one");
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toMatchObject({ kind: "message", body: "Updated", author: "user" });
    expect(projectChannelMessages(merged.messages, "other-user")[0]).toMatchObject({ author: "agent" });
  });
  it("does not request channels from unsupported hosts or while in the background", async () => {
    const { store, calls } = fixture(async () => []);
    await store.refresh("old-host");
    store.setActive(false);
    await store.refresh("host-one");
    expect(calls).not.toHaveBeenCalled();
    store.setActive(true);
    await store.refresh("host-one");
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it("keeps hosts separate and discards a response after a host is removed", async () => {
    const late = deferred<unknown>();
    const { store } = fixture(async () => late.promise);
    const refresh = store.refresh("host-one");
    store.remove("host-one");
    late.resolve([channel]);
    await refresh;
    expect(store.get("host-one").channels).toEqual([]);
    expect(store.get("host-two").channels).toEqual([]);
  });
  it("retains loaded history through a live refresh and replaces it when there is a gap", () => {
    expect(mergeLatestChannelPage(page(1, 3), page(3, 5)).messages.map((message) => message.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(mergeLatestChannelPage(page(1, 3), page(6, 8)).messages.map((message) => message.sequence)).toEqual([
      6, 7, 8,
    ]);
  });
  it("loads older messages without losing the newest message or duplicating an overlap", async () => {
    const { store } = fixture(async (path, body) =>
      path === CHANNEL_ROUTES.list
        ? [channel]
        : body && typeof body === "object" && "beforeSequence" in body
          ? page(1, 3)
          : page(3, 5),
    );
    const stop = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    await store.older("host-one", channel.id);
    expect(
      store
        .get("host-one")
        .pages.get(channel.id)
        ?.messages.map((message) => message.sequence),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(store.get("host-one").pages.get(channel.id)?.olderCursor).toBeNull();
    stop();
  });
  it("keeps the last list on a failure and clears the error after retry", async () => {
    let fail = false;
    const { store } = fixture(async () => {
      if (fail) throw new Error("offline");
      return [channel];
    });
    await store.refresh("host-one");
    fail = true;
    await store.refresh("host-one");
    expect(store.get("host-one").channels).toEqual([channel]);
    expect(store.get("host-one").error).not.toBeNull();
    fail = false;
    await store.refresh("host-one");
    expect(store.get("host-one").error).toBeNull();
  });
  it("releases a deleted pin when a stale event read races with local deletion", async () => {
    const values = new Map<string, string>();
    const preferences = createWorkspacePreferences("https://api.example.test", "user", {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => {
        values.set(key, value);
      },
    });
    preferences.write("host-one", { hidden: [], pinned: ["agent-one"], pinnedChannels: [channel.id] });
    const stale = deferred<unknown>();
    let reads = 0;
    const { store } = fixture(
      async (path) => {
        if (path !== CHANNEL_ROUTES.list) return undefined;
        reads += 1;
        return reads === 1 ? [channel] : reads === 2 ? stale.promise : [];
      },
      (serverId, channels) => {
        reconcileChannelPins(preferences, serverId, channels);
      },
    );
    await store.refresh("host-one");
    const eventRead = store.refresh("host-one");
    await store.delete("host-one", channel.id);
    expect(store.get("host-one").channels).toEqual([]);
    stale.resolve([channel]);
    await eventRead;
    expect(preferences.read("host-one")).toMatchObject({ pinned: ["agent-one"], pinnedChannels: [] });
    expect(store.get("host-one").channels).toEqual([]);
  });

  it("removes deleted channel history together with its list entry", async () => {
    let summaries = [channel];
    const { store } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? summaries : page(1, 2)));
    const close = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const cachedPages = store.get("host-one").pages;
    close();
    await store.refresh("host-one");
    expect(store.get("host-one").pages).toBe(cachedPages);
    const stop = store.subscribe("host-one", () => {
      const state = store.get("host-one");
      if (!state.channels.length) expect(state.pages.has(channel.id)).toBe(false);
    });
    summaries = [];
    await store.refresh("host-one");
    expect(store.get("host-one").pages.size).toBe(0);
    stop();
  });
  it("reflects desktop archive, restore, and deletion without changing agents", async () => {
    let summaries = [channel];
    const { store } = fixture(async () => summaries);
    await store.refresh("host-one");
    summaries = [{ ...channel, archived: true, revision: 2 }];
    await store.refresh("host-one");
    expect(store.get("host-one").channels[0]?.archived).toBe(true);
    summaries = [{ ...channel, archived: false, revision: 3 }];
    await store.refresh("host-one");
    expect(store.get("host-one").channels[0]?.archived).toBe(false);
    summaries = [];
    await store.refresh("host-one");
    expect(store.get("host-one").channels).toEqual([]);
    expect(channel.members).toHaveLength(2);
  });
  it("removes a selected lead and permits adding that agent again", () => {
    const removed = toggleChannelMember(channel, "agent-one");
    expect(removed.leadAgentId).toBe("agent-two");
    expect(removed.members).toEqual([{ agentId: "agent-two" }]);
    expect(toggleChannelMember(removed, "agent-one").members).toHaveLength(2);
    expect(toggleChannelMember(removed, "agent-one").leadAgentId).toBe("agent-two");
    const empty = toggleChannelMember(removed, "agent-two");
    expect(empty.leadAgentId).toBeNull();
    expect(toggleChannelMember(empty, "agent-one").leadAgentId).toBe("agent-one");
    expect(channel.leadAgentId).toBe("agent-one");
  });
});

describe("channel data in the shared chat", () => {
  it("waits for the send refresh without queuing a second read", async () => {
    const refreshed = deferred<unknown>();
    const { store, calls } = fixture(async (path) => (path === CHANNEL_ROUTES.list ? refreshed.promise : channel));
    const sender = new ChannelSend(store, "host-one", channel.id, () => "send-one");
    let complete = false;
    const send = sender.send("Hello", [], null, channel.members).then(() => {
      complete = true;
    });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledWith(CHANNEL_ROUTES.list, undefined, "host-one"));
    expect(complete).toBe(false);
    refreshed.resolve([channel]);
    await send;
    expect(calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.list)).toHaveLength(1);
    expect(store.get("host-one").channels).toEqual([channel]);
  });
  it("completes a send after its history read while the list and trailing refresh remain pending", async () => {
    const historyRead = deferred<ChannelPage>();
    const listRead = deferred<ChannelSummary[]>();
    const trailingRead = deferred<ChannelPage>();
    let sending = false;
    let reads = 0;
    const { store, calls } = fixture(async (path) => {
      if (path === CHANNEL_ROUTES.command) {
        sending = true;
        return channel;
      }
      if (path === CHANNEL_ROUTES.list) return sending ? listRead.promise : [channel];
      if (!sending) return page(1, 1);
      return ++reads === 1 ? historyRead.promise : trailingRead.promise;
    });
    const stop = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const sender = new ChannelSend(store, "host-one", channel.id, () => "send-one");
    const sent = sender.send("Hello", [], null, channel.members);
    await vi.waitFor(() => expect(reads).toBe(1));
    // A streaming event queues another pass before the send's read finishes.
    let refreshed = false;
    const refresh = store.refresh("host-one", channel.id).then(() => {
      refreshed = true;
    });
    historyRead.resolve(page(1, 2));
    expect(await sent).toBeNull();
    expect(store.get("host-one").pages.get(channel.id)?.throughSequence).toBe(2);
    expect(refreshed).toBe(false);
    listRead.resolve([channel]);
    await vi.waitFor(() => expect(reads).toBe(2));
    expect(refreshed).toBe(false);
    trailingRead.resolve(page(1, 3));
    await refresh;
    expect(store.get("host-one").pages.get(channel.id)?.throughSequence).toBe(3);
    expect(calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(1);
    stop();
  });

  it.each(["resume", "reassign"] as const)(
    "releases %s after its history read while streaming refreshes continue",
    async (type) => {
      const historyRead = deferred<ChannelPage>();
      const trailingRead = deferred<ChannelPage>();
      let commanded = false;
      let reads = 0;
      const { store } = fixture(async (path) => {
        if (path === CHANNEL_ROUTES.command) {
          commanded = true;
          return channel;
        }
        if (path === CHANNEL_ROUTES.list) return [channel];
        if (!commanded) return page(1, 1);
        return ++reads === 1 ? historyRead.promise : trailingRead.promise;
      });
      const stop = store.observe("host-one", channel.id);
      await store.refresh("host-one");
      const action = store.command(
        "host-one",
        {
          type,
          operationId: "task-action",
          channelId: channel.id,
          taskId: "task-one",
          recipientAgentId: "agent-two",
        },
        { waitForRefresh: true },
      );
      await vi.waitFor(() => expect(reads).toBe(1));
      let finished = false;
      const refresh = store.refresh("host-one").then(() => {
        finished = true;
      });
      historyRead.resolve(page(1, 2));
      await action;
      expect(store.get("host-one").pages.get(channel.id)?.throughSequence).toBe(2);
      await vi.waitFor(() => expect(reads).toBe(2));
      expect(finished).toBe(false);
      trailingRead.resolve(page(1, 3));
      await refresh;
      stop();
    },
  );

  it("completes an unchanged history read without waiting for the sidebar", async () => {
    const listRead = deferred<ChannelSummary[]>();
    let waiting = false;
    const { store } = fixture(async (path) =>
      path === CHANNEL_ROUTES.list ? (waiting ? listRead.promise : [channel]) : page(1, 1),
    );
    const stop = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const previous = store.get("host-one").pages.get(channel.id);
    waiting = true;
    await store.refreshHistory("host-one", channel.id);
    expect(store.get("host-one").pages.get(channel.id)).toBe(previous);
    listRead.resolve([channel]);
    await store.refresh("host-one");
    stop();
  });

  it("keeps other members, agents, and coordinator messages distinct from the reader", () => {
    const messages = page(1, 4).messages;
    messages[0].author = { kind: "member", id: "membership-current", name: "Me" };
    messages[1].author = { kind: "member", id: "membership-other", name: "Other member" };
    messages[2].author = { kind: "agent", id: "agent-one", name: "Travel" };
    messages[2].message.status = "streaming";
    messages[2].message.replyToMessageId = messages[0].id;
    messages[2].superseded = true;
    messages[3].author = { kind: "coordinator", id: "coordinator", name: "Coordinator" };
    const projected = projectChannelMessages(messages, "membership-current");
    expect(projected).toEqual(
      messages.map((entry, index) => ({
        id: entry.id,
        kind: "message",
        author: index === 0 ? "user" : "agent",
        speaker: entry.author,
        superseded: entry.superseded,
        body: entry.message.text,
        streaming: index === 2,
        replyToMessageId: entry.message.replyToMessageId,
        attachments: entry.message.attachments,
      })),
    );
    expect(
      projectChannelMessages(messages, null).every(
        (message) => message.kind === "message" && message.author === "agent",
      ),
    ).toBe(true);
  });

  it("retries an uncertain delivery with the same uploads and operation ID", async () => {
    const { store } = fixture(async () => [channel]);
    const upload = vi.spyOn(store, "upload").mockResolvedValue({
      id: "upload-one",
      name: "note.txt",
      mimeType: "text/plain",
      size: 1,
      kind: "file",
      previewKind: "none",
      previewUrl: null,
    });
    const discard = vi.spyOn(store, "discard").mockResolvedValue(undefined);
    const command = vi
      .spyOn(store, "command")
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValue(channel);
    const sender = new ChannelSend(store, "host-one", channel.id, () => "operation-one");
    const file = { id: "local-file", name: "note.txt", mimeType: "text/plain", size: 1, base64: "eA==" };
    await expect(sender.send("Hello", [file], "message-1", channel.members)).rejects.toThrow("Disconnected");
    sender.dispose();
    expect(discard).not.toHaveBeenCalled();
    await sender.send("Hello", [file], "message-1", channel.members);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[1]).toEqual(command.mock.calls[0]);
    expect(command.mock.calls[1]?.[1]).toMatchObject({
      type: "send",
      replyToMessageId: "message-1",
      attachmentDraftIds: ["upload-one"],
    });
    sender.dispose();
    expect(discard).not.toHaveBeenCalled();
  });

  it("re-uploads consumed attachment drafts when an uncertain send is edited", async () => {
    const { store } = fixture(async () => [channel]);
    let uploads = 0;
    const upload = vi.spyOn(store, "upload").mockImplementation(async () => ({
      id: `upload-${++uploads}`,
      name: "note.txt",
      mimeType: "text/plain",
      size: 1,
      kind: "file",
      previewKind: "none",
      previewUrl: null,
    }));
    const command = vi
      .spyOn(store, "command")
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValue(channel);
    let operation = 0;
    const sender = new ChannelSend(store, "host-one", channel.id, () => `op-${++operation}`);
    const file = { id: "file", name: "note.txt", mimeType: "text/plain", size: 1, base64: "eA==" };
    await expect(sender.send("First", [file], null, channel.members)).rejects.toThrow("Disconnected");
    await sender.send("Edited", [file], null, channel.members);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(command.mock.calls.map((call) => call[1])).toMatchObject([
      { operationId: "op-1", attachmentDraftIds: ["upload-1"] },
      { operationId: "op-2", attachmentDraftIds: ["upload-2"] },
    ]);
  });

  it("returns a history-only retry after acceptance and keeps it pending through failed reads", async () => {
    let failRead = false;
    const { store, calls } = fixture(async (path) => {
      if (path === CHANNEL_ROUTES.list) return [channel];
      if (path === CHANNEL_ROUTES.command) return channel;
      if (failRead) throw new Error("Offline");
      return page(1, 2);
    });
    const stop = store.observe("host-one", channel.id);
    await store.refresh("host-one");
    const cached = store.get("host-one").pages.get(channel.id);
    failRead = true;
    const sender = new ChannelSend(store, "host-one", channel.id, () => "accepted");
    const receipt = await sender.send("Hello", [], null, channel.members);
    expect(receipt).not.toBeNull();
    if (!receipt) throw new Error("Expected a pending history receipt");
    expect(store.get("host-one").pages.get(channel.id)).toBe(cached);
    await expect(receipt.refreshHistory()).rejects.toThrow("chat history could not refresh");
    failRead = false;
    await receipt.refreshHistory();
    expect(calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(1);
    stop();
  });

  it("uses a new operation when the restored draft changes", async () => {
    const { store } = fixture(async () => [channel]);
    const command = vi
      .spyOn(store, "command")
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValue(channel);
    let sequence = 0;
    const sender = new ChannelSend(store, "host-one", channel.id, () => `operation-${++sequence}`);
    await expect(sender.send("Hello", [], null, channel.members)).rejects.toThrow("Disconnected");
    await sender.send("Changed", [], null, channel.members);
    expect(command.mock.calls.map((call) => call[1].operationId)).toEqual(["operation-1", "operation-2"]);
  });
});

it("uses assignment markers only for host routing receipts and preserves commentary", () => {
  const entries = page(1, 3).messages;
  const receipt = entries[0];
  receipt.author = { kind: "agent", id: "agent-one", name: "Travel" };
  receipt.taskId = "task-one";
  receipt.message = { ...receipt.message, author: "system", text: "Assigned to Builder." };
  const comment = entries[1];
  comment.author = receipt.author;
  comment.message = {
    ...comment.message,
    author: "assistant",
    itemType: "commentary",
    turnId: "turn-one",
    text: "Checking the routes",
  };
  entries[2].message.text = "Assigned to Builder.";
  expect(projectChannelMessages(entries, null)).toEqual([
    { id: receipt.id, kind: "assignment", agentName: "Builder" },
    { id: comment.id, kind: "thinking", turnId: "turn-one", steps: [{ id: comment.id, text: "Checking the routes" }] },
    expect.objectContaining({ kind: "message", body: "Assigned to Builder." }),
  ]);
});

it("shows each active channel task and clears activity when work pauses or finishes", () => {
  const task: ChannelTask = {
    id: "task-one",
    channelId: channel.id,
    parentTaskId: null,
    rootTaskId: "task-one",
    ownerAgentId: "agent-one",
    requestMessageId: "request",
    instruction: "Check routes",
    attachmentDraftIds: [],
    expectedResult: "",
    sourceMessageIds: [],
    dependencies: [],
    resources: [],
    state: "running",
    revision: 1,
    assignmentCount: 1,
    error: null,
  };
  const entries = page(1, 1).messages;
  entries[0].taskId = task.id;
  entries[0].author = { kind: "agent", id: "agent-one", name: "Travel" };
  entries[0].message = { ...entries[0].message, turnId: "channel-turn", itemType: "commentary" };
  const queued = { ...task, id: "task-two", ownerAgentId: "agent-two", state: "queued" as const };
  expect(channelTaskActivities([task, queued], entries, "chief")).toEqual([
    { agentId: "agent-one", turnId: "channel-turn", phase: "working", detail: "Working on it…" },
  ]);
  expect(
    channelTaskActivities(
      [
        { ...task, state: "paused" },
        { ...queued, state: "completed" },
      ],
      entries,
      "chief",
    ),
  ).toEqual([]);
  const routing = { ...queued, ownerAgentId: null };
  expect(channelTaskActivities([routing], [], "chief")).toEqual([
    { agentId: "chief", turnId: null, phase: "working", detail: "Working on it…" },
  ]);
  expect(channelTaskActivities([{ ...routing, state: "waiting" }], [], "chief")[0].agentId).toBe("chief");
  expect(channelTaskActivities([{ ...routing, state: "paused" }], [], "chief")).toEqual([]);
  expect(channelTaskActivities([routing], [], null)).toEqual([]);
  entries[0].message.status = "streaming";
  expect(channelTaskActivities([], entries, "chief")[0].agentId).toBe("agent-one");
  entries[0].superseded = true;
  expect(channelTaskActivities([task], entries, "chief")[0].turnId).toBeNull();
});
