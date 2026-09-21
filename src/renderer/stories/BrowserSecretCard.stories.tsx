import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BrowserSecretCard } from "../src/features/conversation/BrowserSecretCard";
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

export const PartiallyFilled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("6-digit code"), "123");
  },
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
