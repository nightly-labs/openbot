import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

/** `read_image` opens no larger file: a 48-megapixel phone photo is about 20 MB. */
export const READ_IMAGE_MAX_FILE_BYTES = 100 * 1024 * 1024;

export const readImageToolShape = {
  path: z.string().min(1).max(INPUT_LIMITS.path).describe("An absolute path, or a path in your workspace."),
};

export const readImageToolSchema = z.strictObject(readImageToolShape);

/** The picture that `read_image` gives the model, upright, and the upright size of the file. */
interface FittedImage {
  dataUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** The picture, or why there is none: not a PNG or JPEG file, or more pixels than this process decodes. */
export type ImageFitResult = FittedImage | "unsupported" | "tooLarge";

/** Decodes a PNG or JPEG file and makes it small enough for a model. */
export type ImageFitter = (bytes: Uint8Array) => ImageFitResult;
