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
  Pin,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { children, createMemo, For, Show } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import type { AgentMessage, AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { AttachmentDownloads, AttachmentMediaSource } from "./AttachmentCards";
import { chatBubbleColor, useBackdropBubbles } from "./BackdropBubbles";
import type { ImageCopies } from "./ImageLightbox";
import type { MessageImageFile } from "./MarkdownMessageText";
import { conversationBubbleVariant, MessageBody } from "./MessageRendering";
import { solidBubbleTakesDarkText } from "./own-bubble";

export interface ChatMessageAuthor {
  kind: "you" | "agent" | "member";
  name: string;
  agent?: AgentProfile | undefined;
  avatarSeed?: string | undefined;
  chatColor?: AvatarColor | undefined;
  solidBubble?: boolean | undefined;
}

export interface ChatMessageRowProps {
  message: AgentMessage;
  author: ChatMessageAuthor;
  showAuthor?: boolean | undefined;
  showTime?: boolean | undefined;
  showFull?: boolean | undefined;
  open?: boolean | undefined;
  animate?: boolean;
  textAtOnce?: boolean | undefined;
  agents: AgentProfile[];
  skills?: InstalledSkill[] | undefined;
  referencedMessage?: AgentMessage | undefined;
  referencedAuthorName?: string | undefined;
  onOpenReference?: (() => void) | undefined;
  referenceState?: "loading" | "unavailable" | undefined;
  pinned?: boolean | undefined;
  reactions?: readonly ConversationReaction[] | undefined;
  reactionOverflowCount?: number | undefined;
  onRemoveReaction?: (() => void) | undefined;
  actions?: JSX.Element;
  menu?: (() => JSX.Element) | undefined;
  children?: JSX.Element;
  steps?: JSX.Element;
  actionsBeside?: boolean | undefined;
  actionRow?: boolean | undefined;
  actionTime?: boolean | undefined;
  class?: string | undefined;
  "data-chat-search-message"?: string | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  onOpenSharedFile?: ((path: string, asWritten?: string) => void) | undefined;
  onOpenWorkspaceFile?: ((path: string, asWritten?: string) => void) | undefined;
  onOpenQuote?: ((messageId: string, text: string) => void) | undefined;
  onOpenTag?: ((kind: "tab" | "thread", id: string) => void) | undefined;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
  mediaSource?: AttachmentMediaSource | undefined;
  imageCopies?: ImageCopies | undefined;
  downloads?: AttachmentDownloads | undefined;
  loadImageFile?: ((file: MessageImageFile) => Promise<string | null>) | undefined;
  onDownloadImageFile?: ((file: MessageImageFile) => void) | undefined;
  macWindowControls?: boolean | undefined;
  remoteContent?: boolean | undefined;
}

export function ChatMessageRow(props: ChatMessageRowProps): JSX.Element {
  const { t } = useText();
  const own = () => props.author.kind === "you";
  const member = () => props.author.kind === "member";
  const person = () => own() || member();
  const variant = createMemo(() => conversationBubbleVariant(props.message));
  const seed = () => props.author.agent?.avatarSeed ?? props.author.avatarSeed;
  const backdropBubbles = useBackdropBubbles();
  const chatColor = () => chatBubbleColor(backdropBubbles(), props.author);
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
  const solidColor = () => {
    const tint = chatColor();
    return own() && props.author.solidBubble === true ? tint : undefined;
  };
  const bubbleClass = () => {
    const solid = solidColor();
    return {
      "message-bubble-member": member(),
      "message-bubble-colored": chatColor() !== undefined,
      "message-bubble-solid": solid !== undefined,
      "message-bubble-solid-dark-text": solid !== undefined && solidBubbleTakesDarkText(solid),
    };
  };
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
        const target = event.target instanceof Element ? event.target : null;
        const link = Boolean(target?.closest("a[href]"));
        const image =
          target instanceof HTMLImageElement &&
          target.complete &&
          target.naturalWidth > 0 &&
          target.closest(".message-author-avatar, [aria-hidden='true']") === null;
        if (event.shiftKey || link || image || selected) event.stopPropagation();
      },
      { capture: true },
    );
  };
  const extra = children(() => props.children);
  const steps = children(() => props.steps);
  const messageBody = (frame?: (content: JSX.Element, imagesOnly: () => boolean) => JSX.Element) => (
    <MessageBody
      frame={frame}
      showFull={props.showFull}
      open={props.open}
      animate={props.animate === true && props.textAtOnce !== true}
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
      imageCopies={props.imageCopies}
      downloads={props.downloads}
      loadImageFile={props.loadImageFile}
      onDownloadImageFile={props.onDownloadImageFile}
      macWindowControls={props.macWindowControls}
      remoteContent={props.remoteContent}
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
  const beside = () => props.actionsBeside === true && !member();
  const pinnedMark = (): JSX.Element => (
    <Show when={props.pinned}>
      <span class="message-pinned">
        <Pin aria-hidden="true" />
        {t("chat.row.pinned")}
      </span>
    </Show>
  );
  const actionRow = (): JSX.Element => (
    <div class="message-action-row">
      {props.actions}
      <Show when={props.actionTime !== false && (!props.showAuthor || own())}>
        <time class="message-time" datetime={props.message.createdAt}>
          {props.message.time}
        </time>
      </Show>
      {pinnedMark()}
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
          <Show when={person()} fallback={bubble(messageBody())}>
            <div class="message-stack">
              {messageBody((content, imagesOnly) => (
                <Show when={!imagesOnly() || (props.reactions?.length ?? 0) > 0 || extra.toArray().length > 0}>
                  {bubble(content)}
                </Show>
              ))}
            </div>
          </Show>
          <Show when={props.actionRow !== false && beside()}>{actionRow()}</Show>
        </div>
        <Show when={props.actionRow !== false && !beside()}>{actionRow()}</Show>
        <Show when={props.actionRow === false}>{pinnedMark()}</Show>
      </MessageContent>
    </>
  );
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
        data-slot="message"
        data-align={person() ? "end" : "start"}
        aria-label={t("chat.row.label", { name: props.author.name })}
        data-author={person() ? "user" : "assistant"}
        data-chat-search-message={props["data-chat-search-message"]}
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
