import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { BrowserSecretCard } from "@openbot/ui/features/conversation/BrowserSecretCard";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import browserTakeoverPreviewUrl from "./assets/browser-takeover-preview.svg";

const request: BrowserTakeoverRequest = {
  requestId: "authentication",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-auth",
  tabId: "tab-auth",
  secret: { method: "otp", origin: "https://accounts.example.com", digits: 6 },
};
const meta = {
  title: "Conversation/BrowserSecretCard",
  component: BrowserSecretCard,
  args: {
    request,
    onRespond: async () => undefined,
    onOpen: () => undefined,
    loadPreview: async () => ({ dataUrl: browserTakeoverPreviewUrl, width: 960, height: 600 }),
  },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserSecretCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneTimeCode: Story = {};
export const Authenticator: Story = {
  args: {
    request: { ...request, secret: { method: "authenticator", origin: "https://accounts.example.com", digits: 6 } },
  },
};
export const Password: Story = {
  args: { request: { ...request, secret: { method: "password", origin: "https://accounts.example.com", digits: 6 } } },
};
export const EightDigits: Story = {
  args: { request: { ...request, secret: { method: "otp", origin: "https://accounts.example.com", digits: 8 } } },
};
export const Failed: Story = {
  args: {
    onRespond: async () => {
      throw new Error("Request unavailable.");
    },
  },
};
export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: "280px", "max-width": "100%" }}>
      <BrowserSecretCard {...args} />
    </div>
  ),
};

export const TwelveDigitsNarrow: Story = {
  args: { request: { ...request, secret: { method: "otp", origin: "https://accounts.example.com", digits: 12 } } },
  render: Narrow.render,
};

export const PreviewUnavailable: Story = {
  args: {
    loadPreview: async () => {
      throw new Error("Preview unavailable.");
    },
  },
};

export const SubmittingPassword: Story = {
  args: { ...Password.args, onRespond: () => new Promise<void>(() => {}) },
};

export const SubmittingCode: Story = {
  args: { onRespond: () => new Promise<void>(() => {}) },
};
