import { JoinServerDialog } from "@openbot/ui/features/servers/JoinServerDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const preview = {
  serverId: "00000000-0000-4000-8000-000000000000",
  serverName: "Studio host",
  apiHostname: "story-host.openbot.run",
  role: "member" as const,
  expiresAt: "2026-08-21T10:00:00.000Z",
  emailBound: false,
  permanent: false,
};

const args: Parameters<typeof JoinServerDialog>[0] = {
  inviteUrl:
    "https://openbot.run/join?api=https%3A%2F%2Fstory-host.openbot.run%2F&server=00000000-0000-4000-8000-000000000000&fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&invite=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  accountEmail: "person@example.com",
  onClose: fn(),
  onPreview: fn(async () => preview),
  onJoin: fn(async () => undefined),
};

const meta = {
  title: "Team/JoinServerDialog",
  component: JoinServerDialog,
  args,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        joinServerNarrow: {
          name: "Join server — 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
} satisfies Meta<typeof JoinServerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const VerifiedInvite: Story = {};

export const EmailBoundInvite: Story = {
  args: {
    onPreview: fn(async () => ({ ...preview, emailBound: true })),
  },
};

export const EmptyInvite: Story = {
  args: { inviteUrl: "" },
};

export const ErrorState: Story = {
  args: {
    inviteUrl: "",
    onPreview: async () => {
      throw new Error("The OpenBot invitation link is invalid.");
    },
  },
};

export const Joining: Story = {
  args: {
    onJoin: () => new Promise<void>(() => undefined),
  },
};

export const JoinError: Story = {
  args: {
    onJoin: async () => {
      throw new Error("OpenBot could not connect to this host.");
    },
  },
};

export const LongIdentity: Story = {
  args: {
    accountEmail: "person.with.a.long.address@example-company-name.com",
    onPreview: fn(async () => ({
      ...preview,
      serverName: "Product design and research studio host",
      apiHostname: "product-design-research-studio.openbot.run",
    })),
  },
};

export const Narrow: Story = {
  args: { inviteUrl: "" },
  parameters: { viewport: { defaultViewport: "joinServerNarrow" } },
};

export const NarrowVerified: Story = {
  parameters: { viewport: { defaultViewport: "joinServerNarrow" } },
};
