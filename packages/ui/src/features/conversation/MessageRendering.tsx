import { fileReferenceName } from "@openbot/brand/file-reference";
import { chatPreviewKind } from "@openbot/contracts/chat-preview";
import type { AttachmentSummary, InstalledSkill, MessageReaction } from "@openbot/contracts/ipc";
import { canPreviewAttachment, MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS } from "@openbot/contracts/ipc";
import { parseSelectionInstruction } from "@openbot/contracts/selection-instruction";
import {
  AudioLines,
  type BubbleVariant,
  Button,
  ChevronRight,
  CircleDot,
  ContextMenu,
  DropdownMenu,
  Info,
  LoaderCircle,
} from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
} from "solid-js";
import type { AgentMessage, AgentProfile } from "../../data";
import { useText } from "../../text";
import { AttachmentCards, type AttachmentMediaSource } from "./AttachmentCards";
import { CodeBlock } from "./CodeBlock";
import { CodePreview } from "./CodePreview";
import { ComparisonTable } from "./ComparisonTable";
import { CheckIcon, CopyIcon, PlusIcon, ReactionIcon, ReplyIcon, StopIcon } from "./ConversationIcons";
import { createSmoothHeightResize } from "./createSmoothHeightResize";
import { DataTable, type MessageContentBlock, messageContentBlocks, reuseUnchangedBlocks } from "./DataTable";
import { messageFileReferences } from "./FileReference";
import { ImageGeneration } from "./ImageGeneration";
import { ImageGallery, ImageLightbox, type ImageLightboxOpening, isLightboxImage } from "./ImageLightbox";
import {
  MarkdownInlineText,
  MarkdownMessageText,
  type MessageImageFile,
  markdownImageName,
  messageImageFiles,
} from "./MarkdownMessageText";
import { ReplyQuote } from "./ReplyQuote";
import {
  nextStreamingReveal,
  type StreamingRevealChunk,
  StreamingRevealContext,
  sameStreamingTailOffsets,
  streamingTrailReach,
} from "./streamingReveal";

let lastContentBlocks: { body: string; streaming: boolean; blocks: MessageContentBlock[] } | undefined;

/**
 * The content blocks of a body. The bubble variant and the message body both split the same body
 * for each streamed step, so the last result is kept. Callers do not change the result.
 */
function sharedContentBlocks(body: string, streaming: boolean): MessageContentBlock[] {
  if (lastContentBlocks?.body !== body || lastContentBlocks.streaming !== streaming) {
    lastContentBlocks = { body, streaming, blocks: messageContentBlocks(body, streaming) };
  }
  return lastContentBlocks.blocks;
}

export function conversationBubbleVariant(message: AgentMessage): BubbleVariant {
  if (message.author === "you") return "secondary";
  if (message.imageGeneration || (!message.body.trim() && message.attachments?.length)) return "ghost";
  const contentBlocks = sharedContentBlocks(message.body, message.streaming === true);
  if (contentBlocks.some((block) => block.type === "table" || block.type === "comparison-table")) return "muted";
  return contentBlocks.some((block) => block.type !== "text") ? "ghost" : "muted";
}

function cssDurationMs(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = style.getPropertyValue(property).trim();
  if (!value) return fallback;
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  return value.endsWith("s") && !value.endsWith("ms") ? amount * 1000 : amount;
}

/* Read once per message: the tokens do not change while it streams, and reading computed style
   on each step forces the browser to recalculate style. */
function streamingTimings() {
  const style = getComputedStyle(document.documentElement);
  return {
    stepMs: Math.max(16, cssDurationMs(style, "--stream-gap", 40)),
    fadeMs: cssDurationMs(style, "--stream-fade", 300),
    catchUpMs: cssDurationMs(style, "--stream-catch-up", 400),
  };
}

