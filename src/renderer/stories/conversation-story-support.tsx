/**
 * What a story needs to mount the real agent chat: the app providers it reads, a mocked bridge,
 * and a complete set of `Conversation` props. `Conversation.stories.tsx` builds its variants on
 * these, and the diagram workspace story shows the same chat when an agent is open.
 */

import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import type { AvatarImageInput, UpdateAgentInput } from "@openbot/contracts/ipc";
import type { AgentMessage as RendererAgentMessage } from "@openbot/ui/data";
import { onCleanup, type ParentProps } from "solid-js";
import { fn } from "storybook/test";
import { AuthProvider } from "../src/features/account/account-context";
import { type Conversation, createConversationController } from "../src/features/conversation/Conversation";
import { ConversationView } from "../src/features/conversation/ConversationView";
import { ConversationControllerProvider } from "../src/features/conversation/conversation-controller-context";
import { SetupProvider } from "../src/features/onboarding/onboarding-context";
import { ServersProvider } from "../src/features/servers/servers-context";
import { SettingsProvider } from "../src/features/settings/settings-context";
import { UsageProvider } from "../src/features/usage/usage-context";
import { PlatformProvider } from "../src/platform";
import {
  requireFixture,
  STORY_AGENT_STATUS,
  STORY_AGENTS,
  STORY_ATTACHMENTS,
  STORY_CONVERSATION_MESSAGES,
  STORY_MODELS,
  STORY_PRESENCE,
  STORY_REMOTE_DESKTOP_SESSION,
  STORY_SERVERS,
} from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

export const CONVERSATION_STORY_ATTACHMENT = requireFixture(STORY_ATTACHMENTS[0], "Story attachment");

export const CONVERSATION_STORY_MESSAGES: RendererAgentMessage[] = STORY_CONVERSATION_MESSAGES.map((message) => ({
  id: message.id,
  author: message.author === "user" ? "you" : "agent",
  body:
    message.id === "message-agent-1"
      ? `${message.text}\n\nPlease review ${serializeAttachmentReference(CONVERSATION_STORY_ATTACHMENT.name, CONVERSATION_STORY_ATTACHMENT.id)} before editing the implementation notes.\n\nTransformers scale well with data and compute [1], though attention is quadratic in sequence length [2].`
      : message.text,
  time: "10:00",
  ...(message.itemType === undefined ? {} : { itemType: message.itemType }),
  ...(message.senderAgentId === undefined ? {} : { senderAgentId: message.senderAgentId }),
  ...(message.replyToMessageId === undefined ? {} : { replyToMessageId: message.replyToMessageId }),
  ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
  ...(message.id === "message-agent-1"
    ? {
        citations: [
          {
            number: 1,
            label: "Attention Is All You Need",
            url: "https://arxiv.org/abs/1706.03762",
            host: "arxiv.org",
          },
          {
            number: 2,
            label: "Efficient Transformers: A Survey",
            url: "https://arxiv.org/abs/2009.06732",
            host: "arxiv.org",
          },
        ],
      }
    : {}),
  ...(message.exchange === undefined ? {} : { exchange: message.exchange }),
  ...(message.reaction === undefined ? {} : { reaction: message.reaction }),
  kind: message.exchange ? "exchange" : message.plan ? "plan" : "text",
  ...(message.plan ? { plan: { ...message.plan, stopped: false } } : {}),
}));

/**
 * The domains `ConversationView` and its panels read through `use*()`, nested in the order
 * `app-providers.tsx` uses. Each one talks to the mocked `window.openbot` the story installs.
 */
export function StoryAppProviders(props: ParentProps) {
  return (
    <PlatformProvider>
      <AuthProvider>
        <SetupProvider>
          <SettingsProvider>
            <ServersProvider>
              <UsageProvider>{props.children}</UsageProvider>
            </ServersProvider>
          </SettingsProvider>
        </SetupProvider>
      </AuthProvider>
    </PlatformProvider>
  );
}

export const CONVERSATION_STORY_ARGS: Parameters<typeof Conversation>[0] = {
  agentStatus: STORY_AGENT_STATUS,
  agent: STORY_AGENTS[0],
  agents: STORY_AGENTS,
  modelOptions: STORY_MODELS,
  messages: CONVERSATION_STORY_MESSAGES,
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
  server: STORY_SERVERS[0],
  presence: STORY_PRESENCE,
  currentUserEmail: "person@example.com",
  isOwnSender: (senderId) => senderId === "member-self",
  remoteDesktopSessionActive: Boolean(STORY_REMOTE_DESKTOP_SESSION),
  remoteDesktopVisible: false,
  prompt: undefined,
  approval: undefined,
  browserTakeover: undefined,
  onSelectAgent: fn(),
  onUpdateAgent: async (_agentId: string, _updates: Omit<UpdateAgentInput, "agentId">) => undefined,
  onSetAgentAvatar: async (_agentId: string, _image: AvatarImageInput | null) => undefined,
  onSendMessage: async (_body: string, _attachmentDraftIds: string[], _replyToMessageId: string | null) => ({
    messageId: `storybook-sent-${Date.now()}`,
  }),
  onMarkRead: async () => undefined,
  onTypingChange: fn(),
  onAnswerPrompt: async (_answers: Record<string, string[]>) => true,
  onRespondToApproval: async (_decision: "accept" | "decline") => true,
  onRespondToBrowserTakeover: async (_decision: "complete" | "cancel") => true,
  onCancelQueuedMessage: fn(),
  onSteerQueuedMessage: fn(),
  onUpdateQueuedMessage: async (
    _deliveryId: string,
    _text: string,
    _keepAttachmentIds: string[],
    _attachmentDraftIds: string[],
  ) => true,
  onReorderQueue: fn(),
  onActivateBrowserTab: fn(),
  onCloseBrowserTab: fn(),
  onOpenRemoteDesktop: async (_serverId: string, _trigger: HTMLElement) => undefined,
  onStop: fn(),
};

/** The agent chat as the app shows it, on a mocked bridge, for a story that composes screens. */
export function StoryAgentConversation(props: { agent: Parameters<typeof Conversation>[0]["agent"] }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  const controller = createConversationController({ onTypingChange: CONVERSATION_STORY_ARGS.onTypingChange });
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <div class="conversation-story-frame">
      <StoryAppProviders>
        <ConversationControllerProvider controller={controller}>
          <ConversationView {...CONVERSATION_STORY_ARGS} agent={props.agent} />
        </ConversationControllerProvider>
      </StoryAppProviders>
    </div>
  );
}
