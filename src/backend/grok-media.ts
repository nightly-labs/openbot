// The image and video tools of Grok CLI 1.0.77 (`image_gen`, `image_edit`, `image_to_video`,
// `reference_to_video`).
// ACP shows them as plain tool calls. Only the first updates of a call name the tool, in
// `_meta["x.ai/tool"].name`; a later update renames the call to "imagine: <prompt>". The completed
// update gives the file that Grok wrote in its session folder as `rawOutput.path`, with
// `rawOutput.type` "ImageGen", "ImageEdit" or "ReferenceToVideo". The chat shows these calls as
// the image or video that they made.
import type { GeneratedMediaKind } from "./agent/image-generation";
import { getRecord, getString, isRecord, type ThreadItem } from "./protocol";

const TOOL_KINDS: Record<string, GeneratedMediaKind> = {
  image_gen: "image",
  image_edit: "image",
  image_to_video: "video",
  reference_to_video: "video",
};

const OUTPUT_KINDS: Record<string, GeneratedMediaKind> = {
  ImageGen: "image",
  ImageEdit: "image",
  ImageToVideo: "video",
  ReferenceToVideo: "video",
};

/**
 * The media kind of the tool that Grok names in an update, or null when it names no media tool. Only
 * the CLI writes the name; the model writes the arguments. Thus a permission uses this, not
 * `grokMediaKind`.
 */
export function grokMediaToolKind(update: { _meta?: unknown; title?: string | null }): GeneratedMediaKind | null {
  // The first update and a permission request can also name the tool only in the title.
  const tool =
    (isRecord(update._meta) ? getString(getRecord(update._meta, "x.ai/tool"), "name") : null) ?? update.title ?? null;
  return tool && Object.hasOwn(TOOL_KINDS, tool) ? (TOOL_KINDS[tool] ?? null) : null;
}

/** The media kind of a Grok tool update, or null when the update does not name a media tool. */
export function grokMediaKind(update: {
  _meta?: unknown;
  title?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}): GeneratedMediaKind | null {
  const kind = grokMediaToolKind(update);
  if (kind) return kind;
  for (const value of [update.rawOutput, update.rawInput]) {
    const type = isRecord(value) ? (getString(value, "type") ?? getString(value, "variant")) : null;
    if (type && Object.hasOwn(OUTPUT_KINDS, type)) return OUTPUT_KINDS[type] ?? null;
  }
  return null;
}

/** Grok's ratios as the chat's three frames. `auto` and an unknown ratio have no frame. */
function aspectRatio(value: string | null): "square" | "portrait" | "landscape" | null {
  if (value === "1:1") return "square";
  if (value === "16:9" || value === "3:2" || value === "4:3") return "landscape";
  if (value === "9:16" || value === "2:3" || value === "3:4") return "portrait";
  return null;
}

/** The text of the ACP content blocks of a tool call, cut to 500 characters. */
function contentText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = content
    .flatMap((block) => {
      const inner = isRecord(block) && isRecord(block.content) ? block.content : block;
      return isRecord(inner) && inner.type === "text" && typeof inner.text === "string" ? [inner.text] : [];
    })
    .join("\n")
    .trim();
  return text ? text.slice(0, 500) : null;
}

/**
 * The `imageGeneration` or `videoGeneration` item of a Grok media tool call. `call` is the tool
 * item that the ACP client keeps, with the arguments and the result of all updates so far.
 */
export function grokMediaItem(kind: GeneratedMediaKind, call: ThreadItem, content: unknown): ThreadItem {
  const input = isRecord(call.arguments) ? call.arguments : {};
  const output = isRecord(call.result) ? call.result : {};
  const path = getString(output, "path");
  const status = call.status === "completed" || call.status === "failed" ? call.status : "in_progress";
  const ratio = aspectRatio(getString(input, "aspect_ratio"));
  const prompt = getString(input, "prompt");
  // The message keeps a short name such as "720p" (`isVideoGenerationInfo`); a longer value is not one.
  const resolutionName = getString(input, "resolution_name");
  const resolution = resolutionName && resolutionName.length <= 40 ? resolutionName : null;
  const duration = typeof input.duration === "number" && input.duration > 0 ? input.duration : null;
  // A call that ends without a file, such as a plan that cannot make videos, says why in its text.
  const error = status === "failed" || (status === "completed" && !path) ? contentText(content) : null;
  return {
    id: call.id,
    type: kind === "video" ? "videoGeneration" : "imageGeneration",
    status: error && status === "completed" ? "failed" : status,
    ...(prompt ? { prompt } : {}),
    ...(ratio ? { aspect_ratio: ratio } : {}),
    ...(kind === "video" && resolution ? { resolution } : {}),
    ...(kind === "video" && duration !== null ? { duration } : {}),
    ...(path ? { saved_path: path } : {}),
    ...(error ? { error } : {}),
  };
}
