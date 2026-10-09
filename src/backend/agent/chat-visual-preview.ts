import type { ChatVisualAppearance } from "@openbot/contracts/chat-visual";
import type { Effect } from "effect";
import { Schema } from "effect";

export interface ChatVisualPreviewRequest {
  html: string;
  width: number;
  appearance: ChatVisualAppearance;
}

export interface ChatVisualPreviewResult {
  /** A PNG data URL of the page at its content height, which the agent reads as an image. */
  imageUrl: string;
  contentHeight: number;
  console: string[];
}

/**
 * The page could not be drawn. The reason is safe to give to the agent, which can correct its page
 * and try again.
 */
export class ChatVisualPreviewFailed extends Schema.TaggedError<ChatVisualPreviewFailed>()("ChatVisualPreviewFailed", {
  reason: Schema.String,
}) {}

/**
 * Draws a visual reply page out of view, in the sandbox that the chat gives it, so that the agent can
 * look at its page before it shows it. The main process owns the window.
 */
export interface ChatVisualPreviewHost {
  capture(request: ChatVisualPreviewRequest): Effect.Effect<ChatVisualPreviewResult, ChatVisualPreviewFailed>;
}
