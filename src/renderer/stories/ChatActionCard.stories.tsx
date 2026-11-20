import { CalendarClock } from "@openbot/ui";
import { ChatActionCard, type ChatActionCardProps } from "@openbot/ui/features/conversation/ChatActionCard";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

type CardArgs = Omit<ChatActionCardProps, "icon" | "children"> & { body?: string };

const meta = {
  title: "Conversation/Chat action card",
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <ChatActionCard {...args} icon={<CalendarClock />}>
        {args.body ? <p style={{ margin: 0 }}>{args.body}</p> : undefined}
      </ChatActionCard>
    </main>
  ),
  args: {
    eyebrow: "Created routine",
    title: "Morning brief",
    openLabel: "Open routine Morning brief",
    onOpen: fn(),
    body: "The variant body goes here, such as the schedule row of a routine.",
    status: { kind: "note", text: "Next run Fri, Sep 25 at 7:30 AM" },
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<CardArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Note: Story = {};

export const Busy: Story = { args: { status: { kind: "busy", text: "Saving…" } } };

export const Done: Story = {
  args: { status: { kind: "done", text: "Saved" } },
};

export const ErrorStatus: Story = {
  name: "Error",
  args: { status: { kind: "error", text: "Could not save the schedule. Try again." } },
};

export const Removed: Story = {
  args: { removed: true, status: { kind: "note", text: "This routine was deleted." } },
};

export const WithoutBody: Story = { args: { body: undefined } };
