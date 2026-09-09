import { For, Show } from "solid-js";
import { expect, fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { AgentMessage } from "../src/data";
import { ChannelActivityIndicator, type ChannelWorker } from "../src/features/channels/ChannelActivityIndicator";
import { ChatMessageRow } from "../src/features/conversation/ChatMessageRow";
import { MessageActions } from "../src/features/conversation/MessageRendering";
import { UnreadMessagesDivider } from "../src/features/conversation/UnreadMessages";
import { STORY_AGENTS } from "./fixtures";

/*
 * The channel transcript, drawn from the shared row.
 *
 * The rows are written out here rather than mounted from `ChannelConversation`, because that
 * component reads the channels context, which needs the account, server, turns and browser contexts
 * and a channel-aware `window.openbot` behind it. What is under test here is what the reader sees:
 * the coloured author name over the face beside it, the run of messages that names its author once,
 * the day separator, the reader's own message on the right with neither face nor name, and one
 * activity row for every agent the channel waits on.
 *
 * Compare with `Conversation` (`ScrollToLatest`, `UnreadMessages`, `StreamingMarkdownInChat`): the
 * two chats now draw the same row, so the bubble width, the entry gap and the hover toolbar have to
 * agree.
 */

const [chief, sales, research] = STORY_AGENTS;

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
    showAuthor: false,
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

function ChannelTranscript(props: { rows: Row[]; workers: ChannelWorker[] }) {
  return (
    <main class="conversation-panel" aria-label="Channel conversation">
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
                  footer={<time>{row.message.time}</time>}
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
    await expect(await canvas.findByRole("article", { name: `Message from ${chief.name}` })).toBeInTheDocument();
    await expect(await canvas.findByRole("article", { name: "Message from You" })).toBeInTheDocument();
    await expect(await canvas.findByText(`${chief.name} and ${sales.name} are working…`)).toBeInTheDocument();
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
