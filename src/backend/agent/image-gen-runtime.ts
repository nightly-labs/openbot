import type { AttachmentSummary, ImageGenerationInfo, VideoGenerationInfo } from "@openbot/contracts/ipc";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Result, Schema, Scope } from "effect";
import { newAssistantMessage } from "../conversation-snapshots";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import { getString, type ThreadItem } from "../protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import { lastUserPrompt } from "./delivery-content";
import {
  decodeGeneratedImage,
  type GeneratedMediaKind,
  generatedImageName,
  generatedMediaInfo,
  generatedMediaKind,
  generatedVideoName,
  generationInterruptedText,
  imageGenerationAspectRatio,
  imageGenerationFailure,
} from "./image-generation";

interface ImageGenerationOperation {
  interrupted: boolean;
  fiber: Fiber.Fiber<void, GeneratedImageFailed> | null;
}

export interface ImageGenHooks {
  /** Mirrors the facade's itemId → turnId index used by turn completion. */
  trackItem(itemId: string, turnId: string): void;
}

export interface ImageGenRuntimeOptions {
  conversation: ConversationRuntime;
  mailbox: MailboxStore;
  hooks: ImageGenHooks;
}

/**
 * Streaming image-generation and video-generation items, and the interrupt flag that races them.
 *
 * Owns the `threadId:turnId:itemId` operation map plus the `threadId:turnId`
 * interrupted set. Everything else (snapshots, attachments, events) goes
 * through the injected conversation/mailbox, so this class never imports the
 * facade. The facade keeps `#itemTurns` — it is shared with plain agent
 * messages and deltas — and only receives updates via `trackItem`.
 */
export class ImageGenRuntime {
  readonly #conversation: ConversationRuntime;
  readonly #mailbox: MailboxStore;
  readonly #hooks: ImageGenHooks;
  #scope = Scope.makeUnsafe();
  readonly #operations = new Map<string, ImageGenerationOperation>();
  readonly #interruptedTurns = new Set<string>();

  constructor(options: ImageGenRuntimeOptions) {
    this.#conversation = options.conversation;
    this.#mailbox = options.mailbox;
    this.#hooks = options.hooks;
  }

