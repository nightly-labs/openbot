import type { AttachmentSummary, AvatarColor, ConversationReaction, InstalledSkill } from "@openbot/contracts/ipc";
import {
  Bubble,
  BubbleContent,
  BubbleReactions,
  Button,
  ContextMenu,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { children, createMemo, For, Show } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import type { AgentMessage, AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { AttachmentDownloads, AttachmentMediaSource } from "./AttachmentCards";
import type { MessageImageFile } from "./MarkdownMessageText";
import { conversationBubbleVariant, MessageBody } from "./MessageRendering";

/**
 * Who wrote a message, as much as a row needs to draw it.
 *
 * `you` draws neither a face nor a name: a chat does not tell the reader who they are. `member` is
 * another person in an agent chat. People stand on the right and agents on the left, so a member
 * row stands with the reader's own and adds a name, and a bubble in that person's colour. Everything else is an author with an
 * identity, whether it is an agent of this chat or a member of a channel.
 */
export interface ChatMessageAuthor {
  kind: "you" | "agent" | "member";
  name: string;
  /** Missing for an author the agent list no longer holds, and for the reader's own messages. */
  agent?: AgentProfile | undefined;
  /** The face to draw when the profile is gone: the author id keeps deleted agents apart. */
  avatarSeed?: string | undefined;
  /**
   * The tint of the bubble, for a person. An agent's tint comes from its profile. Without a tint, the
   * reader's and an agent's bubbles stay grey, and another person's bubble takes their name colour.
   */
  chatColor?: AvatarColor | undefined;
}

export interface ChatMessageRowProps {
  message: AgentMessage;
  author: ChatMessageAuthor;
  /**
   * Whether the face stands beside the bubble and the name above it. The agent chat never shows a
   * face - one chat has one agent, and its name is in the header - but names another person once
   * for a run of their messages. A channel shows both once for a run of messages by one author.
   * `false` keeps an empty gutter where the face stands; leave it out when the row has no face.
   */
  showAuthor?: boolean | undefined;
  /** Whether the time stands beside the author name. Without a name, the time is in the action row. */
  showTime?: boolean | undefined;
  /** Draws a long message in full, with no fold: in-chat search and a quote jump read the drawn text. */
  showFull?: boolean | undefined;
  /** Opens a folded long message, as its "Show full message" button does. The reader can fold it again. */
  open?: boolean | undefined;
  animate?: boolean;
  agents: AgentProfile[];
  skills?: InstalledSkill[] | undefined;
  referencedMessage?: AgentMessage | undefined;
  /** Who wrote the quoted message. A chat with several authors has to name the one it quotes. */
  referencedAuthorName?: string | undefined;
  /** Opens the quoted message in the chat. */
  onOpenReference?: (() => void) | undefined;
  referenceState?: "loading" | "unavailable" | undefined;
  reactions?: readonly ConversationReaction[] | undefined;
  reactionOverflowCount?: number | undefined;
  onRemoveReaction?: (() => void) | undefined;
  actions?: JSX.Element;
  /** Draws the right-click menu, a `MessageMenu`. Without it, right-click keeps the native menu. */
  menu?: (() => JSX.Element) | undefined;
  /** Extra content inside the bubble, under the body: a question prompt, a note about the message. */
  children?: JSX.Element;
  /**
   * The steps of the turn that wrote the message. They stand at the end of the action row and show
   * with the actions, so a channel reads name, answer.
   */
  steps?: JSX.Element;
  /** True when the actions and steps stand beside the bubble, as a channel shows an agent's answer. They go under it when the line has no room. */
  actionsBeside?: boolean | undefined;
  class?: string | undefined;
  "data-chat-search-message"?: string | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  onOpenSharedFile?: (path: string, asWritten?: string) => void;
  onOpenWorkspaceFile?: ((path: string, asWritten?: string) => void) | undefined;
  onOpenQuote?: ((messageId: string, text: string) => void) | undefined;
  onOpenTag?: ((kind: "tab" | "thread", id: string) => void) | undefined;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
  /** Loads the images and media of a client that gets no `previewUrl`. */
  mediaSource?: AttachmentMediaSource | undefined;
  /** The download state of attachments from a joined server. */
  downloads?: AttachmentDownloads | undefined;
  /** Reads an image file that an agent message names, for a preview under the text. */
  loadImageFile?: ((file: MessageImageFile) => Promise<string | null>) | undefined;
  onDownloadImageFile?: ((file: MessageImageFile) => void) | undefined;
  /** The window draws the macOS window controls over the top start corner. The image viewer leaves room. */
  macWindowControls?: boolean | undefined;
}

/**
 * One message of a chat: the alignment, the face, the name, the bubble, its reactions, the action
 * row under the bubble.
 *
 * It is shared because the agent chat and the channel chat draw the same message. They differed on
 * every part around the bubble - the channel had no entrance animation, no streaming state on the
 * bubble and no toolbar - for as long as each wrote its own row, and this component is what stops
 * that from happening a third time. It reads no context and no store: what a caller knows about a
 * conversation arrives as a prop.
 */
export function ChatMessageRow(props: ChatMessageRowProps): JSX.Element {
  const { t } = useText();
  const own = () => props.author.kind === "you";
  const member = () => props.author.kind === "member";
  const person = () => own() || member();
  // A memo, because `Bubble` reads the variant more than once and it splits the whole body.
  const variant = createMemo(() => conversationBubbleVariant(props.message));
  const seed = () => props.author.agent?.avatarSeed ?? props.author.avatarSeed;
  // A colour literal in an inline style is refused by `check:ui`, and rightly: this is the agent's
  // own head colour, read through the same helper the action markers use, so a name matches the
  // face beside it.
  const chatColor = () => props.author.chatColor ?? props.author.agent?.chatColor;
  const authorStyle = () => {
    const currentSeed = seed();
    const tint = chatColor();
    const styles = [
      own() || currentSeed === undefined
        ? undefined
        : `--message-author-color: ${avatarHeadColor(currentSeed, props.author.agent?.avatarHue ?? null, props.author.agent?.avatarColor ?? null)}`,
      tint === undefined ? undefined : `--message-chat-color: ${tint}`,
    ].filter((style) => style !== undefined);
    return styles.length > 0 ? styles.join("; ") : undefined;
  };
  const bubbleClass = () => ({
    "message-bubble-member": member(),
    "message-bubble-colored": chatColor() !== undefined,
  });
  const rowClass = () => [
    "message-entry",
    {
      "message-entry-animated": props.animate === true,
      "message-entry-user": person(),
      "message-entry-agent": !person(),
      "message-entry-with-author": props.showAuthor === true && !person(),
      "message-entry-actions-beside": beside(),
    },
    props.class,
  ];
  // The native menu copies selected text and links, and Shift opens Inspect Element. These cases
  // stop the event before the trigger's delegated handler, which would prevent its default, so the
  // native menu still opens. The keyboard opens the menu with a synthetic event, which always opens it.
  const onSelection = (event: MouseEvent) => {
    const selection = window.getSelection();
    return (
      selection !== null &&
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      [...selection.getRangeAt(0).getClientRects()].some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )
    );
  };
  const keepNativeMenu = (row: HTMLElement) => {
    // Chromium on macOS can select the word under the pointer before `contextmenu`, so the press
    // that opens a menu records the selection the user made before it.
    let pressOnSelection: boolean | undefined;
    row.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button === 2 || event.ctrlKey) pressOnSelection = onSelection(event);
      },
      { capture: true },
    );
    row.addEventListener(
      "contextmenu",
      (event) => {
        const selected = pressOnSelection ?? onSelection(event);
        pressOnSelection = undefined;
        if (!event.isTrusted) return;
        const link = event.target instanceof Element && event.target.closest("a[href]") !== null;
        if (event.shiftKey || link || selected) event.stopPropagation();
      },
      { capture: true },
    );
  };
  // Read once: a person's row shows its bubble only when the bubble holds something, such as a voice player.
  const extra = children(() => props.children);
  const steps = children(() => props.steps);
  const messageBody = (frame?: (content: JSX.Element, imagesOnly: () => boolean) => JSX.Element) => (
    <MessageBody
      frame={frame}
      showFull={props.showFull}
      open={props.open}
      animate={props.animate}
      message={props.message}
      referencedMessage={props.referencedMessage}
      referencedAuthorName={props.referencedAuthorName}
      onOpenReference={props.onOpenReference}
      referenceState={props.referenceState}
      agents={props.agents}
      skills={props.skills}
      onSelectAgent={props.onSelectAgent}
      onOpenLink={props.onOpenLink}
      onPreview={props.onPreview}
      onAttachmentAction={props.onAttachmentAction}
      onOpenSharedFile={props.onOpenSharedFile}
      onOpenWorkspaceFile={props.onOpenWorkspaceFile}
      onOpenQuote={props.onOpenQuote}
      onOpenTag={props.onOpenTag}
      onDownload={props.onDownload}
      mediaSource={props.mediaSource}
      downloads={props.downloads}
      loadImageFile={props.loadImageFile}
      onDownloadImageFile={props.onDownloadImageFile}
      macWindowControls={props.macWindowControls}
    />
  );
  const bubble = (content: JSX.Element): JSX.Element => (
    <Bubble
      class={bubbleClass()}
      align={person() ? "end" : "start"}
      variant={variant()}
      data-author={person() ? "user" : "assistant"}
      data-streaming={props.message.streaming === true ? "" : undefined}
    >
      <BubbleContent>
        {content}
        {extra()}
      </BubbleContent>
      <Show when={(props.reactions?.length ?? 0) > 0}>
        <BubbleReactions
          class="message-reaction-anchor"
          align={person() ? "start" : "end"}
          overflowCount={props.reactionOverflowCount}
          role="group"
          aria-label={t("chat.row.reactions", {
            emoji: (props.reactions ?? []).map((reaction) => reaction.emoji).join(", "),
          })}
        >
          <For each={props.reactions ?? []}>
            {(reaction) => (
              <Show
                when={reaction.actor.kind === "user"}
                fallback={
                  <span
                    class="message-reaction-pill message-reaction-pill-readonly"
                    role="img"
                    aria-label={t("chat.row.agentReaction", {
                      name:
                        props.agents.find(
                          (agent) => reaction.actor.kind === "agent" && agent.id === reaction.actor.agentId,
                        )?.name ?? t("chat.message.agentFallback"),
                      emoji: reaction.emoji,
                    })}
                  >
                    <span aria-hidden="true">{reaction.emoji}</span>
                  </span>
                }
              >
                <Button
                  variant="ghost"
                  type="button"
                  class="message-reaction-pill"
                  aria-label={t("chat.row.removeReaction", { emoji: reaction.emoji })}
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
  );
  // The actions, the time and the steps stand under the bubble. A named author shows the time beside
  // the name. A row beside the bubble goes under it only when the line has no room.
  const beside = () => props.actionsBeside === true && !person();
  const actionRow = (): JSX.Element => (
    <div class="message-action-row">
      {props.actions}
      <Show when={!props.showAuthor || own()}>
        <time class="message-time" datetime={props.message.createdAt}>
          {props.message.time}
        </time>
      </Show>
      <Show when={steps.toArray().length > 0}>
        <div class="message-steps">{steps()}</div>
      </Show>
    </div>
  );
  const body = (): JSX.Element => (
    <>
      <Show when={props.showAuthor && !person()}>
        <MessageAvatar class="message-author-avatar">
          <Show when={props.author.agent} fallback={<AgentAvatar seed={seed()} />}>
            {(agent) => (
              <Button
                variant="ghost"
                class="message-author-avatar-button"
                aria-label={t("chat.row.openChat", { name: props.author.name })}
                onClick={() => props.onSelectAgent(agent().id)}
              >
                <AgentAvatar agent={agent()} seed={seed()} />
              </Button>
            )}
          </Show>
        </MessageAvatar>
      </Show>
      <Show when={props.showAuthor === false && !person()}>
        <div class="message-author-gutter" aria-hidden="true" />
      </Show>
      <MessageContent>
        <Show when={props.showAuthor && !own()}>
          <MessageHeader class="message-author-name">
            <Show when={props.author.agent} fallback={<span>{props.author.name}</span>}>
              {(agent) => (
                <Button
                  variant="ghost"
                  class="message-author-name-button"
                  aria-label={t("chat.row.openChat", { name: props.author.name })}
                  onClick={() => props.onSelectAgent(agent().id)}
                >
                  {props.author.name}
                </Button>
              )}
            </Show>
            <Show when={props.showTime}>
              <time class="message-time" datetime={props.message.createdAt}>
                {props.message.time}
              </time>
            </Show>
          </MessageHeader>
        </Show>
        <div class="message-shell">
          {/* A person's images stand above the bubble, outside it. A message of images only has no bubble. */}
          <Show when={person()} fallback={bubble(messageBody())}>
            <div class="message-stack">
              {messageBody((content, imagesOnly) => (
                <Show when={!imagesOnly() || (props.reactions?.length ?? 0) > 0 || extra.toArray().length > 0}>
                  {bubble(content)}
                </Show>
              ))}
            </div>
          </Show>
          <Show when={beside()}>{actionRow()}</Show>
        </div>
        <Show when={!beside()}>{actionRow()}</Show>
      </MessageContent>
    </>
  );
  // One element with or without a menu. A sent message gets its menu when the host stores it, and a
  // new element would draw its images again and blink. Without a menu, the trigger is disabled and
  // the native menu opens.
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger
        as="div"
        disabled={!props.menu}
        ref={keepNativeMenu}
        aria-keyshortcuts={props.menu ? "Shift+F10" : undefined}
        onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLElement }) => {
          if (!props.menu) return;
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left,
              clientY: bounds.top,
            }),
          );
        }}
        role="article"
        // The trigger is the row, so it draws the `Message` primitive's element itself:
        // `as={Message}` would spread Kobalte's own props onto the DOM.
        data-slot="message"
        data-align={person() ? "end" : "start"}
        aria-label={t("chat.row.label", { name: props.author.name })}
        data-author={person() ? "user" : "assistant"}
        data-chat-search-message={props["data-chat-search-message"]}
        // The trigger turns off the long-press callout. A row with no menu keeps it, as before.
        style={[authorStyle(), props.menu ? undefined : "-webkit-touch-callout: default"]
          .filter((style) => style !== undefined)
          .join("; ")}
        class={["ui-message", ...rowClass()]}
      >
        {body()}
      </ContextMenu.Trigger>
      <Show when={props.menu}>{(menu) => <ContextMenu.Portal>{menu()()}</ContextMenu.Portal>}</Show>
    </ContextMenu.Root>
  );
}
