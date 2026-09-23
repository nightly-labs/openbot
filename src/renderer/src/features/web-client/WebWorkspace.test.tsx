import type { AttachmentImportEvent, AttachmentSummary, ConversationPage } from "@openbot/contracts/ipc";
import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { STORY_AGENT_SUMMARIES } from "../../preview/fixtures";
import { createWebWorkspace } from "./web-client-context";
import { createWebConversationRuntime } from "./web-conversation-runtime";
import type { WebRuntimeEvents, WebWorkspaceRuntime } from "./web-runtime";

const page: ConversationPage = {
  agentId: "chief",
  threadId: "thread-chief",
  activeTurnId: null,
  revision: 1,
  messages: [],
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
};
function harness(overrides: Partial<WebWorkspaceRuntime> = {}) {
  let events: WebRuntimeEvents | undefined;
  const runtime: WebWorkspaceRuntime = {
    browser: {
      startLiveView: vi.fn(),
      stopLiveView: vi.fn(),
      sendLiveViewInput: vi.fn(),
      onLiveViewEvent: () => () => {},
    },
    browserTabs: vi.fn(),
    respondToTakeover: vi.fn(),
    react: vi.fn(),
    setAvatar: vi.fn(),
    models: vi.fn(),
    status: vi.fn(),
    createAgent: vi.fn(),
    duplicateAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    search: vi.fn(),
    listHosts: vi.fn().mockResolvedValue([
      {
        hostId: "host",
        name: "My computer",
        logoKey: null,
        devicePublicKey: "public-key",
        membershipId: "membership",
        role: "owner",
      },
    ]),
    previewInvite: async () => {
      throw new Error("No invitation in this fixture.");
    },
    acceptInvite: vi.fn(),
    connect: vi.fn().mockResolvedValue(["conversation-pagination"]),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listAgents: vi.fn().mockResolvedValue([STORY_AGENT_SUMMARIES[0]]),
    conversation: vi.fn().mockResolvedValue(page),
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
    upload: vi.fn(),
    cancelUpload: vi.fn(),
    discard: vi.fn(),
    download: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  let workspace: ReturnType<typeof createWebWorkspace> | undefined;
  let conversationRuntime: ReturnType<typeof createWebConversationRuntime> | undefined;
  const result = render(() => {
    workspace = createWebWorkspace({
      accountId: "account",
      accountFetch: fetch,
      onSessionCheck: async () => {},
      createRuntime: (_account, handlers) => {
        events = handlers;
        return runtime;
      },
    });
    conversationRuntime = createWebConversationRuntime(runtime, () => workspace?.state.host?.hostId ?? "");
    return null;
  });
  return {
    ...result,
    workspace: () => {
      if (!workspace) throw new Error("Not mounted.");
      return workspace;
    },
    runtime,
    conversationRuntime: () => {
      if (!conversationRuntime) throw new Error("Not mounted.");
      return conversationRuntime;
    },
    events: () => {
      if (!events) throw new Error("Not mounted.");
      return events;
    },
  };
}
async function connected(app: ReturnType<typeof harness>) {
  await waitFor(() => expect(app.workspace().conversation()?.page).toEqual(page));
  return app.workspace();
}
describe("web workspace state", () => {
  it("keeps agent order in the sidebar fallback when the host has no layout capability", async () => {
    const app = harness();
    const workspace = await connected(app);
    expect(workspace.state.sidebarLayout.agentOrder).toEqual(["chief"]);
  });

  it("loads and mutates the host sidebar layout", async () => {
    const layout = {
      revision: 3,
      sections: [{ id: "research", name: "Research" }],
      order: ["people", "research", "unassigned"],
      agentAssignments: { chief: "research" },
      agentOrder: ["chief"],
    };
    const next = { ...layout, revision: 4, order: ["people", "unassigned", "research"] };
    const app = harness({
      connect: vi.fn().mockResolvedValue(["conversation-pagination", "sidebar-layout"]),
      getSidebarLayout: vi.fn().mockResolvedValue(layout),
      mutateSidebarLayout: vi.fn().mockResolvedValue(next),
    });
    const workspace = await connected(app);
    expect(workspace.state.sidebarLayout).toEqual(layout);

    await workspace.mutateSidebarLayout({ type: "move", sectionId: "research", direction: "down" });
    expect(app.runtime.mutateSidebarLayout).toHaveBeenCalledWith({
      type: "move",
      sectionId: "research",
      direction: "down",
    });
    expect(workspace.state.sidebarLayout).toEqual(next);
  });

  it("keeps a newer sidebar event when an older mutation response arrives", async () => {
    const layout = {
      revision: 3,
      sections: [{ id: "research", name: "Research" }],
      order: ["people", "research", "unassigned"],
      agentAssignments: { chief: "research" },
      agentOrder: ["chief"],
    };
    const newer = { ...layout, revision: 4, order: ["people", "unassigned", "research"] };
    const response = Promise.withResolvers<typeof layout>();
    const app = harness({
      connect: vi.fn().mockResolvedValue(["conversation-pagination", "sidebar-layout"]),
      getSidebarLayout: vi.fn().mockResolvedValue(layout),
      mutateSidebarLayout: vi.fn(() => response.promise),
    });
    const workspace = await connected(app);
    const pending = workspace.mutateSidebarLayout({ type: "move", sectionId: "research", direction: "down" });
    await vi.waitFor(() => expect(app.runtime.mutateSidebarLayout).toHaveBeenCalledOnce());
    app.events().event("host", { type: "sidebar-layout-changed", layout: newer });
    response.resolve(layout);
    await pending;
    expect(workspace.state.sidebarLayout).toEqual(newer);
  });

  it("duplicates an agent once, applies the host result, and selects the copy", async () => {
    const copy = { ...STORY_AGENT_SUMMARIES[0], id: "chief-copy", name: "Chief copy", threadId: null };
    const layout = {
      revision: 2,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: ["chief", "chief-copy"],
    };
    const app = harness({
      connect: vi.fn().mockResolvedValue(["conversation-pagination", "agent-duplication"]),
      duplicateAgent: vi.fn().mockResolvedValue({ agent: copy, layout }),
      conversation: vi.fn().mockImplementation(async (agentId) => ({ ...page, agentId })),
    });
    const workspace = await connected(app);
    await workspace.duplicateAgent("chief");
    expect(app.runtime.duplicateAgent).toHaveBeenCalledWith("chief");
    expect(workspace.state.agents.map((agent) => agent.id)).toContain("chief-copy");
    expect(workspace.state.sidebarLayout).toEqual(layout);
    expect(workspace.state.selectedId).toBe("chief-copy");
    expect(workspace.state.duplicatingAgentIds).toEqual([]);
  });

  it("does not submit duplicate requests while one is pending", async () => {
    const copy = { ...STORY_AGENT_SUMMARIES[0], id: "chief-copy", name: "Chief copy", threadId: null };
    const layout = {
      revision: 2,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: ["chief", "chief-copy"],
    };
    const pending = Promise.withResolvers<{ agent: typeof copy; layout: typeof layout }>();
    const app = harness({
      connect: vi.fn().mockResolvedValue(["conversation-pagination", "agent-duplication"]),
      duplicateAgent: vi.fn(() => pending.promise),
    });
    const workspace = await connected(app);
    const first = workspace.duplicateAgent("chief");
    await vi.waitFor(() => expect(workspace.state.duplicatingAgentIds).toEqual(["chief"]));
    await workspace.duplicateAgent("chief");
    expect(app.runtime.duplicateAgent).toHaveBeenCalledOnce();
    pending.resolve({ agent: copy, layout });
    await first;
  });

  it("cleans deleted agent state from the authoritative roster", async () => {
    const remaining = { ...STORY_AGENT_SUMMARIES[1] };
    const app = harness({
      connect: vi.fn().mockResolvedValue(["conversation-pagination"]),
      listAgents: vi
        .fn()
        .mockResolvedValueOnce([STORY_AGENT_SUMMARIES[0], remaining])
        .mockResolvedValueOnce([remaining]),
      conversation: vi.fn().mockImplementation(async (agentId) => ({ ...page, agentId })),
      deleteAgent: vi.fn().mockResolvedValue(undefined),
    });
    const workspace = await connected(app);
    workspace.togglePinned("chief");
    workspace.toggleHidden("chief");
    await workspace.deleteAgent("chief");
    expect(app.runtime.deleteAgent).toHaveBeenCalledWith("chief");
    expect(workspace.state.agents.map((agent) => agent.id)).toEqual(["research"]);
    expect(workspace.state.selectedId).toBe("research");
    expect(workspace.state.pinnedIds).toEqual([]);
    expect(workspace.state.hiddenIds).toEqual([]);
    expect(workspace.state.conversations.chief).toBeUndefined();
  });

  it("cancels a batch without attaching late results or uploading the next file", async () => {
    let finish: (attachment: AttachmentSummary) => void = () => {};
    const app = harness({
      upload: vi.fn(
        () =>
          new Promise<AttachmentSummary>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    await connected(app);
    const adapter = app.conversationRuntime();
    const events: AttachmentImportEvent[] = [];
    adapter.agent.onAttachmentImport((event) => events.push(event));
    const pending = adapter.importFiles?.([new File(["a"], "one.txt"), new File(["b"], "two.txt")]);
    await waitFor(() => expect(app.runtime.upload).toHaveBeenCalledOnce());
    await adapter.cancelImportFiles?.();
    finish({
      id: "late-file",
      kind: "file",
      name: "one.txt",
      mimeType: "text/plain",
      size: 1,
      previewKind: "text",
      previewUrl: null,
    });
    await pending;
    expect(app.runtime.cancelUpload).toHaveBeenCalledOnce();
    expect(app.runtime.upload).toHaveBeenCalledOnce();
    expect(app.runtime.discard).toHaveBeenCalledWith("late-file");
    expect(events.at(-1)).toMatchObject({ type: "completed", attachments: [] });
  });
  it("loads older pages until a search result is available", async () => {
    const app = harness({
      conversation: vi.fn().mockResolvedValue({ ...page, pageInfo: { hasOlder: true, olderCursor: "older" } }),
    });
    const workspace = app.workspace();
    await waitFor(() => expect(workspace.conversation()?.page?.pageInfo.olderCursor).toBe("older"));
    vi.mocked(app.runtime.conversation).mockResolvedValueOnce({
      ...page,
      messages: [
        { id: "old-message", author: "user", text: "Find me", createdAt: "2026-09-21T00:00:00Z", status: "completed" },
      ],
    });
    await workspace.openSearchMessage("old-message");
    await waitFor(() =>
      expect(workspace.conversation()?.page?.messages.some((message) => message.id === "old-message")).toBe(true),
    );
    expect(app.runtime.conversation).toHaveBeenLastCalledWith("chief", "older");
  });
  it("tracks active questions and removes answered or expired requests", async () => {
    const app = harness();
    const workspace = await connected(app);
    const prompt = {
      type: "prompt" as const,
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn",
      requestId: "question",
      questions: [{ id: "scope", header: "Scope", question: "Which scope?", isSecret: false, options: null }],
    };
    app.events().event("host", prompt);
    await waitFor(() => expect(workspace.state.prompts).toEqual([prompt]));
    await workspace.answer({ requestId: "question", answers: { scope: ["Small"] } });
    expect(app.runtime.answer).toHaveBeenCalledWith({ requestId: "question", answers: { scope: ["Small"] } });
    await waitFor(() => expect(workspace.state.prompts).toEqual([]));
    app.events().event("host", prompt);
    await waitFor(() => expect(workspace.state.prompts).toHaveLength(1));
    app
      .events()
      .event("host", { type: "agent-input-resolved", kind: "prompt", agentId: "chief", requestId: "question" });
    await waitFor(() => expect(workspace.state.prompts).toEqual([]));
  });
  it("connects to the available host without an extra selection screen", async () => {
    const app = harness();
    const workspace = await connected(app);
    expect(workspace.state.host?.hostId).toBe("host");
    expect(app.runtime.connect).toHaveBeenCalledOnce();
    workspace.setDraft("Hello teammate");
    await waitFor(() => expect(workspace.conversation()?.draft).toBe("Hello teammate"));
    expect(await workspace.send()).toBe(true);
    expect(app.runtime.send).toHaveBeenCalledWith("chief", "Hello teammate", [], null);
    expect(workspace.conversation()?.draft).toBe("");
    app.unmount();
    expect(app.runtime.dispose).toHaveBeenCalledOnce();
  });
  it("removes questions expired in authoritative history without an input-resolved event", async () => {
    const app = harness();
    const workspace = await connected(app);
    const prompt = {
      type: "prompt" as const,
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn",
      requestId: "expired",
      questions: [],
    };
    app.events().event("host", prompt);
    await waitFor(() => expect(workspace.state.prompts).toHaveLength(1));
    vi.mocked(app.runtime.conversation).mockResolvedValue({
      ...page,
      revision: 2,
      messages: [
        {
          id: "question-message",
          author: "assistant",
          text: "Choose",
          createdAt: "2026-09-21T00:00:00Z",
          status: "completed",
          turnId: "turn",
          questionPrompt: { requestId: "expired", questions: [], resolution: { status: "expired" } },
        },
      ],
    });
    await workspace.refresh();
    await waitFor(() => expect(workspace.state.prompts).toEqual([]));
  });
  it("clears private state immediately when a session is revoked", async () => {
    const host = {
      hostId: "host",
      name: "My computer",
      logoKey: null,
      devicePublicKey: "public-key",
      membershipId: "membership",
      role: "owner" as const,
    };
    const directoryRefresh = Promise.withResolvers<(typeof host)[]>();
    const listHosts = vi.fn().mockResolvedValueOnce([host]).mockReturnValueOnce(directoryRefresh.promise);
    const app = harness({ listHosts });
    const workspace = await connected(app);
    workspace.setDraft("Private draft");
    app.events().connection({
      hostId: "host",
      state: "offline",
      message: "The remote session ended.",
      code: "session_revoked",
    });

    await waitFor(() => expect(workspace.state.agents).toEqual([]));
    expect(workspace.state.conversations).toEqual({});
    expect(workspace.state.selectedId).toBeNull();
    expect(workspace.state.host?.hostId).toBe("host");
    expect(workspace.state.revocationRevision).toBe(1);
    expect(listHosts).toHaveBeenCalledTimes(2);

    directoryRefresh.resolve([]);
    await waitFor(() => expect(workspace.state.host).toBeNull());
  });
  it("ignores a stale revocation refresh after switching hosts", async () => {
    const firstHost = {
      hostId: "host",
      name: "My computer",
      logoKey: null,
      devicePublicKey: "public-key",
      membershipId: "membership",
      role: "owner" as const,
    };
    const secondHost = { ...firstHost, hostId: "other-host", name: "Other computer", devicePublicKey: "other-key" };
    const directoryRefresh = Promise.withResolvers<(typeof firstHost)[]>();
    const listHosts = vi.fn().mockResolvedValueOnce([firstHost]).mockReturnValueOnce(directoryRefresh.promise);
    const app = harness({ listHosts });
    const workspace = await connected(app);
    app.events().connection({
      hostId: "host",
      state: "offline",
      message: "The remote session ended.",
      code: "session_revoked",
    });
    await waitFor(() => expect(listHosts).toHaveBeenCalledTimes(2));

    await workspace.connect(secondHost);
    directoryRefresh.resolve([]);
    await waitFor(() => expect(workspace.state.host?.hostId).toBe("other-host"));
    expect(workspace.state.hosts.map((host) => host.hostId)).toEqual(["host"]);
  });
  it("removes a confirmed approval and never repeats it after disconnect", async () => {
    const app = harness();
    const workspace = await connected(app);
    app.events().event("host", {
      type: "approval",
      approval: {
        requestId: "approval-one",
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-one",
        kind: "command",
        command: "pwd",
        cwd: null,
        reason: "Check",
        grantRoot: null,
        permissions: null,
      },
    });
    await workspace.approve({ requestId: "approval-one", decision: "accept" });
    expect(workspace.state.approvals).toEqual([]);
    app.events().connection({ hostId: "host", state: "offline", message: "Offline" });
    expect(app.runtime.approve).toHaveBeenCalledOnce();
  });
  it("clears only approvals for an interrupted turn", async () => {
    const app = harness();
    const workspace = await connected(app);
    const approval = (requestId: string, agentId: string, threadId: string, turnId: string) => ({
      type: "approval" as const,
      approval: {
        requestId,
        agentId,
        threadId,
        turnId,
        kind: "command" as const,
        command: "pwd",
        cwd: null,
        reason: "Check",
        grantRoot: null,
        permissions: null,
      },
    });
    const target = approval("approval-interrupted", "chief", "thread-chief", "turn-interrupted");
    const otherTurn = approval("approval-other-turn", "chief", "thread-chief", "turn-running");
    const otherAgent = approval("approval-other-agent", "scout", "thread-scout", "turn-interrupted");
    app.events().event("host", target);
    app.events().event("host", otherTurn);
    app.events().event("host", otherAgent);
    await waitFor(() =>
      expect(workspace.state.approvals).toEqual([target.approval, otherTurn.approval, otherAgent.approval]),
    );

    app.events().event("host", {
      type: "turn-completed",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-interrupted",
      status: "interrupted",
    });
    await waitFor(() => expect(workspace.state.approvals).toEqual([otherTurn.approval, otherAgent.approval]));
  });
  it("does not create a workspace when the account has no hosts", async () => {
    const app = harness({ listHosts: vi.fn().mockResolvedValue([]) });
    await waitFor(() => expect(app.workspace().state.hostsLoaded).toBe(true));
    expect(app.workspace().state.host).toBeNull();
    expect(app.workspace().state.hostsLoaded).toBe(true);
    expect(app.workspace().state.hostsLoading).toBe(false);
    expect(app.runtime.connect).not.toHaveBeenCalled();
  });
  it("reports a host directory failure and retries without losing the empty state", async () => {
    const listHosts = vi.fn().mockRejectedValueOnce(new Error("Directory unavailable")).mockResolvedValueOnce([]);
    const app = harness({ listHosts });
    await waitFor(() => expect(app.workspace().state.hostsError).toBe("Directory unavailable"));
    expect(app.workspace().state.hostsLoaded).toBe(false);
    expect(app.workspace().state.hostsLoading).toBe(false);

    await app.workspace().retryHosts();
    expect(app.workspace().state.hostsLoaded).toBe(true);
    expect(app.workspace().state.hostsError).toBeNull();
    expect(app.workspace().state.hosts).toEqual([]);
  });
  it("accepts an invitation once and retries the cached host after connection failure", async () => {
    const host = {
      hostId: "host",
      name: "My computer",
      logoKey: null,
      devicePublicKey: "public-key",
      membershipId: "membership",
      role: "owner" as const,
    };
    const listHosts = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([host]);
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host is offline."))
      .mockResolvedValue(["conversation-pagination"]);
    const acceptInvite = vi.fn().mockResolvedValue(host);
    const app = harness({ listHosts, connect, acceptInvite });
    await waitFor(() => expect(app.workspace().state.hostsLoaded).toBe(true));

    await expect(app.workspace().joinInvite(" https://openbot.run/join?token=one ")).rejects.toThrow(
      "The invitation was accepted, but the host is offline. Try again.",
    );
    await app.workspace().joinInvite("https://openbot.run/join?token=one");

    expect(acceptInvite).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(app.workspace().state.status).toBe("online");
  });
  it("connects an accepted invitation when another host is already active", async () => {
    const host = {
      hostId: "invited-host",
      name: "Invited computer",
      logoKey: null,
      devicePublicKey: "invited-key",
      membershipId: "invited-membership",
      role: "member" as const,
    };
    const app = harness({ acceptInvite: vi.fn().mockResolvedValue(host) });
    const workspace = await connected(app);

    await workspace.joinInvite("https://openbot.run/join?token=two");

    expect(app.runtime.acceptInvite).toHaveBeenCalledOnce();
    expect(app.runtime.connect).toHaveBeenCalledTimes(2);
    expect(workspace.state.host?.hostId).toBe("invited-host");
  });
  it("keeps unsent drafts through a connection loss and reconnect", async () => {
    const app = harness();
    const workspace = await connected(app);
    workspace.setDraft("Unsent text");
    app.events().connection({ hostId: "host", state: "offline", message: "Offline" });
    const host = workspace.state.host;
    if (!host) throw new Error("Missing host");
    await workspace.connect(host);
    expect(workspace.conversation()?.draft).toBe("Unsent text");
    expect(app.runtime.send).not.toHaveBeenCalled();
  });
  it("clears private data when membership is removed", async () => {
    const app = harness();
    const workspace = await connected(app);
    vi.mocked(app.runtime.listHosts).mockResolvedValue([]);
    await workspace.refreshHosts();
    expect(workspace.state.host).toBeNull();
    expect(workspace.state.conversations).toEqual({});
    expect(app.runtime.disconnect).toHaveBeenCalledOnce();
  });
  it("supports pin and hide reverse actions without deleting conversations", async () => {
    const app = harness();
    const workspace = await connected(app);
    workspace.togglePinned("chief");
    workspace.togglePinned("chief");
    workspace.toggleHidden("chief");
    workspace.toggleHidden("chief");
    expect(workspace.state.pinnedIds).toEqual([]);
    expect(workspace.state.hiddenIds).toEqual([]);
    expect(app.runtime.updateAgent).not.toHaveBeenCalled();
  });
  it("keeps remote browser tabs and responds to the selected takeover", async () => {
    const app = harness({
      connect: vi.fn().mockResolvedValue(["conversation-pagination", "browser-control", "browser-view"]),
      browserTabs: vi.fn().mockResolvedValue([
        {
          id: "tab-one",
          title: "Sign in",
          url: "https://example.com/sign-in",
          loading: false,
          ownerThreadId: "thread-chief",
          ownerAgentId: "chief",
        },
      ]),
    });
    const workspace = await connected(app);
    expect(workspace.state.browserTabs).toHaveLength(1);
    expect(workspace.state.activeBrowserTabId).toBe("tab-one");
    app.events().event("host", {
      type: "browser-changed",
      tabs: workspace.state.browserTabs,
      activeTabId: "tab-one",
    });
    const request = {
      type: "browser-takeover-requested" as const,
      request: {
        requestId: "takeover-one",
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-one",
        tabId: "tab-one",
      },
    };
    app.events().event("host", request);
    await waitFor(() => expect(workspace.state.takeovers).toHaveLength(1));
    expect(workspace.activateBrowserTab).toBeDefined();
    workspace.activateBrowserTab("tab-one");
    await expect(workspace.respondToBrowserTakeover("complete")).resolves.toBe(true);
    expect(app.runtime.respondToTakeover).toHaveBeenCalledWith({ requestId: "takeover-one", decision: "complete" });
    expect(workspace.state.takeovers).toEqual([]);
  });
  it("retains uncertain messages and never automatically resends", async () => {
    const app = harness();
    const workspace = await connected(app);
    vi.mocked(app.runtime.send).mockRejectedValue(new Error("Disconnected"));
    workspace.setDraft("Keep this draft");
    await waitFor(() => expect(workspace.conversation()?.draft).toBe("Keep this draft"));
    expect(await workspace.send()).toBe(false);
    expect(workspace.conversation()?.uncertain).toBe(true);
    expect(workspace.conversation()?.draft).toBe("Keep this draft");
    app.events().connection({ hostId: "host", state: "online", message: null, resync: true });
    await waitFor(() => expect(app.runtime.conversation).toHaveBeenCalledTimes(2));
    await workspace.send();
    expect(app.runtime.send).toHaveBeenCalledOnce();
  });
  it("keeps a sent draft confirmed when the history refresh fails", async () => {
    const app = harness();
    const workspace = await connected(app);
    workspace.setDraft("Keep this confirmed message");
    expect(workspace.state.status).toBe("online");
    await waitFor(() => expect(workspace.conversation()?.draft).toBe("Keep this confirmed message"));
    vi.mocked(app.runtime.conversation).mockRejectedValueOnce(new Error("History is unavailable."));

    await expect(workspace.send()).resolves.toBe(true);
    expect(workspace.conversation()?.draft).toBe("");
    expect(workspace.conversation()?.uncertain).toBe(false);
    expect(app.runtime.send).toHaveBeenCalledOnce();
  });
  it("ignores an old host history response after a host switch", async () => {
    let resolveOld: ((value: ConversationPage) => void) | undefined;
    const conversation = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ConversationPage>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue(page);
    const app = harness({ conversation });
    await waitFor(() => expect(conversation).toHaveBeenCalledOnce());
    const workspace = app.workspace();
    const host = workspace.state.host;
    if (!host) throw new Error("Missing host");
    await workspace.connect({ ...host, hostId: "other-host" });
    resolveOld?.({ ...page, revision: 999 });
    await waitFor(() => expect(workspace.conversation()?.page?.revision).toBe(1));
    app.events().event("host", { type: "error", code: "connection_error", message: "Old error" });
    expect(workspace.state.error).toBeNull();
  });
});