  /**
   * Handles one streaming item when it is an image-generation or a video-generation item.
   * Returns true when handled, so the caller can fall through for the rest.
   */
  readonly handleItem = Effect.fn("ImageGenRuntime.handleItem")(function* (
    this: ImageGenRuntime,
    agentId: string,
    threadId: string,
    turnId: string,
    item: ThreadItem,
    completed: boolean,
  ) {
    const kind = generatedMediaKind(item);
    if (!kind) return false;
    const operationKey = `${threadId}:${turnId}:${item.id}`;
    const state = this.#operations.get(operationKey) ?? {
      interrupted: this.#interruptedTurns.has(`${threadId}:${turnId}`),
      fiber: null,
    };
    state.interrupted ||= this.#interruptedTurns.has(`${threadId}:${turnId}`);
    this.#operations.set(operationKey, state);
    state.fiber = yield* this.#applyItem(agentId, threadId, turnId, kind, item, completed, state).pipe(
      Effect.forkIn(this.#scope, { startImmediately: true }),
    );
    return true;
  }).bind(this);

  interrupt(agentId: string, threadId: string, turnId: string): void {
    this.#interruptedTurns.add(`${threadId}:${turnId}`);
    for (const [key, operation] of this.#operations) {
      if (!key.startsWith(`${threadId}:${turnId}:`)) continue;
      operation.interrupted = true;
    }
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    let changed = false;
    for (const message of snapshot.messages) {
      const media = generatedMediaInfo(message);
      if (
        message.turnId !== turnId ||
        !media ||
        message.status === "completed" ||
        message.status === "failed" ||
        message.status === "interrupted"
      ) {
        continue;
      }
      message.status = "interrupted";
      media.info.error ??= generationInterruptedText(media.kind);
      changed = true;
    }
    if (changed) this.#conversation.emitConversation(snapshot, "image-generation.interrupted", { turnId });
  }

  readonly waitForOperations = Effect.fn("ImageGenRuntime.waitForOperations")(function* (
    this: ImageGenRuntime,
    threadId: string,
    turnId: string,
  ) {
    const entries = [...this.#operations.entries()].filter(([key]) => key.startsWith(`${threadId}:${turnId}:`));
    const operations = entries
      .map(([, operation]) => operation.fiber)
      .filter((fiber): fiber is Fiber.Fiber<void, GeneratedImageFailed> => fiber !== null);
    yield* Effect.forEach(operations, (operation) => Fiber.join(operation).pipe(Effect.ignore), {
      concurrency: "unbounded",
      discard: true,
    });
    for (const [key] of entries) this.#operations.delete(key);
    this.#interruptedTurns.delete(`${threadId}:${turnId}`);
  }, Effect.uninterruptible).bind(this);

  /** Work the facade awaits during stop() before clearing. */
  pendingOperations(): Effect.Effect<void, GeneratedImageFailed>[] {
    return [...this.#operations.values()]
      .map((operation) => operation.fiber)
      .filter((fiber): fiber is Fiber.Fiber<void, GeneratedImageFailed> => fiber !== null)
      .map(Fiber.join);
  }

  readonly dispose = Effect.fn("ImageGenRuntime.dispose")(function* (this: ImageGenRuntime) {
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
    this.#operations.clear();
    this.#interruptedTurns.clear();
  }).bind(this);

  readonly #applyItem = Effect.fn("ImageGenRuntime.applyItem")(function* (
    this: ImageGenRuntime,
    agentId: string,
    threadId: string,
    turnId: string,
    kind: GeneratedMediaKind,
    item: ThreadItem,
    completed: boolean,
    operation: ImageGenerationOperation,
  ) {
    if (!isString(item.id)) return;
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    let message = snapshot.messages.find((candidate) => candidate.id === item.id);
    if (!message) {
      message = newAssistantMessage(item.id, turnId);
      snapshot.messages.push(message);
    }

    const previous =
      generatedMediaInfo(message)?.kind === kind ? (message.imageGeneration ?? message.videoGeneration) : undefined;
    const prompt =
      getString(item, "revised_prompt") ??
      getString(item, "prompt") ??
      previous?.prompt ??
      lastUserPrompt(snapshot) ??
      undefined;
    // A video model makes a wide clip unless the call asks for another frame.
    const aspectRatio =
      imageGenerationAspectRatio(item) ?? previous?.aspectRatio ?? (kind === "video" ? "landscape" : "square");
    const providerStatus = getString(item, "status");
    const failure = imageGenerationFailure(item);

    message.text = "";
    let info: { error?: string | undefined };
    if (kind === "video") {
      const resolution = getString(item, "resolution") ?? message.videoGeneration?.resolution;
      const duration =
        isNumber(item.duration) && item.duration > 0 ? item.duration : message.videoGeneration?.durationSeconds;
      message.itemType = "video_generation";
      delete message.imageGeneration;
      const video: VideoGenerationInfo = {
        ...(prompt === undefined ? {} : { prompt }),
        aspectRatio,
        ...(duration === undefined ? {} : { durationSeconds: duration }),
        ...(resolution === undefined ? {} : { resolution }),
        ...(failure ? { error: failure } : {}),
      };
      message.videoGeneration = video;
      info = video;
    } else {
      const resolution =
        getString(item, "resolution") ??
        getString(item, "size") ??
        message.imageGeneration?.resolution ??
        "1024 × 1024";
      message.itemType = "image_generation";
      delete message.videoGeneration;
      const image: ImageGenerationInfo = {
        ...(prompt === undefined ? {} : { prompt }),
        resolution,
        aspectRatio,
        ...(failure ? { error: failure } : {}),
      };
      message.imageGeneration = image;
      info = image;
    }
    const failedText =
      kind === "video" ? sourceText("error.backend.videoGenerationFailed") : "Image generation failed.";
    message.status = operation.interrupted ? "interrupted" : completed ? "completed" : "streaming";
    if (operation.interrupted) info.error ??= generationInterruptedText(kind);
    this.#hooks.trackItem(item.id, turnId);
    this.#conversation.emitConversation(snapshot);

    if (!completed || operation.interrupted) {
      return;
    }
    if (providerStatus === "failed" || failure) {
      message.status = "failed";
      info.error = failure ?? failedText;
      this.#conversation.emitConversation(snapshot);
      return;
    }

    const savedPath = getString(item, "saved_path");
    // Only an image comes as data. A video always comes as a file.
    const result = kind === "image" ? getString(item, "result") : null;
    yield* Effect.gen({ self: this }, function* () {
      let attachment: AttachmentSummary;
      const storeBytes = Effect.gen({ self: this }, function* () {
        if (!result)
          return yield* new GeneratedImageFailed({
            cause: new Error(
              kind === "video"
                ? sourceText("error.backend.videoGenerationNoVideo")
                : "Image generation did not return an image.",
            ),
          });
        const bytes = yield* imageStep(() => decodeGeneratedImage(result));
        return yield* this.#mailbox
          .storeGeneratedAttachment({
            bytes,
            name: "generated-image.png",
            mimeType: "image/png",
            ownerAgentId: agentId,
            ownerThreadId: threadId,
          })
          .pipe(toGeneratedImageFailed);
      });
      if (savedPath) {
        const saved = yield* Effect.result(
          this.#mailbox
            .storeGeneratedAttachment({
              sourcePath: savedPath,
              kind,
              name: kind === "video" ? generatedVideoName(savedPath) : generatedImageName(savedPath),
              ownerAgentId: agentId,
              ownerThreadId: threadId,
            })
            .pipe(toGeneratedImageFailed),
        );
        if (Result.isSuccess(saved)) attachment = saved.success;
        else {
          if (!result) return yield* saved.failure;
          attachment = yield* storeBytes;
        }
      } else attachment = yield* storeBytes;
      yield* imageStep(() => {
        if (operation.interrupted) {
          const interruptedSnapshot = this.#conversation.ensureSnapshot(agentId, threadId);
          const interruptedMessage = interruptedSnapshot.messages.find((candidate) => candidate.id === item.id);
          const interruptedMedia = interruptedMessage ? generatedMediaInfo(interruptedMessage) : null;
          if (interruptedMessage && interruptedMedia) {
            interruptedMessage.status = "interrupted";
            interruptedMedia.info.error ??= generationInterruptedText(kind);
            this.#conversation.emitConversation(interruptedSnapshot);
          }
          return;
        }
        const latestSnapshot = this.#conversation.ensureSnapshot(agentId, threadId);
        const latestMessage = latestSnapshot.messages.find((candidate) => candidate.id === item.id);
        const latestMedia = latestMessage ? generatedMediaInfo(latestMessage) : null;
        if (!latestMessage || !latestMedia) return;
        latestMessage.attachments = [attachment];
        latestMessage.status = "completed";
        delete latestMedia.info.error;
        this.#conversation.emitConversation(latestSnapshot);
        return;
      });
    }).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          const error = failure.cause;
          const latestSnapshot = this.#conversation.ensureSnapshot(agentId, threadId);
          const latestMessage = latestSnapshot.messages.find((candidate) => candidate.id === item.id);
          const latestMedia = latestMessage ? generatedMediaInfo(latestMessage) : null;
          if (!latestMessage || !latestMedia) return;
          latestMessage.status = "failed";
          latestMedia.info.error = error instanceof Error ? error.message : String(error);
          this.#conversation.emitConversation(latestSnapshot);
        }),
      ),
    );
  }, Effect.uninterruptible);
}

export class GeneratedImageFailed extends Schema.TaggedError<GeneratedImageFailed>()("GeneratedImageFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: imageStep, rewrap: toGeneratedImageFailed } = causeHelpers(GeneratedImageFailed);
