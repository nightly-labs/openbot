import type { BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import browserTakeoverPreviewUrl from "./assets/browser-takeover-preview.svg";

const tab: BrowserTab = {
  id: "tab-login",
  title: "Sign in",
  url: "https://accounts.example.com/login",
  loading: false,
  ownerThreadId: "thread-chief",
  ownerAgentId: "chief",
};

const preview: BrowserPreview = {
  dataUrl: browserTakeoverPreviewUrl,
  width: 960,
  height: 600,
};

const meta = {
  title: "Conversation/BrowserTakeoverCard",
  component: BrowserTakeoverCard,
  args: {
    agentName: "Chief",
    tab,
    preview,
    previewStatus: "ready",
    onOpen: fn(),
    onComplete: fn(async () => true),
    onCancel: fn(async () => true),
  },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserTakeoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const Loading: Story = {
  args: { preview: null, previewStatus: "loading" },
};

export const PreviewUnavailable: Story = {
  args: { preview: null, previewStatus: "failed" },
};

export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: "280px", "max-width": "100%" }}>
      <BrowserTakeoverCard {...args} />
    </div>
  ),
};

export const Completed: Story = {
  args: { decision: "complete" },
};

/** A resolved card, and the channel view, have no browser panel to open: the preview is static. */
export const NotOpenable: Story = {
  args: { onOpen: undefined },
};

export const Cancelled: Story = {
  args: { decision: "cancel" },
};

export const TabUnavailable: Story = {
  args: { tab: undefined, preview: null, previewStatus: "failed" },
};
