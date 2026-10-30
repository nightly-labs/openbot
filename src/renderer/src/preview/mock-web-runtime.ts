import { CHANNEL_CHATS_CAPABILITY } from "@openbot/contracts/ipc";
import { ROUTINE_FLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-flows-v1";
import type { WebRuntimeFactory } from "../features/web-client/web-client-context";
import type { WebRuntimeEvents, WebWorkspaceRuntime } from "../features/web-client/web-runtime";
import { createMockOpenBot, type MockOpenBotControls } from "./mock-openbot";

/** Use the desktop preview's data and actions for the browser composition too. */
export const createMockWebRuntime: WebRuntimeFactory = (_accountId, events) =>
  mockWebRuntimeFor(createMockOpenBot(), events);

/** The browser composition over a given mock host, for a fixture that also drives that host. */
export function mockWebRuntimeFor(mock: MockOpenBotControls, events: WebRuntimeEvents): WebWorkspaceRuntime {
  const agent = mock.api.agent;
  const host = {
    hostId: "preview-host",
    name: "Preview computer",
    logoKey: null,
    devicePublicKey: "preview-key",
    membershipId: "preview-member",
    role: "owner" as const,
  };
  let removed = false;
  const unsubscribe = agent.onEvent((event) => events.event(host.hostId, event));
  return {
    browser: mock.api.browser,
    browserTabs: () => mock.api.browser.listTabs(),
    openBrowserTab: (input) => mock.api.browser.open(input),
    navigateBrowserTab: (input) => mock.api.browser.navigate(input),
    reloadBrowserTab: (tabId) => mock.api.browser.reload(tabId),
    stopBrowserTab: (tabId) => mock.api.browser.stop(tabId),
    closeBrowserTab: (tabId) => mock.api.browser.close(tabId),
    takeBrowserControl: (tabId) => mock.api.browser.takeControl(tabId),
    releaseBrowserControl: (tabId) => mock.api.browser.releaseControl(tabId),
    getSidebarLayout: () => agent.getSidebarLayout(),
    mutateSidebarLayout: (action) => agent.mutateSidebarLayout(action),
    channels: agent,
    // The member the mock channels write as.
    currentMemberId: async () => "preview",
    respondToTakeover: (input) => agent.respondToBrowserTakeover(input),
    listHosts: async () => (removed ? [] : [host]),
    removeOwnedHost: async () => {
      removed = true;
    },
    leaveHost: async () => {
      throw new Error("Leaving a host needs a connected account.");
    },
    previewInvite: async () => {
      throw new Error("No invitation in this fixture.");
    },
    acceptInvite: async () => {
      throw new Error("Invitation acceptance needs a connected account.");
    },
    connect: async () => {
      events.connection({ hostId: host.hostId, state: "online", message: null });
      return [
        "conversation-pagination",
        "agent-create-model",
        "agent-duplication",
        "sidebar-layout",
        CHANNEL_CHATS_CAPABILITY,
        ROUTINE_FLOWS_CAPABILITY,
      ];
    },
    disconnect: async () => {
      events.connection({ hostId: host.hostId, state: "offline", message: null });
    },
    listAgents: () => agent.listAgents(),
    conversation: (agentId, before) =>
      agent.readConversationPage({
        agentId,
        limit: 50,
        anchor: before ? { type: "before", cursor: before } : { type: "latest" },
      }),
    conversationAround: (agentId, messageId) =>
      agent.readConversationPage({ agentId, limit: 50, anchor: { type: "around", messageId } }),
    markRead: (agentId, throughMessageId) => agent.markConversationRead({ agentId, throughMessageId }),
    conversationReads: () => agent.listConversationReads(),
    // The preview host is not a hosted server.
    focusUse: async () => undefined,
    send: async (agentId, text, attachmentDraftIds, replyToMessageId, clientMessageId) => {
      const receipt = await agent.sendMessage({
        agentId,
        text,
        attachmentDraftIds,
        ...(replyToMessageId ? { replyToMessageId } : {}),
        ...(clientMessageId ? { clientMessageId } : {}),
      });
      return receipt.deliveries[0]?.id ?? receipt.messageId;
    },
    stop: (agentId, turnId) => agent.interrupt({ agentId, turnId }),
    setTyping: () => {},
    queue: (agentId) => agent.listQueue(agentId),
    editQueue: (input) => agent.editQueuedMessage(input),
    cancelQueued: (input) => agent.cancelQueuedMessage(input),
    steerQueued: (input) => agent.steerQueuedMessage(input),
    updateQueued: (input) => agent.updateQueuedMessage(input),
    reorderQueue: (input) => agent.reorderQueue(input),
    approve: (input) => agent.respondToApproval(input),
    answer: (input) => agent.respondToPrompt(input),
    upload: async () => {
      throw new Error("File uploads need a connected host.");
    },
    cancelUpload: async () => {},
    discard: (id) => agent.discardDraftAttachment(id),
    download: async () => ({ name: "preview.txt", mimeType: "text/plain", base64: btoa("OpenBot file preview") }),
    sharedFile: async () => ({ name: "preview.txt", mimeType: "text/plain", base64: btoa("OpenBot file preview") }),
    workspaceFile: async () => ({ name: "preview.txt", mimeType: "text/plain", base64: btoa("OpenBot file preview") }),
    workspaceDirectory: (agentId, path) => agent.listWorkspaceDirectory({ agentId, path }),
    routineFlows: mock.api.routineFlows,
    updateRoutine: (input) => agent.updateRoutine(input),
    testRoutine: (input) => agent.testRoutine(input),
    react: (input) => agent.setMessageReaction(input),
    setAvatar: async (agentId, image) => {
      await agent.setAvatar({ agentId, image });
    },
    agentAvatar: async (_agentId, avatarUrl) => avatarUrl,
    models: () => agent.listModels(),
    status: () => agent.getStatus(),
    accountUsage: () => agent.getUsage(),
    createAgent: (input) => agent.createAgent(input),
    duplicateAgent: (agentId) => agent.duplicateAgent(agentId),
    updateAgent: async (input) => {
      await agent.updateAgent(input);
    },
    deleteAgent: (agentId) => agent.deleteAgent(agentId),
    search: (agentId, query, cursor) =>
      agent.searchConversationMessages({
        query,
        ...(agentId === undefined ? {} : { agentId }),
        ...(cursor === undefined ? {} : { cursor }),
        limit: 50,
      }),
    dispose: async () => {
      unsubscribe();
      mock.dispose();
    },
  };
}
