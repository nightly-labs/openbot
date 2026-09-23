import { ArrowUp, Button, Plus, X } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ChannelActivityIndicator, type ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { ChannelStoppedTasks } from "@openbot/ui/features/channels/ChannelStoppedTasks";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { MessageActions } from "@openbot/ui/features/conversation/MessageRendering";
import { UnreadMessagesDivider } from "@openbot/ui/features/conversation/UnreadMessages";
import type { JSX } from "@solidjs/web";
import { createStore, For, Show } from "solid-js";
import { expect, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "./fixtures";

/*
 * The channel transcript, drawn from the shared row.
 *
 * The rows are written out here rather than mounted from `ChannelConversation`, because that
 * component reads the channels context, which needs the account, server, turns and browser contexts
 * and a channel-aware `window.openbot` behind it. What is under test here is what the reader sees:
 * the coloured author name above the bubble and the face beside its bottom edge, the run of messages that names its author once,
 * the day separator, the reader's own message on the right with neither face nor name, and one
 * activity row for every agent the channel waits on.
 *
 * Compare with `Conversation` (`ScrollToLatest`, `UnreadMessages`, `StreamingMarkdownInChat`): the
 * two chats now draw the same row, so the bubble width, the entry gap and the hover toolbar have to
 * agree.
 */

const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");
const sales = requireFixture(STORY_AGENTS[1], "Story agent 1");
const research = requireFixture(STORY_AGENTS[2], "Story agent 2");

interface Row {
  id: string;
  author: { kind: "you" | "agent"; name: string; agent?: (typeof STORY_AGENTS)[number] };
  showAuthor: boolean;
  dayMarker?: string;
  unread?: boolean;
  message: AgentMessage;
}

function agentMessage(id: string, body: string, time: string, streaming = false): AgentMessage {
  return { id, author: "agent", body, time, streaming };
}

const rows: Row[] = [
  {
    id: "m1",
    author: { kind: "agent", name: chief.name, agent: chief },
    showAuthor: true,
    dayMarker: "Mon, Sep 7 11:12 PM",
    message: agentMessage("m1", "I read the brief. I will split it into three tasks.", "11:12 PM"),
  },
  {
    id: "m2",
    author: { kind: "agent", name: chief.name, agent: chief },
    showAuthor: false,
    message: agentMessage("m2", "Sales Outbound takes the first, I take the other two.", "11:13 PM"),
  },
  {
    id: "m3",
    author: { kind: "you", name: "You" },
    showAuthor: true,
    dayMarker: "Today 12:59 PM",
    message: { id: "m3", author: "you", body: "Good. Start with the numbers.", time: "12:59 PM" },
  },
  {
    id: "m4",
    author: { kind: "agent", name: sales.name, agent: sales },
    showAuthor: true,
    unread: true,
    message: agentMessage("m4", "Last quarter closed 12% over plan. The detail is in the sheet.", "1:04 PM"),
  },
  {
    id: "m5",
    author: { kind: "agent", name: research.name, agent: research },
    showAuthor: true,
    message: agentMessage("m5", "I am checking the source of the 12%…", "1:05 PM", true),
  },
];

function ChannelTranscript(props: { rows: Row[]; workers: ChannelWorker[]; children?: JSX.Element }) {
  return (
    <main class="conversation-panel" aria-label="Channel conversation" style={{ height: "100dvh" }}>
      <section class="conversation-scroll" aria-label="Shared messages">
        <div class="virtual-chat-list virtual-chat-list-static">
          <For each={props.rows}>
            {(row) => (
              <div class="virtual-chat-row" data-grouped={row.showAuthor ? undefined : "sender"}>
                <Show when={row.dayMarker}>
                  <div class="time-marker">
                    <span>{row.dayMarker}</span>
                  </div>
                </Show>
                <Show when={row.unread}>
                  <UnreadMessagesDivider />
                </Show>
                <ChatMessageRow
                  message={row.message}
                  author={row.author}
                  showAuthor={row.showAuthor}
                  showTime={row.showAuthor}
                  agents={STORY_AGENTS}
                  onSelectAgent={fn()}
                  onOpenLink={fn()}
                  onPreview={fn()}
                  onAttachmentAction={fn()}
                  actions={
                    <MessageActions
                      message={row.message}
                      authorName={row.author.name}
                      reactions={false}
                      pickerOpen={false}
                      moreOpen={false}
                      expandedEmoji={false}
                      copied={false}
                      onTogglePicker={fn()}
                      onToggleMore={fn()}
                      onExpandEmoji={fn()}
                      onReact={fn()}
                      onReply={fn()}
                      onCopy={fn()}
                    />
                  }
                />
              </div>
            )}
          </For>
        </div>
        <div class="agent-activity-slot" data-reserved={props.workers.length > 0 ? "true" : "false"}>
          <Show when={props.workers.length > 0}>
            <ChannelActivityIndicator workers={props.workers} />
          </Show>
        </div>
      </section>
      {props.children}
    </main>
  );
}

const meta = {
  title: "Conversation/Channel Transcript",
  component: ChatMessageRow,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ChatMessageRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChannelTranscriptWithSeveralAuthors: Story = {
  render: () => (
    <ChannelTranscript
      rows={rows}
      workers={[
        { id: chief.id, name: chief.name, agent: chief },
        { id: sales.id, name: sales.name, agent: sales },
      ]}
    />
  ),
  play: async ({ canvas }) => {
    const chiefMessages = await canvas.findAllByRole("article", { name: `Message from ${chief.name}` });
    await expect(chiefMessages).toHaveLength(2);
    const [firstChiefMessage, secondChiefMessage] = chiefMessages;
    if (!firstChiefMessage || !secondChiefMessage) throw new Error("Chief messages are missing.");
    await expect(within(firstChiefMessage).getByText("11:12 PM")).toBeInTheDocument();
    await expect(within(secondChiefMessage).queryByText("11:13 PM")).not.toBeInTheDocument();
    const ownMessage = await canvas.findByRole("article", { name: "Message from You" });
    await expect(within(ownMessage).getByText("12:59 PM")).toBeInTheDocument();
    // The label after the colon shifts on every turn, the way it does in the agent chat, so the
    // announcement is matched on its subject.
    await expect(
      await canvas.findByRole("status", { name: new RegExp(`^${chief.name} and ${sales.name} are working: `) }),
    ).toBeInTheDocument();
  },
};

/** One agent at work: the sentence has to read for a single name too. */
export const ChannelTranscriptWithOneWorker: Story = {
  render: () => (
    <ChannelTranscript rows={rows.slice(0, 3)} workers={[{ id: chief.id, name: chief.name, agent: chief }]} />
  ),
};

/** Nothing is running: the activity row leaves, and the transcript keeps its place. */
export const ChannelTranscriptAtRest: Story = {
  render: () => <ChannelTranscript rows={rows.slice(0, 4)} workers={[]} />,
};

/** Wrapped text, a long name, and an author whose profile is no longer available. */
export const AuthorLayout: Story = {
  render: () => (
    <ChannelTranscript
      rows={[
        {
          id: "wrapped",
          author: { kind: "agent", name: "Research and project coordination", agent: research },
          showAuthor: true,
          message: agentMessage(
            "wrapped",
            "I checked the project notes and the source material.\n\nThe next step is to confirm the owners and share the final plan with the team.",
            "1:06 PM",
          ),
        },
        {
          id: "former-member",
          author: { kind: "agent", name: "Former member" },
          showAuthor: true,
          message: agentMessage("former-member", "My notes are ready for review.", "1:07 PM"),
        },
      ]}
      workers={[]}
    />
  ),
};

function StoppedTaskConversation(props: { long?: boolean; expanded?: boolean; multiple?: boolean }) {
  const [state, setState] = createStore({
    text: props.expanded ? "Check the report again.\nInclude the source data." : "",
    attachment: Boolean(props.expanded),
    tasks: (props.multiple ? [chief, sales, research] : [chief]).map((agent) => ({
      id: `stopped-${agent.id}`,
      ownerAgentId: agent.id,
      error: props.expanded
        ? "The automatic assignment limit was reached. Continue or reassign this task. The source report still needs review before the team can complete the work."
        : "The agent could not complete this task.",
    })),
  });
  const transcript = props.long
    ? Array.from({ length: 12 }, (_, index) =>
        rows.map((row) => ({ ...row, id: `${index}-${row.id}`, unread: false })),
      ).flat()
    : rows.slice(0, 3);
  return (
    <ChannelTranscript rows={transcript} workers={[]}>
      <div class="composer-wrap">
        <ChannelStoppedTasks
          tasks={state.tasks}
          members={STORY_AGENTS.map((agent) => ({ agentId: agent.id }))}
          name={(id) => STORY_AGENTS.find((agent) => agent.id === id)?.name ?? "Unassigned"}
          onResume={async (id) => {
            setState((state) => {
              state.tasks = state.tasks.filter((task) => task.id !== id);
            });
            return true;
          }}
        />
        <form
          class="composer"
          data-compact={!state.attachment && !state.text.includes("\n") && state.text.length < 120 ? "true" : undefined}
          onSubmit={(event) => event.preventDefault()}
        >
          <Show when={state.attachment}>
            <div class="composer-attachments">
              <div class="composer-attachment" data-kind="file">
                <span class="composer-attachment-copy">
                  <strong>report.csv</strong>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label="Remove report.csv"
                  onClick={() =>
                    setState((state) => {
                      state.attachment = false;
                    })
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          </Show>
          <div class="composer-input-label">
            <ComposerEditor
              agentId={undefined}
              agents={STORY_AGENTS}
              value={state.text}
              placeholder="Message Project room"
              ariaLabel="Message to channel"
              disabled={false}
              onSubmit={fn()}
              onValueChange={(text) =>
                setState((state) => {
                  state.text = text;
                })
              }
            />
          </div>
          <div class="composer-toolbar">
            <Button
              type="button"
              variant="ghost"
              class="composer-button"
              aria-label="Attach files"
              onClick={() =>
                setState((state) => {
                  state.attachment = true;
                })
              }
            >
              <Plus aria-hidden="true" />
            </Button>
            <div class="composer-primary-actions">
              <Button type="submit" variant="ghost" class="voice-button" aria-label="Send message">
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </ChannelTranscript>
  );
}

/** Scroll the messages while the stopped task stays above the input. */
export const StoppedTaskAboveComposer: Story = {
  render: () => <StoppedTaskConversation long />,
};

export const StoppedTaskWithShortConversation: Story = {
  render: () => <StoppedTaskConversation />,
};

/** Resize the viewport, remove the attachment, and shorten the draft to check both composer sizes. */
export const StoppedTasksWithAttachments: Story = {
  render: () => <StoppedTaskConversation long expanded multiple />,
};
