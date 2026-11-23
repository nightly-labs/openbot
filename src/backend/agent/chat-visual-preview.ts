import type { ChatVisualAppearance } from "@openbot/contracts/chat-visual";
import type { Effect } from "effect";
import { Schema } from "effect";

export interface ChatVisualPreviewRequest {
  html: string;
  width: number;
  appearance: ChatVisualAppearance;
}

export interface ChatVisualPreviewResult {
  imageUrl: string;
  contentHeight: number;
  console: string[];
}

export class ChatVisualPreviewFailed extends Schema.TaggedError<ChatVisualPreviewFailed>()("ChatVisualPreviewFailed", {
  reason: Schema.String,
}) {}

export interface ChatVisualPreviewHost {
  capture(request: ChatVisualPreviewRequest): Effect.Effect<ChatVisualPreviewResult, ChatVisualPreviewFailed>;
}
