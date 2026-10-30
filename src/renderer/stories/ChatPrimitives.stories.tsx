import type { MessageReaction } from "@openbot/contracts/ipc";
import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
  type BubbleVariant,
  Button,
  Heading,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  Text,
} from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { MessageActions, MessageBody } from "@openbot/ui/features/conversation/MessageRendering";
import { createMemo, createSignal, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { toAgentMessage } from "../src/app-message-projection";
import { STORY_AGENTS } from "./fixtures";

const messageBodyCallbacks = {
  onSelectAgent: fn(),
  onOpenLink: fn(),
  onPreview: fn(),
  onAttachmentAction: fn(),
  onDownload: fn(),
};

function PrototypeMessage(props: {
  message: AgentMessage;
  referencedMessage?: AgentMessage;
  variant?: BubbleVariant;
  actions?: boolean;
  reaction?: MessageReaction;
  onReply?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [expandedEmoji, setExpandedEmoji] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [reaction, setReaction] = createSignal<MessageReaction | null | undefined>(props.reaction);
  const message = createMemo<AgentMessage>(() => ({ ...props.message, reaction: reaction() }));
  const own = () => props.message.author === "you";
  const variant = () => props.variant ?? (own() ? "secondary" : "muted");

  return (
    <Message
      align={own() ? "end" : "start"}
      class={["chat-prototype-message", "message-entry", own() ? "message-entry-user" : "message-entry-agent"]}
      data-author={own() ? "user" : "assistant"}
      aria-label={`${own() ? "You" : "Assistant"} at ${props.message.time}`}
    >
      <MessageContent>
        <div class="message-shell">
          <Bubble
            align={own() ? "end" : "start"}
            variant={variant()}
            data-author={own() ? "user" : "assistant"}
            data-streaming={props.message.streaming ? "" : undefined}
          >
            <BubbleContent>
              <MessageBody
                message={message()}
                referencedMessage={props.referencedMessage}
                agents={STORY_AGENTS}
                {...messageBodyCallbacks}
              />
            </BubbleContent>
            <Show when={reaction()}>
              {(value) => (
                <BubbleReactions class="message-reaction-anchor" align={own() ? "start" : "end"}>
                  <Button
                    variant="ghost"
                    type="button"
                    class="message-reaction-pill"
                    aria-label={`Remove reaction ${value()}`}
                    onClick={() => setReaction(undefined)}
                  >
                    {value()}
                  </Button>
                </BubbleReactions>
              )}
            </Show>
          </Bubble>
        </div>
        <Show when={props.actions}>
          <div class="message-action-row">
            <MessageActions
              message={message()}
              pickerOpen={pickerOpen()}
              expandedEmoji={expandedEmoji()}
              copied={copied()}
              onTogglePicker={() => setPickerOpen((current) => !current)}
              onExpandEmoji={() => setExpandedEmoji((current) => !current)}
              onReact={(value) => {
                setReaction(value ?? undefined);
                setPickerOpen(false);
              }}
              onReply={props.onReply ?? fn()}
              onCopy={() => setCopied(true)}
            />
          </div>
        </Show>
        <MessageFooter>{props.message.streaming ? "Writing…" : props.message.time}</MessageFooter>
      </MessageContent>
    </Message>
  );
}

const meta = {
  title: "Conversation/Chat Primitives",
  component: Bubble,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof Bubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BubbleGallery: Story = {
  name: "Bubble variants",
  render: () => (
    <main class="foundation-story chat-primitives-story">
      <Heading as="h1" size="lg">
        Bubble surfaces
      </Heading>
      <Text tone="secondary">Seven treatments, two alignments, one stable composition.</Text>
      <section class="chat-primitives-gallery" aria-label="Bubble variants">
        {(
          [
            ["default", "Default · current user"],
            ["secondary", "Secondary · raised surface"],
            ["muted", "Muted · assistant response"],
            ["tinted", "Tinted · suggested action"],
            ["outline", "Outline · supporting content"],
            ["destructive", "Destructive · failed action"],
          ] as const
        ).map(([variant, label], index) => (
          <Bubble variant={variant} align={index % 2 === 0 ? "start" : "end"}>
            <BubbleContent>{label}</BubbleContent>
          </Bubble>
        ))}
        <Bubble variant="muted">
          <BubbleContent>Reactions stay anchored to the surface.</BubbleContent>
          <BubbleReactions overflowCount={2} role="img" aria-label="Reactions: eyes, rocket, and two more">
            <span aria-hidden="true">👀</span>
            <span aria-hidden="true">🚀</span>
          </BubbleReactions>
        </Bubble>
        <BubbleGroup>
          <Bubble variant="muted">
            <BubbleContent>Grouped messages share a tighter rhythm.</BubbleContent>
          </Bubble>
          <Bubble variant="muted">
            <BubbleContent>The sender remains easy to scan.</BubbleContent>
          </Bubble>
        </BubbleGroup>
        <Bubble variant="ghost">
          <BubbleContent>
            <div class="chat-primitives-ghost-sample">Ghost removes the second frame around rich content.</div>
          </BubbleContent>
        </Bubble>
      </section>
    </main>
  ),
};

export const MessageComposition: Story = {
  name: "Message composition",
  render: () => (
    <main class="foundation-story chat-primitives-story">
      <Heading as="h1" size="lg">
        Message composition
      </Heading>
      <section class="chat-primitives-stage chat-primitives-stage-compact" aria-label="Direct message example">
        <Message>
          <MessageAvatar>AC</MessageAvatar>
          <MessageContent>
            <MessageHeader>Alice Chen</MessageHeader>
            <Bubble variant="muted">
              <BubbleContent>I checked the launch notes and added the missing owner.</BubbleContent>
            </Bubble>
            <MessageFooter>10:14</MessageFooter>
          </MessageContent>
        </Message>
        <MessageGroup>
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>Perfect. I’ll review it now.</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>Then we can ship the internal preview.</BubbleContent>
              </Bubble>
              <MessageFooter>10:15 · Delivered</MessageFooter>
            </MessageContent>
          </Message>
        </MessageGroup>
      </section>
    </main>
  ),
};

export const MessageDates: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Chat message dates
      </Heading>
      {[1, 0].map((daysAgo) => {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return (
          <PrototypeMessage
            message={toAgentMessage({
              id: `dated-message-${daysAgo}`,
              author: daysAgo ? "user" : "assistant",
              text: daysAgo ? "Yesterday’s request" : "Today’s response",
              createdAt: date.toISOString(),
              status: "completed",
            })}
          />
        );
      })}
    </main>
  ),
};
