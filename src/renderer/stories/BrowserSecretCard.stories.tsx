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
  args: {
    request: { ...request, secret: { method: "password", origin: "https://accounts.example.com", digits: 6 } },
    vault: { server: null },
  },
};
/** An owner or admin of a joined server: the box starts unchecked. */
export const PasswordJoinedServer: Story = {
  args: { ...Password.args, vault: { server: "Studio Mac mini" } },
};
export const PasswordMember: Story = {
  args: { ...Password.args, vault: { server: "Studio Mac mini", blocked: "role" } },
};
export const PasswordOlderHost: Story = {
  args: { ...Password.args, vault: { server: "Studio Mac mini", blocked: "version" } },
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
const renderNarrow: NonNullable<Story["render"]> = (args) => (
  <div style={{ width: "280px", "max-width": "100%" }}>
    <BrowserSecretCard {...args} />
  </div>
);

export const Narrow: Story = { render: renderNarrow };

export const TwelveDigitsNarrow: Story = {
  args: { request: { ...request, secret: { method: "otp", origin: "https://accounts.example.com", digits: 12 } } },
  render: renderNarrow,
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

export const Island: Story = {
  args: { variant: "island" },
};

export const IslandAuthenticator: Story = {
  args: { ...Authenticator.args, variant: "island" },
};

export const IslandPassword: Story = {
  args: { ...Password.args, variant: "island" },
};

export const IslandPasswordJoinedServer: Story = {
  args: { ...PasswordJoinedServer.args, variant: "island" },
};

export const IslandEightDigits: Story = {
  args: { ...EightDigits.args, variant: "island" },
};

export const IslandFailed: Story = {
  args: { ...Failed.args, variant: "island" },
};

export const IslandSubmittingCode: Story = {
  args: { ...SubmittingCode.args, variant: "island" },
};

export const IslandNarrow: Story = {
  args: { variant: "island" },
  render: renderNarrow,
};
