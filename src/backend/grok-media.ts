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

export function grokMediaToolKind(update: { _meta?: unknown; title?: string | null }): GeneratedMediaKind | null {
  const tool =
    (isRecord(update._meta) ? getString(getRecord(update._meta, "x.ai/tool"), "name") : null) ?? update.title ?? null;
  return tool && Object.hasOwn(TOOL_KINDS, tool) ? (TOOL_KINDS[tool] ?? null) : null;
}

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

function aspectRatio(value: string | null): "square" | "portrait" | "landscape" | null {
  if (value === "1:1") return "square";
  if (value === "16:9" || value === "3:2" || value === "4:3") return "landscape";
  if (value === "9:16" || value === "2:3" || value === "3:4") return "portrait";
  return null;
}

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

export function grokMediaItem(kind: GeneratedMediaKind, call: ThreadItem, content: unknown): ThreadItem {
  const input = isRecord(call.arguments) ? call.arguments : {};
  const output = isRecord(call.result) ? call.result : {};
  const path = getString(output, "path");
  const status = call.status === "completed" || call.status === "failed" ? call.status : "in_progress";
  const ratio = aspectRatio(getString(input, "aspect_ratio"));
  const prompt = getString(input, "prompt");
  const resolutionName = getString(input, "resolution_name");
  const resolution = resolutionName && resolutionName.length <= 40 ? resolutionName : null;
  const duration = typeof input.duration === "number" && input.duration > 0 ? input.duration : null;
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
