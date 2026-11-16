import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { parseBrowserToolCall } from "../browser-tools";
import type { DynamicToolResult } from "../protocol";

const logger = createOpenBotLogger("browser-screenshot-file");

/**
 * `openbot_browser.screenshot` with `save: true` also writes the image as a PNG file in the agent's
 * workspace. The inline image reaches only the model, so an agent could not attach it to its response
 * or put it in a report (#7328, #7405). The workspace is a folder that `attach_files_to_response` reads.
 */
export const saveBrowserScreenshot = Effect.fn("saveBrowserScreenshot")(function* (
  workspacePath: () => string,
  args: unknown,
  result: DynamicToolResult,
) {
  if (!result.success || !savesFile(args)) return result;
  const image = result.contentItems.find((item) => item.type === "inputImage");
  const png = image && /^data:image\/png;base64,(.+)$/su.exec(image.imageUrl)?.[1];
  if (!png) return withNote(result, "The image was not saved as a file.");
  return yield* Effect.tryPromise(async () => {
    const folder = join(workspacePath(), "browser-screenshots");
    const path = join(
      folder,
      `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`,
    );
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(path, Buffer.from(png, "base64"), { flag: "wx", mode: 0o600 });
    return withNote(
      result,
      `Saved as ${path}. To show it to the user, pass this path to openbot.attach_files_to_response.`,
    );
  }).pipe(
    Effect.catch((failure) =>
      Effect.sync(() => {
        logger.warn("Could not save a browser screenshot.", { error: toLogValue(failure.cause) });
        return withNote(result, "The image was not saved as a file: the workspace folder cannot be written.");
      }),
    ),
  );
});

/** Decodes the arguments as the browser host does, so a repaired or wrapped call also saves its file. */
function savesFile(args: unknown): boolean {
  try {
    const call = parseBrowserToolCall("screenshot", args);
    return call.tool === "screenshot" && call.args.save === true;
  } catch {
    return false;
  }
}

function withNote(result: DynamicToolResult, text: string): DynamicToolResult {
  return { ...result, contentItems: [{ type: "inputText", text }, ...result.contentItems] };
}
