/**
 * The channel transcript as stories draw it, from the shared message row. It is written out rather
 * than mounted from `ChannelConversation`, which needs the channels context and every context behind
 * it. `ChannelConversation.stories.tsx` builds its variants on it, and the diagram workspace story
 * shows it when a channel is open.
 */

import { ArrowUp, Button } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ChannelActivityIndicator, type ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { MessageActions } from "@openbot/ui/features/conversation/MessageRendering";
import { UnreadMessagesDivider } from "@openbot/ui/features/conversation/UnreadMessages";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { fn } from "storybook/test";
import { requireFixture, STORY_AGENTS } from "./fixtures";

const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");
const sales = requireFixture(STORY_AGENTS[1], "Story agent 1");
const research = requireFixture(STORY_AGENTS[2], "Story agent 2");

export interface ChannelStoryRow {
  id: string;
  author: { kind: "you" | "agent"; name: string; agent?: (typeof STORY_AGENTS)[number] };
  showAuthor: boolean;
  dayMarker?: string;
  unread?: boolean;
  message: AgentMessage;
}

export function channelStoryMessage(id: string, body: string, time: string, streaming = false): AgentMessage {
  return { id, author: "agent", body, time, streaming };
}

export const CHANNEL_STORY_ROWS: ChannelStoryRow[] = [
  {
    id: "m1",
    author: { kind: "agent", name: chief.name, agent: chief },
    showAuthor: true,
    dayMarker: "Mon, Sep 7 11:12 PM",
    message: channelStoryMessage("m1", "I read the brief. I will split it into three tasks.", "11:12 PM"),
  },
  {
    id: "m2",
    author: { kind: "agent", name: chief.name, agent: chief },
    showAuthor: false,
    message: channelStoryMessage("m2", "Sales Outbound takes the first, I take the other two.", "11:13 PM"),
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
    message: channelStoryMessage("m4", "Last quarter closed 12% over plan. The detail is in the sheet.", "1:04 PM"),
  },
  {
    id: "m5",
    author: { kind: "agent", name: research.name, agent: research },
    showAuthor: true,
    message: channelStoryMessage("m5", "I am checking the source of the 12%…", "1:05 PM", true),
  },
];

export function ChannelTranscript(props: {
  rows: ChannelStoryRow[];
  workers: ChannelWorker[];
  children?: JSX.Element;
}) {
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

/** The channel composer at rest: the editor and the send button, for a story that shows a whole chat. */
export function ChannelStoryComposer(props: { channelName: string }) {
  const [text, setText] = createSignal("");
  return (
    <div class="composer-wrap">
      <form class="composer" data-compact="true" onSubmit={(event) => event.preventDefault()}>
        <div class="composer-input-label">
          <ComposerEditor
            agentId={undefined}
            agents={STORY_AGENTS}
            value={text()}
            placeholder={`Message ${props.channelName}`}
            ariaLabel="Message to channel"
            disabled={false}
            onSubmit={fn()}
            onValueChange={setText}
          />
        </div>
        <div class="composer-toolbar">
          <div class="composer-primary-actions">
            <Button type="submit" variant="ghost" class="voice-button" aria-label="Send message">
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
