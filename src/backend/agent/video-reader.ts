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
  /** The time of the frame in the video, in seconds. */
  seconds: number;
  /** A JPEG data URL, which the agent reads as an image. */
  imageUrl: string;
}

export interface VideoReading {
  title: string | null;
  uploader: string | null;
  /** The page of the video, after redirects. */
  pageUrl: string | null;
  durationSeconds: number | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  description: string | null;
  /** What is said in the video, with the start time of each part in seconds. */
  transcript: { seconds: number; text: string }[];
  /** Why the transcript is empty or incomplete, or null. Safe to give to the agent. */
  transcriptNote: string | null;
  frames: VideoFrame[];
  /** Why there are no frames, or null. Safe to give to the agent. */
  framesNote: string | null;
}

/** The video could not be read. The reason is safe to give to the agent. */
export class VideoReadFailed extends Schema.TaggedError<VideoReadFailed>()("VideoReadFailed", {
  reason: Schema.String,
}) {}

/**
 * Reads an online video for `read_video`: it downloads the video to a temporary folder on this
 * computer, transcribes its sound and takes frames. The main process owns the downloader, the
 * decoder window and the speech model; nothing stays on disk after the call.
 */
export interface VideoReaderHost {
  read(request: VideoReadRequest): Effect.Effect<VideoReading, VideoReadFailed>;
}
