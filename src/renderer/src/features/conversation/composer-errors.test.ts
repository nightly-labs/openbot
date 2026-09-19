import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { appendPluginPrompt, appendSkillCreationRequest, appendSkillExample, EMPTY_DRAFT } from "./composer-draft";
import { composerDraftKey } from "./conversation-keys";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "./conversation-types";
import { createComposerStore } from "./stores/composer-store";

const chatA: ConversationTarget = { agentId: "agent-a", serverId: "local" };
const chatB: ConversationTarget = { agentId: "agent-b", serverId: "local" };
const keyA = composerDraftKey(chatA);
const keyB = composerDraftKey(chatB);

function testProps(agentId: string): ConversationProps {
  return {
    agentStatus: {
      phase: "ready",
      cliVersion: null,
      auth: { kind: "unknown" },
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
      message: null,
      fullAccess: true,
    },
    agent: {
      id: agentId,
      name: "Test agent",
      title: "",
      description: "",
      notifications: false,
      provider: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: null,
      avatarSeed: "seed",
      avatarHue: null,
      avatarUrl: null,
      time: "",
      preview: "",
    },
    agents: [],
    modelOptions: [],
    messages: [],
    unreadCount: 0,
    firstUnreadMessageId: null,
    loaded: true,
    activeTurnId: null,
    globalOverlayOpen: false,
    settingsRequest: null,
    messageFocusRequest: null,
    queue: undefined,
    browserTabs: [],
    activeBrowserTabId: null,
    browserVisibilitySuspended: false,
    browserControlState: { sessions: [] },
    server: undefined,
    presence: { serverId: null, members: [], updatedAt: "" },
    currentUserEmail: "",
    remoteDesktopSessionActive: false,
    remoteDesktopVisible: false,
    prompt: undefined,
    approval: undefined,
    browserTakeover: undefined,
    onSelectAgent: () => {},
    onUpdateAgent: async () => {},
    onSetAgentAvatar: async () => {},
    onSendMessage: async () => true,
    onMarkRead: async () => {},
    onTypingChange: () => {},
    onAnswerPrompt: async () => true,
    onRespondToApproval: async () => true,
    onRespondToBrowserTakeover: async () => true,
    onCancelQueuedMessage: () => {},
    onSteerQueuedMessage: () => {},
    onUpdateQueuedMessage: async () => true,
    onReorderQueue: () => {},
    onActivateBrowserTab: () => {},
    onCloseBrowserTab: () => {},
    onOpenRemoteDesktop: async () => {},
    onOpenAgentSetup: async () => {},
    onStop: () => {},
  };
}

function setup(
  agentId: string,
  initial?: { composer?: Record<string, string>; conversation?: Record<string, string> },
) {
  return createRoot((dispose) => {
    const [drafts, setDrafts] = createSignal<Record<string, ComposerDraft>>({});
    const [conversationErrors, setConversationErrors] = createSignal<Record<string, string>>(
      initial?.conversation ?? {},
    );
    const [composerErrors, setComposerErrors] = createSignal<Record<string, string>>(initial?.composer ?? {});
    const [editingAgentId] = createSignal<string | null>(null);
    const [editingServerId] = createSignal<string | null>(null);
    const [editingDeliveryId] = createSignal<string | null>(null);
    const [editingPendingSave] = createSignal<null>(null);
    const store = createComposerStore({
      props: testProps(agentId),
      drafts,
      setDrafts,
      conversationErrors,
      setConversationErrors,
      composerErrors,
      setComposerErrors,
      editingAgentId,
      editingServerId,
      editingDeliveryId,
      editingPendingSave,
      seenMessageIds: new Set<string>(),
    });
    return { store, composerErrors, conversationErrors, dispose };
  });
}