function createStreamingBody(message: () => AgentMessage, animate?: boolean) {
  const initialMessage = untrack(message);
  const animateInitialText =
    untrack(() => initialMessage.author === "agent" && (animate ?? initialMessage.animate) === true) &&
    !prefersReducedMotion();
  let targetBody = untrack(() => initialMessage.body);
  let targetStreaming = untrack(() => initialMessage.author === "agent" && initialMessage.streaming === true);
  /* A virtual chat row can show a different message later. The reveal buffer belongs to one
     message id, so the row does not keep the text of the message it showed first. */
  let shownId = untrack(() => initialMessage.id);
  /* A plain copy of `body`, because the signal can still hold its earlier value until the
     next flush. */
  let shownBody = animateInitialText ? "" : targetBody;
  const [buffer, setBuffer] = createSignal({ id: shownId, text: shownBody });
  const [trail, setTrail] = createSignal<StreamingRevealChunk[]>([]);
  const [animateTail, setAnimateTail] = createSignal(false);
  const [smoothHeight, setSmoothHeight] = createSignal(targetStreaming || animateInitialText);
  let smoothingActive = targetStreaming || animateInitialText;
  /* A plain copy, for the same reason as `shownBody`: true when the height smoothing, tail and
     trail are all off and no timer will change them. */
  let smoothingSettled = !smoothingActive;
  let timings: ReturnType<typeof streamingTimings> | undefined;
  const timing = () => {
    timings ??= streamingTimings();
    return timings;
  };
  let revealBudget = 0;
  let revealTimer: number | undefined;
  let smoothHeightTimer: number | undefined;

  const showBody = (next: string) => {
    shownBody = next;
    setBuffer({ id: shownId, text: next });
  };
  const clearRevealTimer = () => {
    if (revealTimer === undefined) return;
    window.clearTimeout(revealTimer);
    revealTimer = undefined;
  };
  const keepHeightSmoothingActive = () => {
    if (smoothHeightTimer !== undefined) window.clearTimeout(smoothHeightTimer);
    smoothHeightTimer = undefined;
    smoothingSettled = false;
    setSmoothHeight(true);
  };
  const settleHeightSmoothing = () => {
    /* Each row that the virtual list mounts comes here. When nothing animated, there is nothing to
       settle, and reading the timing tokens would force a style recalculation per row. */
    if (smoothingSettled) return;
    if (smoothHeightTimer !== undefined) window.clearTimeout(smoothHeightTimer);
    smoothHeightTimer = window.setTimeout(
      () => {
        smoothHeightTimer = undefined;
        smoothingSettled = true;
        setSmoothHeight(false);
        setAnimateTail(false);
        setTrail([]);
      },
      Math.max(timing().stepMs * 2, timing().fadeMs),
    );
  };
  const revealStep = () => {
    const { stepMs, fadeMs, catchUpMs } = timing();
    const step = nextStreamingReveal({
      shownLength: shownBody.length,
      target: targetBody,
      streaming: targetStreaming,
      budget: revealBudget,
      stepMs,
      catchUpMs,
    });
    revealBudget = step.budget;
    if (step.length <= shownBody.length) return false;
    const now = performance.now();
    setTrail((steps) => [
      ...steps.filter((chunk) => now - chunk.revealedAt < fadeMs),
      { length: step.length - shownBody.length, revealedAt: now },
    ]);
    smoothingSettled = false;
    setAnimateTail(true);
    showBody(targetBody.slice(0, step.length));
    return true;
  };
  const scheduleReveal = () => {
    if (revealTimer !== undefined) return;
    revealTimer = window.setTimeout(() => {
      revealTimer = undefined;
      const advanced = revealStep();
      if (shownBody !== targetBody) {
        // With no step and no debt, the last word is still incomplete: the next body restarts this.
        if (advanced || revealBudget < 0) scheduleReveal();
      } else if (!targetStreaming) {
        smoothingActive = false;
        settleHeightSmoothing();
      }
    }, timing().stepMs);
  };

  createEffect(
    () => ({
      id: message().id,
      body: message().body,
      streaming: message().author === "agent" && message().streaming === true,
    }),
    ({ id, body: nextBody, streaming }) => {
      const replaced = id !== shownId;
      shownId = id;
      targetBody = nextBody;
      targetStreaming = streaming;
      if (streaming) {
        smoothingActive = true;
        keepHeightSmoothingActive();
      }
      if (replaced || prefersReducedMotion() || !nextBody.startsWith(shownBody) || (!streaming && !smoothingActive)) {
        clearRevealTimer();
        revealBudget = 0;
        setAnimateTail(false);
        setTrail([]);
        showBody(nextBody);
        smoothingActive = false;
        settleHeightSmoothing();
        return;
      }
      if (shownBody !== nextBody) {
        scheduleReveal();
      } else if (!streaming) {
        smoothingActive = false;
        settleHeightSmoothing();
      }
    },
  );
  onCleanup(() => {
    clearRevealTimer();
    if (smoothHeightTimer !== undefined) window.clearTimeout(smoothHeightTimer);
  });
  /* The effect above runs after the render. Until it does, and if a later update does not reach
     it, a buffer of another message, or one that is not the start of the body, shows the body. */
  const body = createMemo(() => {
    const current = message();
    const shown = buffer();
    return shown.id === current.id && current.body.startsWith(shown.text) ? shown.text : current.body;
  });
  const revealing = createMemo(() => message().streaming === true || body() !== message().body);
  return { animateTail, body, smoothHeight, revealing, trail };
}

