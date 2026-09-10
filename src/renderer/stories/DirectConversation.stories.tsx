import type { DirectMessage } from "@openbot/contracts/ipc";
import { createEffect, createSignal } from "solid-js";
import { expect, fireEvent, fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { DirectConversation } from "../src/features/conversation/DirectConversation";
import { STORY_DIRECT_SNAPSHOTS, STORY_PRESENCE } from "./fixtures";

const member = STORY_PRESENCE.members[1];
const unreadDirectMessages: DirectMessage[] = [
  ...Array.from({ length: 12 }, (_, index): DirectMessage => {
    const own = index % 2 === 0;
    return {
      id: `direct-history-${index + 1}`,
      threadId: "direct-alice",
      senderMemberId: own ? "member-self" : member.id,
      recipientMemberId: own ? member.id : "member-self",
      text: `Historical launch note ${index + 1}: the owner, deadline, and review status are recorded here.`,
      createdAt: `2026-08-19T09:${String(10 + index).padStart(2, "0")}:00.000Z`,
      sequence: index + 1,
    };
  }),
  ...Array.from(
    { length: 12 },
    (_, index): DirectMessage => ({
      id: `direct-unread-${index + 1}`,
      threadId: "direct-alice",
      senderMemberId: member.id,
      recipientMemberId: "member-self",
      text: `New private update ${index + 1}: I checked the launch notes and added the decisions, owners, and next steps we still need to review together.`,
      createdAt: `2026-08-19T09:${String(30 + index).padStart(2, "0")}:00.000Z`,
      sequence: index + 13,
    }),
  ),
];
const args: Parameters<typeof DirectConversation>[0] = {
  member,
  currentMemberId: "member-self",
  snapshot: STORY_DIRECT_SNAPSHOTS[member.id],
  loading: false,
  loadError: null,
  typing: false,
  onSend: async (text, clientMessageId) => ({
    message: {
      id: clientMessageId,
      threadId: "direct-alice",
      senderMemberId: "member-self",
      recipientMemberId: member.id,
      text,
      createdAt: "2026-08-19T10:00:00.000Z",
      sequence: 3,
    },
  }),
  onMarkRead: async () => undefined,
  onTypingChange: fn(),
};

function StatefulDirectConversation(props: { args: Parameters<typeof DirectConversation>[0] }) {
  const [snapshot, setSnapshot] = createSignal<Parameters<typeof DirectConversation>[0]["snapshot"]>();
  createEffect(
    () => props.args.snapshot,
    (nextSnapshot) => {
      setSnapshot(nextSnapshot);
    },
  );
  return (
    <div class="conversation-story-frame">
      <DirectConversation
        {...props.args}
        snapshot={snapshot()}
        onMarkRead={async () => {
          await props.args.onMarkRead();
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  readState: {
                    ...current.readState,
                    unreadCount: 0,
                    firstUnreadMessageId: null,
                    throughSequence: current.readState?.throughSequence ?? 0,
                  },
                }
              : current,
          );
        }}
      />
    </div>
  );
}

/*
 * The pill that counts what arrived below the reader. The snapshot lives in a signal, because the
 * count is a function of arrival: the play function has to append to a thread the reader is
 * already scrolled away from.
 */
const directPillBaseSnapshot = {
  ...STORY_DIRECT_SNAPSHOTS[member.id],
  revision: 2,
  messages: unreadDirectMessages,
  readState: { unreadCount: 0, firstUnreadMessageId: null, throughSequence: 24 },
};

function directPillArrival(index: number, own: boolean): DirectMessage {
  return {
    id: `direct-pill-arrival-${index}`,
    threadId: "direct-alice",
    senderMemberId: own ? "member-self" : member.id,
    recipientMemberId: own ? member.id : "member-self",
    text: `Arrived while the reader was scrolled up (${index}).`,
    createdAt: `2026-08-19T10:${String(index).padStart(2, "0")}:00.000Z`,
    sequence: unreadDirectMessages.length + index,
  };
}

const [directPillSnapshot, setDirectPillSnapshot] =
  createSignal<Parameters<typeof DirectConversation>[0]["snapshot"]>(directPillBaseSnapshot);

