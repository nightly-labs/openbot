import type { AttachmentSummary, ConversationReaction, InstalledSkill } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import {
  Bubble,
  BubbleContent,
  BubbleReactions,
  Button,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "../../components/ui";
import type { AgentMessage, AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import { conversationBubbleVariant, MessageBody } from "./MessageRendering";

/**
 * Who wrote a message, as much as a row needs to draw it.
 *
 * `you` is the only kind that stands on the right, and the only kind that draws neither a face nor
 * a name: a chat does not tell the reader who they are. Everything else is an author with an
 * identity, whether it is an agent of this chat or a member of a channel.
 */
export interface ChatMessageAuthor {
  kind: "you" | "agent";
  name: string;
  /** Missing for an author the agent list no longer holds, and for the reader's own messages. */
  agent?: AgentProfile;
  /** The face to draw when the profile is gone: the author id keeps deleted agents apart. */
  avatarSeed?: string;
}

export interface ChatMessageRowProps {
  message: AgentMessage;
  author: ChatMessageAuthor;
  /**
   * Whether the face and the name stand above the bubble. The agent chat never shows them - one
   * chat has one agent, and its name is in the header - and a channel shows them once for a run of
   * messages by one author.
   */
  showAuthor?: boolean;
  animate?: boolean;
  agents: AgentProfile[];
  skills?: InstalledSkill[];
  referencedMessage?: AgentMessage;
  /** Who wrote the quoted message. A chat with several authors has to name the one it quotes. */
  referencedAuthorName?: string;
  reactions?: readonly ConversationReaction[];
  reactionOverflowCount?: number;
  onRemoveReaction?: () => void;
  actions?: JSX.Element;
  footer?: JSX.Element;
  /** Extra content inside the bubble, under the body: a question prompt, a note about the message. */
  children?: JSX.Element;
  class?: string;
  "data-chat-search-message"?: string;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  onOpenSharedFile?: (path: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  onDownload?: (attachment: AttachmentSummary) => void;
}

/**
 * One message of a chat: the alignment, the face, the name, the bubble, its reactions, the hover
 * toolbar and the footer.
 *
 * It is shared because the agent chat and the channel chat draw the same message. They differed on
 * every part around the bubble - the channel had no entrance animation, no streaming state on the
 * bubble and no toolbar - for as long as each wrote its own row, and this component is what stops
 * that from happening a third time. It reads no context and no store: what a caller knows about a
 * conversation arrives as a prop.
 */
export function ChatMessageRow(props: ChatMessageRowProps): JSX.Element {
  const own = () => props.author.kind === "you";
  const seed = () => props.author.agent?.avatarSeed ?? props.author.avatarSeed;
  // A colour literal in an inline style is refused by `check:ui`, and rightly: this is the agent's
  // own head colour, read through the same helper the action markers use, so a name matches the
  // face beside it.
  const authorStyle = () => {
    const currentSeed = seed();
    if (own() || currentSeed === undefined) return undefined;
    return `--message-author-color: ${avatarHeadColor(currentSeed, props.author.agent?.avatarHue ?? null)}`;
  };
  return (
    <Message
      role="article"
      align={own() ? "end" : "start"}
      aria-label={`Message from ${props.author.name}`}
      data-author={own() ? "user" : "assistant"}
      data-chat-search-message={props["data-chat-search-message"]}
      style={authorStyle()}
      class={[
        "message-entry",
        {
          "message-entry-animated": props.animate === true,
          "message-entry-user": own(),
          "message-entry-agent": !own(),
        },
        props.class,
      ]}
    >
      <Show when={props.showAuthor && !own()}>
        <MessageAvatar>
          <AgentAvatar agent={props.author.agent} seed={seed()} />
        </MessageAvatar>
      </Show>
      <Show when={props.showAuthor === false && !own()}>
        <div class="message-author-gutter" aria-hidden="true" />
      </Show>
      <MessageContent>
        <Show when={props.showAuthor && !own()}>
          <MessageHeader class="message-author-name">{props.author.name}</MessageHeader>
        </Show>
        <div class="message-shell">
          <Bubble
            align={own() ? "end" : "start"}
            variant={conversationBubbleVariant(props.message)}
            data-author={own() ? "user" : "assistant"}
            data-streaming={props.message.streaming === true ? "" : undefined}
          >
            <BubbleContent>
              <MessageBody
                animate={props.animate}
                message={props.message}
                referencedMessage={props.referencedMessage}
                referencedAuthorName={props.referencedAuthorName}
                agents={props.agents}
                skills={props.skills}
                onSelectAgent={props.onSelectAgent}
                onOpenLink={props.onOpenLink}
                onPreview={props.onPreview}
                onAttachmentAction={props.onAttachmentAction}
                onOpenSharedFile={props.onOpenSharedFile}
                onOpenWorkspaceFile={props.onOpenWorkspaceFile}
                onDownload={props.onDownload}
              />
              {props.children}
            </BubbleContent>
            <Show when={(props.reactions?.length ?? 0) > 0}>
              <BubbleReactions
                class="message-reaction-anchor"
                align={own() ? "start" : "end"}
                overflowCount={props.reactionOverflowCount}
                role="group"
                aria-label={`Reactions: ${(props.reactions ?? []).map((reaction) => reaction.emoji).join(", ")}`}
              >
                <For each={props.reactions ?? []}>
                  {(reaction) => (
                    <Show
                      when={reaction.actor.kind === "user"}
                      fallback={
                        <span
                          class="message-reaction-pill message-reaction-pill-readonly"
                          role="img"
                          aria-label={`${
                            props.agents.find(
                              (agent) => reaction.actor.kind === "agent" && agent.id === reaction.actor.agentId,
                            )?.name ?? "Agent"
                          } reacted with ${reaction.emoji}`}
                        >
                          <span aria-hidden="true">{reaction.emoji}</span>
                        </span>
                      }
                    >
                      <Button
                        variant="ghost"
                        type="button"
                        class="message-reaction-pill"
                        aria-label={`Remove your reaction ${reaction.emoji}`}
                        onClick={() => props.onRemoveReaction?.()}
                      >
                        <span aria-hidden="true">{reaction.emoji}</span>
                      </Button>
                    </Show>
                  )}
                </For>
              </BubbleReactions>
            </Show>
          </Bubble>
          {props.actions}
        </div>
        <Show when={props.footer}>
          <MessageFooter>{props.footer}</MessageFooter>
        </Show>
      </MessageContent>
    </Message>
  );
}