/**
 * The characters of the body after each text block that the fading steps reach. The search for a
 * block starts after the previous one, and a code block can hold the same text, so an offset can
 * only be too large: that shows words without a fade instead of fading shown words again.
 */
function textBlockTailOffsets(body: string, blocks: readonly MessageContentBlock[], reach: number) {
  let cursor = 0;
  return blocks.map((block) => {
    if (block.type !== "text") return undefined;
    const start = body.indexOf(block.text, cursor);
    if (start < 0) return undefined;
    cursor = start + block.text.length;
    const after = body.length - cursor;
    return after < reach ? after : undefined;
  });
}

const comparisonTableContent = (block: MessageContentBlock) => (block.type === "comparison-table" ? block : undefined);
const dataTableContent = (block: MessageContentBlock) => (block.type === "table" ? block : undefined);
const codeContent = (block: MessageContentBlock) => (block.type === "code" ? block : undefined);
const textContent = (block: MessageContentBlock) => (block.type === "text" ? block : undefined);
const imageFileKeys = (files: readonly MessageImageFile[]) =>
  files.map((file) => `${file.kind}:${file.path}`).join("\n");

const fileImageId = (file: MessageImageFile) => `file:${file.kind}:${file.path}`;

/** A named image file in the shape of an image attachment, so the gallery and the viewer show it. */
function fileImage(file: MessageImageFile, url: string): AttachmentSummary {
  return {
    id: fileImageId(file),
    name: fileReferenceName(file.path),
    size: 0,
    kind: "image",
    mimeType: "image/*",
    previewKind: "image",
    previewUrl: url,
  };
}

