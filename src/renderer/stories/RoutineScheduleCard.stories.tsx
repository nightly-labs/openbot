import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import {
  RoutineScheduleCard,
  type RoutineScheduleCardProps,
} from "@openbot/ui/features/conversation/RoutineScheduleCard";
import { ROUTINE_WORKDAYS, type RoutineScheduleDraft } from "@openbot/ui/features/conversation/routine-schedule-draft";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "./fixtures";

/*
 * The chat record of a routine an agent created or changed. The person moves the run from the
 * chat with the same chip row the routine settings use. `onChange` is a spy here; in the app,
 * `RoutineChatCard` saves each change. The card is a variant of "Conversation/Chat action card".
 */

const STORY_TODAY = new Date(2026, 8, 24, 10, 0);
const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");

type CardArgs = Omit<RoutineScheduleCardProps, "onChange"> & { onChange: (schedule: RoutineScheduleDraft) => void };

/** Holds the schedule, so a chip change redraws the row the way a saved update will. */
function CardStage(props: CardArgs & { editable?: boolean }) {
  const [schedule, setSchedule] = createSignal(() => props.schedule);
  return (
    <RoutineScheduleCard
      {...props}
      schedule={schedule()}
      today={STORY_TODAY}
      onChange={
        props.editable === false
          ? undefined
          : (next) => {
              setSchedule(next);
              props.onChange(next);
            }
      }
    />
  );
}

const meta = {
  title: "Routines/Schedule card",
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <CardStage {...args} />
    </main>
  ),
  args: {
    routineName: "Morning brief",
    action: "created",
    schedule: { kind: "daily", days: ROUTINE_WORKDAYS, time: "07:30" },
    state: "idle",
    nextRunLabel: "Fri, Sep 25 at 7:30 AM",
    onChange: fn(),
    onOpenRoutine: fn(),
  },
  argTypes: {
    action: { control: "inline-radio", options: ["created", "updated"] },
    state: { control: "select", options: ["idle", "saving", "saved", "error", "deleted", "superseded"] },
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<CardArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Created: Story = {};

export const UpdatedEditing: Story = {
  args: {
    action: "updated",
    routineName: "Weekly planning",
    schedule: { kind: "weekly", weekday: 5, time: "16:00" },
    nextRunLabel: "Fri, Sep 25 at 4:00 PM",
  },
};

export const Saving: Story = { args: { state: "saving" } };

export const Saved: Story = { args: { action: "updated", state: "saved" } };

/** A later card changed this routine. This one keeps the old schedule as a record only. */
export const Superseded: Story = {
  args: { state: "superseded", nextRunLabel: undefined, onShowLatest: fn() },
};

/** The routine runs in a zone that is not the viewer's, for example a teammate's computer. */
export const OtherTimeZone: Story = { args: { timeZoneLabel: "Warsaw time" } };

export const SaveError: Story = {
  args: { action: "updated", state: "error", errorText: "Could not save the schedule. Try again." },
};

export const Deleted: Story = {
  args: { state: "deleted", nextRunLabel: undefined },
};

export const ReadOnly: Story = {
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <CardStage {...args} editable={false} />
    </main>
  ),
};

function message(id: string, author: AgentMessage["author"], body: string, time: string): AgentMessage {
  return { id, author, body, time };
}

const ask = message("m1", "you", "Every weekday morning, send me a short brief of what changed.", "9:58 AM");
const reply = message(
  "m2",
  "agent",
  "Done. I set it for 7:30 AM. Move it from the card if that is too early.",
  "9:59 AM",
);

/** The card between the request and the reply, at the width of a chat. */
export const InConversation: Story = {
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <main class="conversation-panel" aria-label="Conversation" style={{ height: "100dvh" }}>
      <section class="conversation-scroll" aria-label="Messages">
        <div class="virtual-chat-list virtual-chat-list-static">
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={ask}
              author={{ kind: "you", name: "You" }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
          <div class="virtual-chat-row">
            <CardStage {...args} />
          </div>
          <div class="virtual-chat-row">
            <ChatMessageRow
              message={reply}
              author={{ kind: "agent", name: chief.name, agent: chief }}
              agents={STORY_AGENTS}
              onSelectAgent={fn()}
              onOpenLink={fn()}
              onPreview={fn()}
              onAttachmentAction={fn()}
            />
          </div>
        </div>
      </section>
    </main>
  ),
};