function appendDirectPillMessage(index: number, own: boolean): void {
  setDirectPillSnapshot((current) =>
    current
      ? {
          ...current,
          revision: (current.revision ?? 0) + 1,
          messages: [...current.messages, directPillArrival(index, own)],
        }
      : current,
  );
}

const meta = {
  title: "Team/DirectConversation",
  component: DirectConversation,
  args,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DirectConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("textbox", { name: "Message Alice Chen" });
    await userEvent.type(input, "I’ll review it now.");
    await userEvent.click(canvas.getByRole("button", { name: "Send direct message" }));
    await expect(input).toHaveValue("");
  },
};

export const UnreadMessages: Story = {
  render: (storyArgs) => <StatefulDirectConversation args={storyArgs} />,
  args: {
    snapshot: {
      ...STORY_DIRECT_SNAPSHOTS[member.id],
      revision: 2,
      messages: unreadDirectMessages,
      readState: {
        unreadCount: 12,
        firstUnreadMessageId: "direct-unread-1",
        throughSequence: 12,
      },
    },
  },
};

export const ScrollToLatest: Story = {
  render: (storyArgs) => <StatefulDirectConversation args={storyArgs} />,
  args: {
    snapshot: {
      ...STORY_DIRECT_SNAPSHOTS[member.id],
      revision: 2,
      messages: unreadDirectMessages,
      readState: {
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughSequence: 24,
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const scrollElement = canvasElement.querySelector<HTMLElement>(".direct-message-list");
    if (!scrollElement) throw new Error("Direct message scroll element is missing.");
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event("scroll"));
    await expect(canvas.findByRole("button", { name: "Scroll to latest message" })).resolves.toBeVisible();
  },
};

export const NewMessagesPill: Story = {
  name: "New messages pill",
  render: (storyArgs) => (
    <StatefulDirectConversation
      args={{
        ...storyArgs,
        get snapshot() {
          return directPillSnapshot();
        },
      }}
    />
  ),
  args: { snapshot: directPillBaseSnapshot },
  play: async ({ canvas, canvasElement }) => {
    setDirectPillSnapshot(directPillBaseSnapshot);
    const scrollElement = canvasElement.querySelector<HTMLElement>(".direct-message-list");
    if (!scrollElement) throw new Error("Direct message scroll element is missing.");
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event("scroll"));
    await expect(canvas.findByRole("button", { name: "Scroll to latest message" })).resolves.toBeVisible();

    appendDirectPillMessage(1, false);
    await expect(canvas.findByRole("button", { name: "Jump to 1 new message" })).resolves.toBeVisible();

    // The reader's own message is not news to them.
    appendDirectPillMessage(2, true);
    await expect(canvas.findByRole("button", { name: "Jump to 1 new message" })).resolves.toBeVisible();

    appendDirectPillMessage(3, false);
    await expect(canvas.findByRole("button", { name: "Jump to 2 new messages" })).resolves.toBeVisible();

    fireEvent.click(await canvas.findByRole("button", { name: "Dismiss new message count" }));
    await expect(canvas.findByRole("button", { name: "Scroll to latest message" })).resolves.toBeVisible();
    expect(scrollElement.scrollTop).toBe(0);

    // A dismissed count comes back with the next arrival, from zero.
    appendDirectPillMessage(4, false);
    await expect(canvas.findByRole("button", { name: "Jump to 1 new message" })).resolves.toBeVisible();
  },
};

export const Typing: Story = {
  args: { typing: true },
};

export const Loading: Story = {
  args: { snapshot: undefined, loading: true },
};

export const ErrorState: Story = {
  args: { snapshot: undefined, loadError: "The team server is temporarily unavailable." },
};

export const MessageDates: Story = {
  args: {
    snapshot: {
      ...STORY_DIRECT_SNAPSHOTS[member.id],
      messages: STORY_DIRECT_SNAPSHOTS[member.id].messages.map((message, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (index === 0 ? 1 : 0));
        return { ...message, createdAt: date.toISOString() };
      }),
    },
  },
};