export function MessageBody(props: {
  animate?: boolean | undefined;
  message: AgentMessage;
  referencedMessage?: AgentMessage | undefined;
  /**
   * Who wrote the quoted message. A chat with several authors has to name the one it quotes, and
   * an agent chat names another person the reader quotes. Absent, the quote says "You" or "Agent".
   */
  referencedAuthorName?: string | undefined;
  /** Opens the quoted message in the chat. Absent, the quote is not a control. */
  onOpenReference?: (() => void) | undefined;
  /**
   * `loading` while the chat loads the history around the original. `unavailable` when the chat did
   * not find it: a note says so. A quote stays open to a new try, because a load can fail for a
   * time. With no quote, only the note shows.
   */
  referenceState?: "loading" | "unavailable" | undefined;
  agents: AgentProfile[];
  skills?: InstalledSkill[] | undefined;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  onOpenSharedFile?: ((path: string) => void) | undefined;
  onOpenWorkspaceFile?: ((path: string) => void) | undefined;
  /** Opens the passage that a quote in the message points to. */
  onOpenQuote?: ((messageId: string, text: string) => void) | undefined;
  onDownload?: ((attachment: AttachmentSummary) => void) | undefined;
  mediaSource?: AttachmentMediaSource | undefined;
  /**
   * Reads an image file that an agent message names, for a preview under the text. Resolves the
   * image as a `data:` URL, or `null` when it cannot show. Absent, a named file is only a chip.
   */
  loadImageFile?: ((file: MessageImageFile) => Promise<string | null>) | undefined;
  /** Downloads an image file that an agent message names. Absent, its preview has no download. */
  onDownloadImageFile?: ((file: MessageImageFile) => void) | undefined;
  /** The window draws the macOS window controls over the top start corner. The image viewer leaves room. */
  macWindowControls?: boolean | undefined;
}) {
  const { t } = useText();
  const streamingBody = createStreamingBody(
    () => props.message,
    untrack(() => props.animate),
  );
  const streamedBody = streamingBody.body;
  const referenceOpens = () => Boolean(props.onOpenReference);
  const referenceTextId = `message-reply-${createUniqueId()}`;
  const selectionInstruction = createMemo(() =>
    props.message.author === "you" && props.message.replyToMessageId
      ? parseSelectionInstruction(props.message.body)
      : null,
  );
  /* A finished image with no `previewUrl` (the web client) shows as a file card instead. */
  const generatedImageShown = createMemo(() => {
    if (!props.message.imageGeneration) return false;
    const attachment = props.message.attachments?.[0];
    return (
      !attachment ||
      Boolean(attachment.previewUrl) ||
      imageGenerationStatus(props.message.streaming, props.message.status) !== "completed"
    );
  });
  const referencedAttachmentIds = createMemo(
    () =>
      new Set(
        messageFileReferences(props.message.body, props.message.attachments ?? [])
          .filter((reference) => reference.kind === "attachment")
          .map((reference) => reference.attachment.id),
      ),
  );
  const standaloneAttachments = createMemo(() => {
    const referencedIds = referencedAttachmentIds();
    const generatedAttachmentId = generatedImageShown() ? props.message.attachments?.[0]?.id : undefined;
    return (props.message.attachments ?? []).filter(
      (attachment) => !referencedIds.has(attachment.id) && attachment.id !== generatedAttachmentId,
    );
  });
  /* The image files that a finished agent message names show under it like attached images. A
     file that the message also attaches shows once, as the attachment. An attachment that the text
     names by path does not show on its own, so its image shows here. */
  const namedImageFiles = createMemo(
    () => {
      if (props.message.author !== "agent" || props.message.streaming || !props.loadImageFile) return [];
      const referencedIds = referencedAttachmentIds();
      const attached = new Set(
        (props.message.attachments ?? [])
          .filter((attachment) => !referencedIds.has(attachment.id))
          .map((attachment) => attachment.name),
      );
      const texts = messageContentBlocks(props.message.body, false).flatMap((block) =>
        block.type === "text" ? [block.text] : [],
      );
      return messageImageFiles(texts).filter((file) => !attached.has(fileReferenceName(file.path)));
    },
    { equals: (previous, next) => imageFileKeys(previous) === imageFileKeys(next) },
  );
  const [fileImages, setFileImages] = createSignal<AttachmentSummary[]>([]);
  createEffect(
    () => ({ files: namedImageFiles(), load: untrack(() => props.loadImageFile) }),
    ({ files, load }) => {
      let current = true;
      if (!load || files.length === 0) {
        setFileImages([]);
        return;
      }
      void Promise.all(
        files.map((file) =>
          load(file).then(
            (url) => (url ? fileImage(file, url) : null),
            () => null,
          ),
        ),
      ).then((images) => {
        if (current) setFileImages(images.filter((image) => image !== null));
      });
      return () => {
        current = false;
      };
    },
  );
  const standaloneImageAttachments = createMemo(() =>
    props.message.author === "agent" ? standaloneAttachments().filter(isLightboxImage) : [],
  );
  const standaloneFileAttachments = createMemo(() =>
    props.message.author === "agent"
      ? standaloneAttachments().filter((attachment) => !isLightboxImage(attachment))
      : standaloneAttachments(),
  );
  const contentBlocks = createMemo<MessageContentBlock[]>((previous) =>
    reuseUnchangedBlocks(
      previous ?? [],
      props.message.author === "agent"
        ? sharedContentBlocks(streamedBody(), streamingBody.revealing())
        : [{ type: "text", text: selectionInstruction()?.instruction ?? props.message.body }],
    ),
  );
  const textTailAfter = createMemo(
    () =>
      streamingBody.animateTail()
        ? textBlockTailOffsets(streamedBody(), contentBlocks(), streamingTrailReach(streamingBody.trail()))
        : [],
    { equals: sameStreamingTailOffsets },
  );
  const lastTextBlockIndex = createMemo(() => {
    const blocks = contentBlocks();
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index]?.type === "text") return index;
    }
    return -1;
  });
  let messageContentResize: HTMLDivElement | undefined;
  let messageContent: HTMLDivElement | undefined;
  createSmoothHeightResize({
    container: () => messageContentResize,
    content: () => messageContent,
    enabled: () => props.message.author === "agent" && streamingBody.smoothHeight(),
  });
  /* A named image file downloads by its path. A markdown image is a web address, so it has no download. */
  const namedImageFile = (image: AttachmentSummary) => namedImageFiles().find((file) => fileImageId(file) === image.id);
  const downloadImage = (image: AttachmentSummary) => {
    const file = namedImageFile(image);
    if (file) props.onDownloadImageFile?.(file);
    else props.onDownload?.(image);
  };
  const [lightbox, setLightbox] = createSignal<(ImageLightboxOpening & { markdown?: boolean }) | null>(null);
  const lightboxImages = createMemo(() => (props.message.attachments ?? []).filter(isLightboxImage));
  /* An image opens in the viewer with the other images of its message. A quoted message's image
     is not one of them, so it opens alone. Other files open in the preview panel. */
  const openAttachment = (attachment: AttachmentSummary, origin?: HTMLElement) => {
    if (isLightboxImage(attachment)) {
      const named = fileImages().some((image) => image.id === attachment.id);
      const siblings = named ? fileImages() : lightboxImages();
      const images = siblings.some((image) => image.id === attachment.id) ? siblings : [attachment];
      setLightbox({
        images,
        index: images.findIndex((image) => image.id === attachment.id),
        origin,
        markdown: named,
      });
    } else if (canPreviewAttachment(attachment)) {
      props.onPreview(attachment);
    } else {
      props.onAttachmentAction(attachment, "open");
    }
  };
  /* A markdown image opens with the other markdown images of its message, in the order they show. */
  let markdownImages = new Map<string, HTMLElement>();
  const openMarkdownImage = (origin: HTMLImageElement) => {
    const pictures = [
      ...(messageContent?.querySelectorAll<HTMLImageElement>(".message-markdown-image-button img") ?? []),
    ];
    markdownImages = new Map();
    const images = pictures.map((picture, position): AttachmentSummary => {
      const id = `markdown-image:${position}`;
      if (picture.parentElement) markdownImages.set(id, picture.parentElement);
      return {
        id,
        name: markdownImageName(picture.alt, picture.src),
        size: 0,
        kind: "image",
        mimeType: "image/*",
        previewKind: "image",
        previewUrl: picture.src,
      };
    });
    const index = pictures.indexOf(origin);
    if (index < 0) return;
    setLightbox({ images, index, origin: origin.parentElement ?? undefined, markdown: true });
  };
  /* The images, the cards and the text blocks of one message share this parent. */
  const imageThumbnail = (attachment: AttachmentSummary) =>
    markdownImages.get(attachment.id) ??
    messageContentResize?.parentElement?.querySelector<HTMLElement>(
      `[data-attachment-id="${CSS.escape(attachment.id)}"]`,
    ) ??
    undefined;
  const renderMarkdownInline = (body: string) => (
    <MarkdownInlineText
      body={body}
      agents={props.agents}
      skills={props.skills}
      attachments={props.message.attachments}
      citations={props.message.citations}
      onSelectAgent={props.onSelectAgent}
      onOpenLink={props.onOpenLink}
      onOpenAttachment={openAttachment}
      onOpenImage={openMarkdownImage}
      onOpenSharedFile={props.onOpenSharedFile}
      onOpenWorkspaceFile={props.onOpenWorkspaceFile}
      onOpenQuote={props.onOpenQuote}
    />
  );

  return (
    <>
      {/*
       * The generic delivery labels - Queued, Cancelled, Failed, Stopped - were taken off the
       * bubble on purpose. This one stays, because an error bubble carries no other sign of what
       * the user did: without it, "Provider is offline." reads as a sentence the agent said.
       */}
      <Show when={props.message.kind === "error" && props.message.status}>
        {(status) => <p class="message-error-label">{status()}</p>}
      </Show>
      <Show when={props.referencedMessage}>
        {(referenced) => (
          <div
            class="message-reply-context"
            data-opens={referenceOpens() ? "" : undefined}
            data-loading={props.referenceState === "loading" ? "" : undefined}
            data-unavailable={props.referenceState === "unavailable" ? "" : undefined}
          >
            {/*
             * The button lies over the quote, not around it: the quote can hold links and mentions,
             * and a button cannot hold a control. The quote under it is inert, so a click and the
             * Tab key both reach the button only.
             */}
            <Show when={referenceOpens()}>
              <Button
                variant="ghost"
                type="button"
                class="message-reply-open"
                aria-label={t("chat.reply.showOriginal")}
                aria-describedby={referenceTextId}
                aria-busy={props.referenceState === "loading" ? "true" : undefined}
                data-cuelume-tap="navigate"
                onClick={() => props.onOpenReference?.()}
              />
            </Show>
            <span inert={referenceOpens() ? true : undefined}>
              {props.referencedAuthorName ??
                (referenced().author === "you" ? t("chat.message.you") : t("chat.message.agentFallback"))}
            </span>
            <ReplyQuote
              id={referenceTextId}
              body={referenced().body || t("chat.message.attachment")}
              agents={props.agents}
              skills={props.skills}
              attachments={referenced().attachments}
              citations={referenced().citations}
            />
            <Show when={props.referenceState === "loading"}>
              <LoaderCircle class="message-reply-loading" aria-hidden="true" />
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.referenceState === "unavailable"}>
        {/* Only a jump that failed changes the note while the row shows. A row that mounts again must not repeat it. */}
        <p class="message-reply-unavailable" role={props.referencedMessage ? "status" : undefined}>
          <Info class="message-reply-unavailable-icon" aria-hidden="true" />
          {t("chat.reply.originalUnavailable")}
        </p>
      </Show>
      <div class="message-content-resize" ref={(element) => (messageContentResize = element)}>
        <div class="message-content-blocks" ref={(element) => (messageContent = element)}>
          <StreamingRevealContext value={streamingBody.trail}>
            <Show when={props.message.author === "agent" ? streamedBody() : props.message.body}>
              {/* Unkeyed, so a growing reply keeps each block mounted and updates only the block that grew. */}
              <For each={contentBlocks()} keyed={false}>
                {(block, index) => (
                  <Switch>
                    <Match when={comparisonTableContent(block())}>
                      {(table) => <ComparisonTable table={table()} renderCell={renderMarkdownInline} />}
                    </Match>
                    <Match when={dataTableContent(block())}>
                      {(table) => <DataTable table={table()} renderCell={renderMarkdownInline} />}
                    </Match>
                    <Match when={codeContent(block())}>
                      {(code) => (
                        // The id lets the selection actions open for text selected in the code.
                        <div
                          data-selection-message-id={props.message.streaming !== true ? props.message.id : undefined}
                        >
                          <Show
                            when={chatPreviewKind(code().language)}
                            fallback={
                              <CodeBlock
                                block={code()}
                                streaming={streamingBody.revealing() && index === contentBlocks().length - 1}
                              />
                            }
                          >
                            {(preview) => (
                              <CodePreview
                                block={code()}
                                kind={preview()}
                                streaming={streamingBody.revealing() && index === contentBlocks().length - 1}
                                onOpenLink={props.onOpenLink}
                              />
                            )}
                          </Show>
                        </div>
                      )}
                    </Match>
                    <Match when={textContent(block())}>
                      {(text) => (
                        <div
                          class={`message-copy message-markdown${streamingBody.animateTail() ? " t-stream" : ""}`}
                          data-selection-message-id={props.message.streaming !== true ? props.message.id : undefined}
                        >
                          <MarkdownMessageText
                            body={text().text}
                            agents={props.agents}
                            skills={props.skills}
                            attachments={props.message.attachments}
                            citations={props.message.citations}
                            onSelectAgent={props.onSelectAgent}
                            onOpenLink={props.onOpenLink}
                            onOpenAttachment={openAttachment}
                            onOpenImage={openMarkdownImage}
                            onOpenSharedFile={props.onOpenSharedFile}
                            onOpenWorkspaceFile={props.onOpenWorkspaceFile}
                            onOpenQuote={props.onOpenQuote}
                            showCitationFooter={index === lastTextBlockIndex()}
                            streaming={streamingBody.revealing() && index === contentBlocks().length - 1}
                            streamingTailAfter={textTailAfter()[index]}
                          />
                        </div>
                      )}
                    </Match>
                  </Switch>
                )}
              </For>
              <Show when={selectionInstruction()}>
                {(selection) => <blockquote class="message-selection-quote">{selection().quote}</blockquote>}
              </Show>
            </Show>
          </StreamingRevealContext>
        </div>
      </div>
      <Show when={generatedImageShown() && props.message.imageGeneration}>
        {(imageGeneration) => (
          <ImageGeneration
            status={imageGenerationStatus(props.message.streaming, props.message.status)}
            prompt={imageGeneration().prompt}
            resolution={imageGeneration().resolution}
            aspectRatio={imageGeneration().aspectRatio}
            attachment={props.message.attachments?.[0]}
            error={imageGeneration().error}
            onPreview={openAttachment}
            onDownload={props.onDownload}
          />
        )}
      </Show>
      <Switch>
        <Match when={standaloneImageAttachments().length > 1}>
          <ImageGallery images={standaloneImageAttachments()} onOpen={openAttachment} onDownload={props.onDownload} />
        </Match>
        <Match when={standaloneImageAttachments().length === 1}>
          <div class="message-image-attachments">
            <For each={standaloneImageAttachments()}>
              {(attachment) => (
                <ImageGeneration
                  presentation="attachment"
                  status="completed"
                  prompt={attachment.name}
                  aspectRatio="square"
                  attachment={attachment}
                  onPreview={openAttachment}
                  onDownload={props.onDownload}
                />
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <Switch>
        <Match when={fileImages().length > 1}>
          <ImageGallery images={fileImages()} onOpen={openAttachment} />
        </Match>
        <Match when={fileImages()[0]}>
          {(image) => (
            <div class="message-image-attachments">
              <ImageGeneration
                presentation="attachment"
                status="completed"
                prompt={image().name}
                aspectRatio="square"
                attachment={image()}
                onPreview={openAttachment}
                onDownload={props.onDownloadImageFile ? downloadImage : undefined}
              />
            </div>
          )}
        </Match>
      </Switch>
      <Show when={standaloneFileAttachments().length > 0}>
        <div class="message-attachments-group">
          <AttachmentCards
            attachments={standaloneFileAttachments()}
            mediaSource={props.mediaSource}
            onPreview={openAttachment}
            onAction={props.onAttachmentAction}
          />
        </div>
      </Show>
      <Show when={lightbox()}>
        {(opening) => (
          <ImageLightbox
            opening={opening()}
            thumbnail={imageThumbnail}
            onDownload={downloadImage}
            canDownload={(image) =>
              namedImageFile(image)
                ? Boolean(props.onDownloadImageFile)
                : !opening().markdown && Boolean(props.onDownload)
            }
            macWindowControls={props.macWindowControls}
            onClose={() => setLightbox(null)}
          />
        )}
      </Show>
    </>
  );
}

function imageGenerationStatus(
  streaming: boolean | undefined,
  status: string | undefined,
): "generating" | "completed" | "failed" | "interrupted" {
  if (streaming || status === "streaming") return "generating";
  if (status === "Failed" || status === "failed") return "failed";
  if (status === "Stopped" || status === "interrupted") return "interrupted";
  return "completed";
}

export function MessageActions(props: {
  message: AgentMessage;
  /** Names the toolbar for a screen reader. A channel has more authors than "Agent". */
  authorName?: string | undefined;
  /**
   * Whether the reaction button stands in the toolbar. A channel message has no owner to hold a
   * reaction yet, so the chats share one toolbar and the channel leaves that button out.
   */
  reactions?: boolean;
  pickerOpen: boolean;
  expandedEmoji: boolean;
  copied: boolean;
  onTogglePicker: () => void;
  onExpandEmoji: () => void;
  onReact: (emoji: MessageReaction | null) => void;
  onReply?: (() => void) | undefined;
  onCopy: () => void;
  /** Reads the message aloud, or stops it while it is read. Absent where replies cannot be read aloud. */
  readAloud?: { reading: boolean; onToggle: () => void } | undefined;
}) {
  const { t } = useText();
  const authorName = () => props.authorName ?? t("chat.message.agentFallback");
  return (
    <div
      class={["message-actions", { "message-actions-open": props.pickerOpen }]}
      role="toolbar"
      aria-label={
        props.message.author === "you" ? t("chat.actions.userLabel") : t("chat.actions.label", { name: authorName() })
      }
    >
      <Button
        variant="ghost"
        type="button"
        class="message-action-button"
        aria-label={props.copied ? t("common.copied") : t("common.copy")}
        onClick={props.onCopy}
      >
        {props.copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Show when={props.readAloud}>
        {(readAloud) => (
          <Button
            variant="ghost"
            type="button"
            class="message-action-button"
            aria-label={readAloud().reading ? t("chat.actions.stopReading") : t("chat.actions.readAloud")}
            onClick={() => readAloud().onToggle()}
          >
            {readAloud().reading ? <StopIcon /> : <AudioLines aria-hidden="true" />}
          </Button>
        )}
      </Show>
      <Show when={props.reactions !== false}>
        <div class="message-action-popover-anchor">
          <DropdownMenu.Root
            open={props.pickerOpen}
            onOpenChange={props.onTogglePicker}
            placement="bottom-start"
            gutter={6}
            modal={false}
          >
            <DropdownMenu.Trigger class="message-action-button" aria-label={t("chat.actions.addReaction")}>
              <ReactionIcon />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              class="reaction-picker"
              data-menu-layout="grid"
              aria-label={t("chat.actions.chooseReaction")}
              aria-hidden={props.pickerOpen ? undefined : "true"}
            >
              <div class="reaction-picker-row">
                <DropdownMenu.RadioGroup class="reaction-picker-options" value={props.message.reaction ?? ""}>
                  <For each={MESSAGE_REACTIONS}>
                    {(emoji) => (
                      <DropdownMenu.RadioItem
                        value={emoji}
                        aria-label={t("chat.actions.react", { emoji })}
                        onSelect={() => props.onReact(props.message.reaction === emoji ? null : emoji)}
                      >
                        {emoji}
                      </DropdownMenu.RadioItem>
                    )}
                  </For>
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Item
                  class="reaction-more-button"
                  aria-label={t("chat.actions.moreEmoji")}
                  closeOnSelect={false}
                  onSelect={props.onExpandEmoji}
                >
                  <PlusIcon />
                </DropdownMenu.Item>
              </div>
              <Show when={props.expandedEmoji}>
                <div class="reaction-picker-row reaction-picker-more">
                  <DropdownMenu.RadioGroup class="reaction-picker-options" value={props.message.reaction ?? ""}>
                    <For each={MORE_MESSAGE_REACTIONS}>
                      {(emoji) => (
                        <DropdownMenu.RadioItem
                          value={emoji}
                          aria-label={t("chat.actions.react", { emoji })}
                          onSelect={() => props.onReact(props.message.reaction === emoji ? null : emoji)}
                        >
                          {emoji}
                        </DropdownMenu.RadioItem>
                      )}
                    </For>
                  </DropdownMenu.RadioGroup>
                </div>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </Show>
      <Show when={props.onReply}>
        <Button
          variant="ghost"
          type="button"
          class="message-action-button"
          aria-label={
            props.message.author === "you"
              ? t("chat.actions.replyUser")
              : t("chat.actions.reply", { name: authorName() })
          }
          onClick={props.onReply}
        >
          <ReplyIcon />
        </Button>
      </Show>
    </div>
  );
}

/**
 * The right-click menu of a message, for `ChatMessageRow`'s `menu` slot. It holds the actions of
 * `MessageActions` with text labels; React opens a submenu with every reaction.
 */
export function MessageMenu(props: {
  message: AgentMessage;
  /** Names the menu for a screen reader. A channel has more authors than "Agent". */
  authorName?: string | undefined;
  /** Whether React stands in the menu. A channel message has no owner to hold a reaction yet. */
  reactions?: boolean;
  onReact: (emoji: MessageReaction | null) => void;
  onReply?: (() => void) | undefined;
  onCopy: () => void;
  readAloud?: { reading: boolean; onToggle: () => void } | undefined;
  /** Marks this message and the messages after it unread. Without it, the menu has no such item. */
  onMarkUnread?: (() => void) | undefined;
}) {
  const { t } = useText();
  const authorName = () => props.authorName ?? t("chat.message.agentFallback");
  const react = (emoji: MessageReaction) => props.onReact(props.message.reaction === emoji ? null : emoji);
  return (
    <ContextMenu.Content
      aria-label={
        props.message.author === "you" ? t("chat.actions.userLabel") : t("chat.actions.label", { name: authorName() })
      }
    >
      <Show when={props.onReply}>
        {(onReply) => (
          <ContextMenu.Item onSelectAfterClose={onReply()}>
            <ReplyIcon />
            <span>{t("chat.menu.reply")}</span>
          </ContextMenu.Item>
        )}
      </Show>
      <ContextMenu.Item onSelect={props.onCopy}>
        <CopyIcon />
        <span>{t("chat.menu.copy")}</span>
      </ContextMenu.Item>
      <Show when={props.reactions !== false}>
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>
            <ReactionIcon />
            <span>{t("chat.menu.react")}</span>
            <ChevronRight class="ui-menu-trailing" aria-hidden="true" />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              class="ui-action-menu reaction-picker"
              data-menu-layout="grid"
              aria-label={t("chat.actions.chooseReaction")}
            >
              <For each={[MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS]}>
                {(row, index) => (
                  <div class={["reaction-picker-row", { "reaction-picker-more": index() > 0 }]}>
                    <ContextMenu.RadioGroup class="reaction-picker-options" value={props.message.reaction ?? ""}>
                      <For each={row}>
                        {(emoji) => (
                          <ContextMenu.RadioItem
                            value={emoji}
                            closeOnSelect
                            aria-label={t("chat.actions.react", { emoji })}
                            onSelect={() => react(emoji)}
                          >
                            {emoji}
                          </ContextMenu.RadioItem>
                        )}
                      </For>
                    </ContextMenu.RadioGroup>
                  </div>
                )}
              </For>
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      </Show>
      <Show when={props.readAloud}>
        {(readAloud) => (
          <ContextMenu.Item onSelect={() => readAloud().onToggle()}>
            {readAloud().reading ? <StopIcon /> : <AudioLines aria-hidden="true" />}
            <span>{readAloud().reading ? t("chat.actions.stopReading") : t("chat.actions.readAloud")}</span>
          </ContextMenu.Item>
        )}
      </Show>
      <Show when={props.onMarkUnread}>
        {(onMarkUnread) => (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={onMarkUnread()}>
              <CircleDot aria-hidden="true" />
              <span>{t("chat.menu.markUnread")}</span>
            </ContextMenu.Item>
          </>
        )}
      </Show>
    </ContextMenu.Content>
  );
}
