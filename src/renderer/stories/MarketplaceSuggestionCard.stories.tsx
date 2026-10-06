import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import {
  MarketplaceSuggestionCard,
  type MarketplaceSuggestionCardProps,
  type MarketplaceSuggestionState,
} from "@openbot/ui/features/conversation/MarketplaceSuggestionCard";
import { createStore, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "./fixtures";

/*
 * Issue #1291: an agent suggests a Marketplace app or skill in the conversation. The person
 * connects it from the chat, opens its listing, or dismisses it. The connect step itself, with its
 * approval and sign-in dialogs, stays in the renderer.
 */

const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");

function tile(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">${svg}</svg>`,
  )}`;
}

const PASSWORDS_ICON = tile(
  '<rect width="80" height="80" rx="18" fill="#1a1a1a"/><circle cx="40" cy="40" r="22" fill="none" stroke="#fff" stroke-width="5"/><rect x="36" y="26" width="8" height="18" rx="2" fill="#fff"/><rect x="36" y="46" width="8" height="8" rx="2" fill="#fff"/>',
);
const LINEAR_ICON = tile(
  '<rect width="80" height="80" rx="18" fill="#2f2f46"/><text x="40" y="43" text-anchor="middle" dominant-baseline="middle" font-size="42">📐</text>',
);
const NOTES_ICON = tile(
  '<rect width="80" height="80" rx="18" fill="#3b2f1a"/><text x="40" y="43" text-anchor="middle" dominant-baseline="middle" font-size="42">📝</text>',
);

const meta = {
  title: "Conversation/Marketplace suggestion",
  component: MarketplaceSuggestionCard,
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <MarketplaceSuggestionCard {...args} />
    </main>
  ),
  args: {
    kind: "app",
    name: "1Password",
    description: "Share a dedicated 1Password vault with your agent through a service account.",
    iconUrl: PASSWORDS_ICON,
    state: "available",
    onConnect: fn(),
    onOpenDetails: fn(),
    onDismiss: fn(),
    onRestore: fn(),
  },
  argTypes: {
    kind: { control: "inline-radio", options: ["app", "skill"] },
    state: { control: "select", options: ["available", "busy", "connected", "attention", "unavailable"] },
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof MarketplaceSuggestionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The compact card, as in the issue reference. */
export const Available: Story = {};

/** The connect step runs. Sign-in and approval dialogs open from the renderer. */
export const Connecting: Story = { args: { state: "busy" } };

export const Connected: Story = { args: { state: "connected" } };

/** The app was connected before, and its sign-in has expired. */
export const NeedsAttention: Story = {
  args: {
    kind: "app",
    name: "Linear",
    description: "Issues, cycles and project status",
    iconUrl: LINEAR_ICON,
    state: "attention",
  },
};

/** A skill installs on the agent instead of connecting a service. */
export const Skill: Story = {
  args: {
    kind: "skill",
    name: "Release notes",
    description: "Turns a range of commits into a changelog a reader outside the team can follow.",
    iconUrl: NOTES_ICON,
  },
};

export const SkillInstalled: Story = { args: { ...Skill.args, state: "connected" } };

/** A member of a joined server can see the suggestion but cannot connect apps. */
export const Unavailable: Story = {
  args: {
    state: "unavailable",
    unavailableText: "Ask the server owner to connect it.",
    onConnect: undefined,
  },
};

/** A dismissed card stays as one line, so the person can undo. */
export const Dismissed: Story = { args: { dismissed: true } };

/** No icon, a long name and a long description, in a narrow chat. */
export const NarrowNoIcon: Story = {
  args: {
    name: "Company password manager for the finance team",
    description: "Share one dedicated vault of the finance team with your agent through a service account.",
    iconUrl: null,
  },
  render: (args) => (
    <main style={{ width: "320px", padding: "var(--openbot-space-4)" }}>
      <MarketplaceSuggestionCard {...args} />
    </main>
  ),
};

/** Holds the card state, so Connect, Dismiss and Undo can be tried. Connect takes a moment. */
function CardStage(props: MarketplaceSuggestionCardProps) {
  const [card, setCard] = createStore<{ state: MarketplaceSuggestionState; dismissed: boolean }>({
    state: untrack(() => props.state),
    dismissed: false,
  });
  return (
    <MarketplaceSuggestionCard
      {...props}
      state={card.state}
      dismissed={card.dismissed}
      onConnect={() => {
        props.onConnect?.();
        setCard((draft) => {
          draft.state = "busy";
        });
        setTimeout(
          () =>
            setCard((draft) => {
              draft.state = "connected";
            }),
          1200,
        );
      }}
      onDismiss={() => {
        props.onDismiss?.();
        setCard((draft) => {
          draft.dismissed = true;
        });
      }}
      onRestore={() => {
        props.onRestore?.();
        setCard((draft) => {
          draft.dismissed = false;
        });
      }}
    />
  );
}

export const Interactive: Story = {
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <CardStage {...args} />
    </main>
  ),
};

function message(id: string, author: AgentMessage["author"], body: string, time: string): AgentMessage {
  return { id, author, body, time };
}

const ask = message("m1", "you", "Connect 1Password so you can sign in to the billing portal.", "2:39 PM");
const reply = message(
  "m2",
  "agent",
  "The 1Password card is below. It is optional: you can also type the password in the sign-in form when I ask.",
  "2:39 PM",
);

/** The card under the agent's reply, at the width of a chat. */
export const InConversation: Story = {
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <main class="conversation-panel" aria-label="Conversation" style={{ height: "100dvh" }}>
      <section class="conversation-scroll" aria-label="Messages">
        <div class="virtual-chat-list virtual-chat-list-static">
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={ask}
              author={{ kind: "you", name: "You" }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={reply}
              author={{ kind: "agent", name: chief.name, agent: chief }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
          <div class="virtual-chat-row">
            <CardStage {...args} />
          </div>
        </div>
      </section>
    </main>
  ),
};
