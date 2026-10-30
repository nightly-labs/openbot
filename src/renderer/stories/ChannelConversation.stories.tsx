import type { AgentMessage } from "@openbot/ui/data";
import type { AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import { createSignal, onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  type ChannelStoryProps,
  channelStoryAgentMessage,
  channelStoryMemberMessage,
  CHANNEL_STORY_CHIEF as chief,
  CHANNEL_STORY_MESSAGES as messages,
  CHANNEL_STORY_RESEARCH as research,
  StoryChannelConversation,
  CHANNEL_STORY_SALES as sales,
} from "./channel-story-support";

/*
 * A channel in the conversation view, as the app shows it. What is under test here is what the
 * reader sees: the coloured author name and the face beside the bubble that opens a run, the run of
 * messages that names its author once, the reader's own messages on the right and other members' with
 * their name, one activity row for every agent at work, and the blocks above the
 * composer. Compare with `Conversation/Conversation`: the two chats draw the same rows.
 */

const meta = {
  title: "Conversation/Channel",
  component: StoryChannelConversation,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof StoryChannelConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SeveralAuthors: Story = {
  args: {
    activeTurnId: "story-run",
    workers: [
      { id: chief.id, name: chief.name, agent: chief },
      { id: research.id, name: research.name, agent: research },
    ],
  },
};

/** One agent at work: the sentence has to read for a single name too. */
export const OneWorker: Story = {
  args: {
    messages: messages.slice(0, 4),
    activeTurnId: "story-run",
    workers: [{ id: sales.id, name: sales.name, agent: sales }],
  },
};

/** Wrapped text, a long name, and an author whose profile is no longer available. */
export const AuthorLayout: Story = {
  args: {
    messages: [
      channelStoryAgentMessage(
        "wrapped",
        research.id,
        "I checked the project notes and the source material.\n\nThe next step is to confirm the owners and share the final plan with the team.",
        "13:06",
      ),
      channelStoryAgentMessage("former-member", "agent-removed", "My notes are ready for review.", "13:07"),
    ],
  },
};

/** The plan of a member's run, as in an agent chat. */
export const PlanCard: Story = {
  args: {
    activeTurnId: "turn-channel-plan",
    workers: [{ id: chief.id, name: chief.name, agent: chief }],
    messages: [
      ...messages.slice(0, 3),
      {
        id: "turn-channel-plan:plan",
        author: "agent",
        senderAgentId: chief.id,
        body: "",
        time: "13:10",
        turnId: "turn-channel-plan",
        itemType: "plan",
        status: "streaming",
        streaming: true,
        kind: "plan",
        plan: {
          explanation: null,
          stopped: false,
          steps: [
            { id: "0", text: "Read the sales sheet", status: "completed" },
            {
              id: "1",
              text: "Ask Research for the regional split",
              activeText: "Asking Research for the regional split",
              status: "inProgress",
            },
            { id: "2", text: "Write the launch post", status: "pending" },
          ],
        },
      },
    ],
  },
};

const waitingSubtasks: AwaitingReplyItem[] = [
  {
    id: "task-research",
    agent: research,
    name: research.name,
    state: "replied",
    preview: "Draft the pricing section for the launch post",
    detail: `${chief.name} reads it next`,
  },
  { id: "task-sales", agent: sales, name: sales.name, state: "working", preview: "Check the sources in the notes" },
];

const stoppedTask = (agentId: string, long = false) => ({
  id: `stopped-${agentId}`,
  ownerAgentId: agentId,
  error: long
    ? "The automatic assignment limit was reached. Continue or reassign this task. The source report still needs review before the team can complete the work."
    : "The agent could not complete this task.",
});

const longHistory = (length: number): AgentMessage[] =>
  Array.from({ length }, (_, index) => {
    const createdAt = new Date(2026, 8, 1 + Math.floor(index / 24), 9, (index % 24) * 2);
    const time = `${String(createdAt.getHours()).padStart(2, "0")}:${String(createdAt.getMinutes()).padStart(2, "0")}`;
    const message =
      index % 3 === 0
        ? channelStoryMemberMessage(`long-${index + 1}`, `Can you check step ${index + 1} of the launch plan?`, time)
        : channelStoryAgentMessage(
            `long-${index + 1}`,
            [chief, sales, research][index % 3]?.id ?? chief.id,
            `I checked step ${index + 1}. The owner, the date and the open risk are in the plan now.`,
            time,
          );
    return { ...message, createdAt: createdAt.toISOString() };
  });

/** Scroll the messages while the stopped task stays above the input. */
export const StoppedTaskAboveComposer: Story = {
  args: { messages: longHistory(40), stopped: [stoppedTask(chief.id)] },
};

/** Resize the viewport to check the composer with several long stopped tasks. */
export const StoppedTasks: Story = {
  args: {
    messages: longHistory(40),
    stopped: [stoppedTask(chief.id, true), stoppedTask(sales.id, true), stoppedTask(research.id, true)],
  },
};

/** An owner waits for its sub-tasks while another task is stopped: the two blocks stack. */
export const WaitingSubtasksAboveStoppedTask: Story = {
  args: { messages: longHistory(40), awaiting: waitingSubtasks, stopped: [stoppedTask(sales.id)] },
};

export const WaitingSubtasksAboveComposer: Story = {
  args: { messages: longHistory(40), awaiting: waitingSubtasks },
};

/** Five days of history, 120 messages: the scroll rail is on the right edge. */
export const LongHistory: Story = {
  args: { messages: longHistory(120) },
};

const streamSentence = "I am still checking the launch plan and adding each finding to this reply. ";

/**
 * A reply that grows for as long as the story is open, under a history that is long enough to scroll.
 * The reader can scroll up while an agent works. `scripts/chat-scroll-streaming-e2e.ts` drives it.
 */
function StreamingWhileReadingHistoryChannel(props: { args: ChannelStoryProps; history: AgentMessage[] }) {
  const [tick, setTick] = createSignal(0);
  const reply = channelStoryAgentMessage("reading-history-reply", chief.id, "", "13:10", true);
  Object.defineProperty(reply, "body", {
    configurable: true,
    enumerable: true,
    get: () => streamSentence.repeat(tick() + 1),
  });
  const interval = window.setInterval(() => setTick((current) => current + 1), 150);
  onCleanup(() => window.clearInterval(interval));
  return (
    <StoryChannelConversation
      {...props.args}
      activeTurnId="reading-history-turn"
      workers={[{ id: chief.id, name: chief.name, agent: chief }]}
      messages={[...props.history, reply]}
    />
  );
}

/**
 * A new message from one of the agents every 400ms for as long as the story is open, and the newest one
 * is still streaming. The reader can scroll up and read. `scripts/chat-scroll-streaming-e2e.ts` drives it.
 */
function ReplyBurstChannel(props: { args: ChannelStoryProps; history: AgentMessage[] }) {
  const [count, setCount] = createSignal(1);
  const replies = () =>
    Array.from({ length: count() }, (_, index) =>
      channelStoryAgentMessage(
        `reply-burst-${index + 1}`,
        [chief, sales, research][index % 3]?.id ?? chief.id,
        `Update ${index + 1}: I finished one more step of the launch plan and noted its owner and date.`,
        "13:10",
        index === count() - 1,
      ),
    );
  const interval = window.setInterval(() => setCount((current) => current + 1), 400);
  onCleanup(() => window.clearInterval(interval));
  return (
    <StoryChannelConversation
      {...props.args}
      activeTurnId="reply-burst-turn"
      messages={[...props.history, ...replies()]}
    />
  );
}

/** The reader and the agents in turn, as in the agent chat's scroll stories, so both chats scroll the same rows. */
const readingHistory = (length: number): AgentMessage[] =>
  Array.from({ length }, (_, index) =>
    index % 2 === 0
      ? channelStoryMemberMessage(
          `reading-history-${index + 1}`,
          `Can you check step ${index + 1} of the launch plan?`,
          "13:00",
        )
      : channelStoryAgentMessage(
          `reading-history-${index + 1}`,
          [chief, sales, research][index % 3]?.id ?? chief.id,
          `I checked step ${index + 1}. The owner, the date and the open risk are in the plan now.`,
          "13:00",
        ),
  );
const shortReadingHistory = readingHistory(40);
/** More than 100 rows, so the timeline draws only the rows near the screen. */
const longReadingHistory = readingHistory(120);

export const StreamingWhileReadingHistory: Story = {
  render: (args) => <StreamingWhileReadingHistoryChannel args={args} history={shortReadingHistory} />,
};

export const StreamingWhileReadingLongHistory: Story = {
  render: (args) => <StreamingWhileReadingHistoryChannel args={args} history={longReadingHistory} />,
};

export const ReplyBurstWhileReadingHistory: Story = {
  render: (args) => <ReplyBurstChannel args={args} history={shortReadingHistory} />,
};

export const ReplyBurstWhileReadingLongHistory: Story = {
  render: (args) => <ReplyBurstChannel args={args} history={longReadingHistory} />,
};

/** New replies since the reader was here: the divider stands above the first one. */
export const UnreadReplies: Story = {
  args: { messages: longHistory(40), unreadCount: 4, firstUnreadMessageId: "long-35" },
};

/** An archived channel takes no message: the notice stands in place of the composer. */
export const Archived: Story = {
  args: { archived: true },
};

/** A channel with no message shows its name, title and instructions. */
export const Empty: Story = {
  args: { messages: [] },
};
