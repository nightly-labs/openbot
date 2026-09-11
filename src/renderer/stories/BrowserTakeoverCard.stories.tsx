import type { BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { onSettled } from "solid-js";
import { fn, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BrowserTakeoverCard } from "../src/features/conversation/ConversationPrompts";
import browserTakeoverPreviewUrl from "./assets/browser-takeover-preview.svg";
import { createMockOpenBot } from "./mock-openbot";

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

export const Cancelled: Story = {
  args: { decision: "cancel" },
};

export const TabUnavailable: Story = {
  args: { tab: undefined, preview: null, previewStatus: "failed" },
};

export const Submitting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "I’m done" }));
  },
};

export const ChatForm: Story = {
  args: {
    formRequest: { requestId: "preview", agentId: "chief", threadId: "thread-chief", tabId: "tab-login" },
    onOpenBrowser: fn(),
  },
  decorators: [
    (Story) => {
      const previous = window.openbot;
      window.openbot = createMockOpenBot().api;
      onSettled(() => () => {
        window.openbot = previous;
      });
      return <Story />;
    },
  ],
};
