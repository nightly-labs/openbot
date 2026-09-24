import { CalendarClock } from "@openbot/ui";
import { ChatActionCard, type ChatActionCardProps } from "@openbot/ui/features/conversation/ChatActionCard";
import { expect, fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The shell of a chat record the person can act on. A variant gives the icon, the words and the
 * body, and maps its own states onto `status`. "Routines/Schedule card" is the first variant.
 */

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

export const Note: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open routine Morning brief" }));
    await expect(args.onOpen).toHaveBeenCalledOnce();
  },
};

export const Busy: Story = { args: { status: { kind: "busy", text: "Saving…" } } };

/** A change made from the card is done. */
export const Done: Story = {
  args: { status: { kind: "done", text: "Saved" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Saved");
  },
};

export const ErrorStatus: Story = {
  name: "Error",
  args: { status: { kind: "error", text: "Could not save the schedule. Try again." } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("Could not save the schedule. Try again.");
  },
};

/** The subject no longer exists: the title is struck through and Open is hidden. */
export const Removed: Story = {
  args: { removed: true, status: { kind: "note", text: "This routine was deleted." } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /Open routine/ })).not.toBeInTheDocument();
  },
};

/** A variant can be the header and the footer only. */
export const WithoutBody: Story = { args: { body: undefined } };
