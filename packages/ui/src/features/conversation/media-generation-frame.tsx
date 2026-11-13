import type { ImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { CircleAlert } from "@openbot/ui";
import { For } from "solid-js";

export type MediaGenerationStatus = "generating" | "completed" | "failed" | "interrupted";

/** The dots and the moving glow that fill the frame while a model makes the image or the video. */
export function MediaGenerationCanvas() {
  return (
    <div class="image-generation-canvas image-generation-canvas-visible" aria-hidden="true">
      <div class="image-generation-dots" />
      <div class="image-generation-glow" />
    </div>
  );
}

/** The mark of a frame whose image or video did not arrive. */
export function MediaGenerationFailure() {
  return (
    <div class="image-generation-canvas image-generation-canvas-visible image-generation-canvas-failed">
      <CircleAlert class="image-generation-failure-mark" aria-hidden="true" />
    </div>
  );
}

/** Short values such as the length and the size, with a dot between them. */
export function MediaGenerationSpecs(props: { values: readonly (string | undefined)[]; class: string }) {
  const values = () => props.values.filter((value): value is string => Boolean(value));
  return (
    <span class={props.class}>
      <For each={values()}>{(value) => <span class="image-generation-spec">{value}</span>}</For>
    </span>
  );
}

/** The frame of a result before its real size is known. */
export function mediaRatioValue(
  aspectRatio: ImageGenerationAspectRatio,
  kind: "image" | "video",
): "4 / 5" | "4 / 3" | "1 / 1" | "9 / 16" | "16 / 9" {
  if (kind === "video") {
    if (aspectRatio === "portrait") return "9 / 16";
    return aspectRatio === "square" ? "1 / 1" : "16 / 9";
  }
  if (aspectRatio === "portrait") return "4 / 5";
  if (aspectRatio === "landscape") return "4 / 3";
  return "1 / 1";
}

/** A failed frame is low, so the reason under it stays near the prompt. */
export const FAILED_MEDIA_RATIO = "3 / 1";
