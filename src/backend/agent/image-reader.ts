import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

export const READ_IMAGE_MAX_FILE_BYTES = 100 * 1024 * 1024;

export const readImageToolShape = {
  path: z.string().min(1).max(INPUT_LIMITS.path).describe("An absolute path, or a path in your workspace."),
};

export const readImageToolSchema = z.strictObject(readImageToolShape);

interface FittedImage {
  dataUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export type ImageFitResult = FittedImage | "unsupported" | "tooLarge";

export type ImageFitter = (bytes: Uint8Array) => ImageFitResult;
