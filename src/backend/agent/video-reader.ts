import type { Effect } from "effect";
import { Schema } from "effect";
import { z } from "zod";

export const READ_VIDEO_DEFAULT_FRAMES = 6;
const READ_VIDEO_MAX_FRAMES = 12;

export const readVideoToolShape = {
  url: z
    .url({ protocol: /^https?$/u, error: "Use an http or https link." })
    .max(4_096)
    .describe("The video page or file link."),
  frames: z
    .number()
    .int()
    .min(0)
    .max(READ_VIDEO_MAX_FRAMES)
    .optional()
    .describe(`Still frames as images; 0 for text only. Default ${READ_VIDEO_DEFAULT_FRAMES}.`),
};

export const readVideoToolSchema = z.strictObject(readVideoToolShape);

export interface VideoReadRequest {
  url: string;
  frames: number;
}

interface VideoFrame {
  seconds: number;
  imageUrl: string;
}

export interface VideoReading {
  title: string | null;
  uploader: string | null;
  pageUrl: string | null;
  durationSeconds: number | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  description: string | null;
  transcript: { seconds: number; text: string }[];
  transcriptNote: string | null;
  frames: VideoFrame[];
  framesNote: string | null;
}

export class VideoReadFailed extends Schema.TaggedError<VideoReadFailed>()("VideoReadFailed", {
  reason: Schema.String,
}) {}

export interface VideoReaderHost {
  read(request: VideoReadRequest): Effect.Effect<VideoReading, VideoReadFailed>;
}
