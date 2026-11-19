import { type ChatBackdropBubbles, withChatBackdropBubbles } from "@openbot/contracts/chat-visual";
import type { AgentMessage } from "@openbot/ui/data";
import { BackdropBubbles } from "@openbot/ui/features/conversation/BackdropBubbles";
import { ChatBackdrop } from "@openbot/ui/features/conversation/ChatBackdrop";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { CustomBackdrop } from "@openbot/ui/features/conversation/CustomBackdrop";
import type { ChatBackdropChoice, ChatBackdropScene } from "@openbot/ui/features/conversation/chat-backdrop";
import { ChatBackdropSelect } from "@openbot/ui/features/settings/ChatBackdropSelect";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const callbacks = { onSelectAgent: fn(), onOpenLink: fn(), onPreview: fn(), onAttachmentAction: fn() };

const OWN_MESSAGE: AgentMessage = {
  id: "backdrop-own",
  author: "you",
  body: "Set a calm scene behind the window.",
  time: "10:02",
  kind: "text",
};
const AGENT_MESSAGE: AgentMessage = {
  id: "backdrop-agent",
  author: "agent",
  body: "Done. The scene plays behind the chat, and **Undo** in the notice puts back your backdrop.",
  time: "10:02",
  kind: "text",
};

function ChatRows() {
  const [agent] = STORY_AGENTS;
  return (
    <main style="max-width: 720px; margin: 0 auto; padding: 32px 24px">
      <ChatMessageRow
        message={OWN_MESSAGE}
        author={{ kind: "you", name: "You" }}
        agents={STORY_AGENTS}
        {...callbacks}
      />
      <ChatMessageRow
        message={AGENT_MESSAGE}
        author={{ kind: "agent", name: agent?.name ?? "Chief", agent }}
        agents={STORY_AGENTS}
        {...callbacks}
      />
    </main>
  );
}

function sceneStory(scene: ChatBackdropScene): Story {
  return {
    render: () => (
      <>
        <ChatBackdrop scene={scene} />
        <ChatRows />
      </>
    ),
  };
}

const meta = {
  title: "Conversation/ChatBackdrop",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pond = sceneStory("pond");
export const Jellyfish = sceneStory("jellyfish");
export const Sunset = sceneStory("sunset");
export const Snowfall = sceneStory("snowfall");
export const Fireflies = sceneStory("fireflies");

const AGENT_BUBBLES: ChatBackdropBubbles = { yours: "#7c3aed", agents: "#f59e0b" };
const AGENT_PAGE = withChatBackdropBubbles(
  '<!doctype html><html><body style="margin:0;height:100vh;background:linear-gradient(160deg,#1e1b4b,#4c1d95 60%,#9a3412)"></body></html>',
  AGENT_BUBBLES,
);

export const AgentSceneWithBubbles: Story = {
  render: () => (
    <>
      <CustomBackdrop source={{ kind: "page", html: AGENT_PAGE }} title="Dusk" />
      <BackdropBubbles colors={AGENT_BUBBLES}>
        <ChatRows />
      </BackdropBubbles>
    </>
  ),
};

export const Setting: Story = {
  parameters: { layout: "padded" },
  render: () => {
    const [value, setValue] = createSignal<ChatBackdropChoice | null>("custom:agent-chief");
    return (
      <main class="foundation-story">
        <ChatBackdropSelect
          value={value()}
          onChange={setValue}
          custom={[
            { id: "upload-1", name: "Mountain lake" },
            { id: "agent-chief", name: "Dusk" },
          ]}
          accept="image/png,image/jpeg,image/gif,image/webp"
          onUpload={fn()}
          onRemove={fn()}
        />
      </main>
    );
  },
};
