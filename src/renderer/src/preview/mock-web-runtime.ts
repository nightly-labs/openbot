import type { WebRuntimeFactory } from "../features/web-client/web-client-context";
import { createMockOpenBot } from "./mock-openbot";

/** Use the desktop preview's data and actions for the browser composition too. */
export const createMockWebRuntime: WebRuntimeFactory = (_accountId, events) => {
  const mock = createMockOpenBot();
  const agent = mock.api.agent;
  const host = {
    hostId: "preview-host",
    name: "Preview computer",
    logoKey: null,
    devicePublicKey: "preview-key",
    membershipId: "preview-member",
    role: "owner" as const,
  };
  const unsubscribe = agent.onEvent((event) => events.event(host.hostId, event));
  return {
    browser: mock.api.browser,
    browserTabs: () => mock.api.browser.listTabs(),
    getSidebarLayout: () => agent.getSidebarLayout(),
    mutateSidebarLayout: (action) => agent.mutateSidebarLayout(action),
    respondToTakeover: (input) => agent.respondToBrowserTakeover(input),
    listHosts: async () => [host],
    previewInvite: async () => {
      throw new Error("No invitation in this fixture.");
    },
    acceptInvite: async () => {
      throw new Error("Invitation acceptance needs a connected account.");
    },
    connect: async () => {
      events.connection({ hostId: host.hostId, state: "online", message: null });
      return ["conversation-pagination", "agent-create-model", "agent-duplication", "sidebar-layout"];
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
    send: async (agentId, text, attachmentDraftIds) => {
      await agent.sendMessage({ agentId, text, attachmentDraftIds });
    },
    stop: (agentId, turnId) => agent.interrupt({ agentId, turnId }),
    approve: (input) => agent.respondToApproval(input),
    answer: (input) => agent.respondToPrompt(input),
    upload: async () => {
      throw new Error("File uploads need a connected host.");
    },
    cancelUpload: async () => {},
    discard: (id) => agent.discardDraftAttachment(id),
    download: async () => ({ name: "preview.txt", mimeType: "text/plain", base64: btoa("OpenBot file preview") }),
    react: (input) => agent.setMessageReaction(input),
    setAvatar: async (agentId, image) => {
      await agent.setAvatar({ agentId, image });
    },
    models: () => agent.listModels(),
    status: () => agent.getStatus(),
    accountUsage: () => agent.getUsage(),
    createAgent: (input) => agent.createAgent(input),
    duplicateAgent: (agentId) => agent.duplicateAgent(agentId),
    updateAgent: async (input) => {
      await agent.updateAgent(input);
    },
    deleteAgent: (agentId) => agent.deleteAgent(agentId),
    search: (agentId, query, cursor) => agent.searchConversationMessages({ agentId, query, cursor, limit: 50 }),
    dispose: async () => {
      unsubscribe();
      mock.dispose();
    },
  };
};
