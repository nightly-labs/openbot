import type { AvatarColor } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { CHAT_COLOR_PRESETS } from "@openbot/ui/features/settings/ChatColorPicker";
import { For } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS, STORY_ATTACHMENTS } from "./fixtures";

const AGENT_BODY = [
  "I ran `bun run check` and read [the release guide](https://openbot.run/docs).",
  "",
  "> The tag waits for a green build.",
  "",
  "| Step | Owner |",
  "| --- | --- |",
  "| Tag `v0.47.0` | Build |",
  "| Notes | Chief |",
  "",
  "```bash",
  "bun run check",
  "```",
].join("\n");

const OWN_BODY = ["Run `bun run check` again, then tag it.", "", "```ts", "const tag = 'v0.47.0';", "```"].join("\n");

const COLORS: readonly (AvatarColor | undefined)[] = [undefined, "#e5a50a", "#4699fe", "#f75d59"];

function agentMessage(index: number): AgentMessage {
  return {
    id: `chat-color-agent-${index}`,
    author: "agent",
    body: AGENT_BODY,
    time: "10:02",
    kind: "text",
    attachments: STORY_ATTACHMENTS.slice(0, 1),
  };
}

function ownMessage(index: number): AgentMessage {
  return { id: `chat-color-own-${index}`, author: "you", body: OWN_BODY, time: "10:03", kind: "text" };
}

function memberMessage(index: number): AgentMessage {
  return { id: `chat-color-member-${index}`, author: "you", body: OWN_BODY, time: "10:04", kind: "text" };
}

const callbacks = { onSelectAgent: fn(), onOpenLink: fn(), onPreview: fn(), onAttachmentAction: fn() };

const meta = {
  title: "Conversation/ChatColors",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A chat color tints the bubble. Code, quotes, tables and file chips in a tinted bubble take the
 * same tint. The first rows have no color: the reader's and the agent's bubbles stay grey, and
 * another person's bubble takes their name colour.
 */
export const TintedContent: Story = {
  render: () => (
    <main class="foundation-story">
      <For each={COLORS}>
        {(color, index) => {
          const [agent] = STORY_AGENTS.slice(0, 1).map((profile) => ({ ...profile, chatColor: color }));
          return (
            <>
              <ChatMessageRow
                message={agentMessage(index())}
                author={{ kind: "agent", name: "Chief", agent }}
                agents={STORY_AGENTS}
                {...callbacks}
              />
              <ChatMessageRow
                message={ownMessage(index())}
                author={{ kind: "you", name: "You", chatColor: color }}
                agents={STORY_AGENTS}
                {...callbacks}
              />
              <ChatMessageRow
                message={memberMessage(index())}
                author={{ kind: "member", name: "Ada", chatColor: color }}
                agents={STORY_AGENTS}
                {...callbacks}
              />
            </>
          );
        }}
      </For>
    </main>
  ),
};

/** Each preset of the chat color picker, on the reader's own bubble. */
export const Presets: Story = {
  render: () => (
    <main class="foundation-story" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 24px">
      <For each={CHAT_COLOR_PRESETS}>
        {(preset) => (
          <ChatMessageRow
            message={{
              id: `preset-${preset.value}`,
              author: "you",
              body: `${preset.value} with \`code\``,
              time: "10:03",
              kind: "text",
            }}
            author={{ kind: "you", name: "You", chatColor: preset.value }}
            agents={STORY_AGENTS}
            {...callbacks}
          />
        )}
      </For>
    </main>
  ),
};