describe("chat-scoped composer errors", () => {
  it("keys errors per chat so one chat never leaks into another", () => {
    const viewA = setup(chatA.agentId, { composer: { [keyA]: "Chat A failed", [keyB]: "Chat B failed" } });
    const viewB = setup(chatB.agentId, { composer: { [keyA]: "Chat A failed", [keyB]: "Chat B failed" } });

    // Each scope's current error resolves to its own chat key only.
    expect(viewA.store.currentComposerError()).toBe("Chat A failed");
    expect(viewB.store.currentComposerError()).toBe("Chat B failed");
    expect(viewA.store.currentComposerError()).not.toBe(viewB.store.currentComposerError());

    viewA.dispose();
    viewB.dispose();
  });

  it("dismissal removes only the current chat and stays cleared", () => {
    const view = setup(chatA.agentId);
    view.store.setComposerErrorForTarget(chatA, "Transient failure");
    view.store.setConversationError(chatA, "Persistent failure");
    view.store.setComposerErrorForTarget(chatB, "Other chat failure");

    expect(view.composerErrors()[keyA]).toBe("Transient failure");
    view.store.clearChatErrors(chatA);

    expect(view.composerErrors()[keyA]).toBeUndefined();
    expect(view.conversationErrors()[keyA]).toBeUndefined();
    // Unrelated chat untouched.
    expect(view.composerErrors()[keyB]).toBe("Other chat failure");

    // Clearing twice is a no-op, never recreates the entry.
    view.store.clearChatErrors(chatA);
    expect(view.composerErrors()[keyA]).toBeUndefined();

    view.dispose();
  });

  it("repeated errors overwrite rather than stack, and clear removes", () => {
    const view = setup(chatA.agentId);
    view.store.setComposerErrorForTarget(chatA, "First failure");
    expect(view.composerErrors()[keyA]).toBe("First failure");

    view.store.setComposerErrorForTarget(chatA, "Second failure");
    expect(view.composerErrors()[keyA]).toBe("Second failure");
    expect(Object.keys(view.composerErrors())).toHaveLength(1);

    view.store.clearComposerError(chatA);
    expect(view.composerErrors()[keyA]).toBeUndefined();
    view.store.clearComposerError(chatA);
    expect(view.composerErrors()[keyA]).toBeUndefined();

    view.dispose();
  });

  it("dismissed errors do not reappear on reconnect unless a new error occurs", () => {
    const first = setup(chatA.agentId);
    first.store.setComposerErrorForTarget(chatA, "Stale failure");
    expect(first.composerErrors()[keyA]).toBe("Stale failure");
    first.store.clearChatErrors(chatA);
    expect(first.composerErrors()[keyA]).toBeUndefined();
    first.dispose();

    // Reconnect rebuilds the view from stable keyed state with the dismissed
    // entry gone: nothing reappears.
    const second = setup(chatA.agentId, { composer: {}, conversation: {} });
    expect(second.store.currentChatError()).toBeNull();

    second.store.setComposerErrorForTarget(chatA, "New failure after reconnect");
    expect(second.composerErrors()[keyA]).toBe("New failure after reconnect");
    second.dispose();
  });

  it("prefers the transient composer error but keeps the conversation error", () => {
    const view = setup(chatA.agentId, {
      composer: { [keyA]: "Composer failure" },
      conversation: { [keyA]: "Conversation failure" },
    });
    expect(view.store.currentChatError()).toBe("Composer failure");

    view.store.clearComposerError(chatA);
    // Clearing the transient layer reveals the keyed layer underneath.
    expect(view.conversationErrors()[keyA]).toBe("Conversation failure");

    view.dispose();
  });
});

const skill = { id: "skill-notes", name: "Release notes", examplePrompt: "Summarize the latest commits." };

describe("skill example drafts", () => {
  it("inserts an author example and a real skill reference", () => {
    expect(appendSkillExample(EMPTY_DRAFT, skill).text).toBe(
      `${serializeChatTagReference("skill", skill.name, skill.id)} ${skill.examplePrompt}`,
    );
    expect(EMPTY_DRAFT.text).toBe("");
  });
  it("preserves existing text, attachments, and replies", () => {
    const attachments = [
      {
        id: "file-1",
        name: "notes.txt",
        size: 10,
        kind: "file" as const,
        mimeType: "text/plain",
        previewKind: "text" as const,
        previewUrl: null,
      },
    ];
    const draft = { text: "Keep my draft", attachments, replyToMessageId: "message-1" };
    const result = appendSkillExample(draft, skill);
    expect(result).toEqual({
      ...draft,
      text: `Keep my draft\n${serializeChatTagReference("skill", skill.name, skill.id)} ${skill.examplePrompt}`,
    });
    expect(draft.text).toBe("Keep my draft");
  });
  it("uses a fallback for old skills", () => {
    expect(appendSkillExample(EMPTY_DRAFT, { id: skill.id, name: skill.name }).text).toContain(
      "Help me use this skill.",
    );
  });
});

describe("skill creation and plugin prompts", () => {
  it("adds a skill creation request without changing the existing draft state", () => {
    const draft = { ...EMPTY_DRAFT, text: "Keep this text", replyToMessageId: "reply-1" };
    const result = appendSkillCreationRequest(draft);
    expect(result.text).toMatch(/^Keep this text\nHelp me create a new local skill/);
    expect(result.attachments).toBe(draft.attachments);
    expect(result.replyToMessageId).toBe("reply-1");
    expect(draft.text).toBe("Keep this text");
    expect(appendSkillCreationRequest(EMPTY_DRAFT).text).toMatch(/^Help me create a new local skill/);
  });

  it("adds a plugin's example question as the user would have typed it", () => {
    const draft = { ...EMPTY_DRAFT, text: "Keep this text" };
    // No reference marker: a plugin's tools are offered to the agent already, so the example is the
    // question alone, on its own line under whatever the user was writing.
    expect(appendPluginPrompt(draft, "  Where can I earn the most on stablecoins?  ").text).toBe(
      "Keep this text\nWhere can I earn the most on stablecoins?",
    );
    expect(draft.text).toBe("Keep this text");
    expect(appendPluginPrompt(draft, "   ")).toBe(draft);
  });
});
