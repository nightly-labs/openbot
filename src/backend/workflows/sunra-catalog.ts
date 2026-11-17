/**
 * Reads Sunra's live model list (`list_models`) into the canvas models of `workflows-media-catalog-v1`,
 * and keeps, for each model, which input pictures the host sends to it.
 *
 * Only the image and video models are kept. A video model that only edits or moves a source video
 * cannot run from the canvas, so it is not shown.
 */

import type { WorkflowMediaCatalogModel, WorkflowMediaKind } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { canvasAspects, numbers, shownDurations, strings, text } from "./higgsfield-catalog";

/** How the host sends the pictures and the background of a step to one Sunra model. */
export interface SunraPlan {
  /** The most reference pictures: `image_urls` of an image, `reference_images` of a video. */
  references: number;
  /**
   * Whether a video takes a first frame (`start_image`) and a last frame (`end_image`). Most models
   * refuse a last frame without a first frame, so a last frame alone is not sent.
   */
  start: boolean;
  end: boolean;
  /** Whether an image takes `background` "transparent". */
  transparent: boolean;
}

/** A canvas model of the catalog with its plan, which stays on the host. */
export interface SunraCatalogEntry {
  model: WorkflowMediaCatalogModel;
  plan: SunraPlan;
}

/** The maker of a Sunra model, from the start of its id. A model of another family is "Sunra". */
const MAKERS: readonly (readonly [string, string])[] = [
  ["nano-banana", "Google"],
  ["veo-", "Google"],
  ["gemini-", "Google"],
  ["gpt-image", "OpenAI"],
  ["seedream", "ByteDance"],
  ["seedance", "ByteDance"],
  ["flux-", "Black Forest Labs"],
  ["kling-", "Kuaishou"],
  ["wan-", "Alibaba"],
  ["happy-horse", "Alibaba"],
  ["minimax-", "MiniMax"],
  ["grok-", "xAI"],
  ["midjourney", "Midjourney"],
  ["ideogram", "Ideogram"],
  ["krea", "Krea"],
  ["heygen", "HeyGen"],
  ["pika", "Pika"],
  ["veed", "VEED"],
];

/** The references that Sunra takes from a model whose `max_ref_images` is not set. */
const UNSET_REFERENCES = 4;

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0);

function maker(id: string): string {
  return MAKERS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "Sunra";
}

/** The catalog entry and plan of one `list_models` item, or null when the canvas cannot run it. */
export function sunraCatalogEntry(item: DynamicRecord): SunraCatalogEntry | null {
  const id = text(item.model_id);
  const kind: WorkflowMediaKind | null = item.type === "image" ? "image" : item.type === "video" ? "video" : null;
  if (!/^[a-z0-9_.-]{1,120}$/iu.test(id) || !kind) return null;
  const aspects = canvasAspects(item.supported_aspect_ratios);
  if (aspects.length === 0) return null;
  const capabilities = new Set(strings(item.capabilities));
  const editsVideo = [...capabilities].some((capability) => capability.startsWith("video-to-video"));
  if (kind === "video" && editsVideo && !capabilities.has("image-to-video")) return null;
  const durations = kind === "video" ? shownDurations(numbers(item.supported_durations)) : [];
  if (kind === "video" && durations.length === 0) return null;
  const listed = strings(item.supported_resolutions).filter((value) => value.length <= 16);
  const fallback = text(item.default_resolution);
  const resolutions = listed.includes(fallback) ? [fallback, ...listed.filter((value) => value !== fallback)] : listed;
  const transparent = kind === "image" && capabilities.has("transparent-background");
  const takesReferences = kind === "image" ? capabilities.has("image-editing") : capabilities.has("reference-images");
  return {
    model: {
      id: `sunra-${id}`,
      provider: "sunra",
      providerModel: id,
      name: text(item.name).trim().slice(0, 160) || id,
      maker: maker(id),
      kinds: [kind],
      aspects,
      durations,
      resolutions: resolutions.slice(0, 16),
      transparent,
    },
    plan: {
      // Sunra takes 4 references from a model that does not give its limit, and none for a limit of 0.
      references: !takesReferences
        ? 0
        : typeof item.max_ref_images === "number"
          ? count(item.max_ref_images)
          : UNSET_REFERENCES,
      start: kind === "video" && capabilities.has("image-to-video"),
      end: kind === "video" && capabilities.has("end-frame"),
      transparent,
    },
  };
}

/**
 * The plan of a model of `WORKFLOW_MEDIA_MODELS` when the live list is not available. It sends what
 * the canvas sent before the live list: each reference, and both frames of a video.
 */
export function sunraFixedPlan(kind: WorkflowMediaKind): SunraPlan {
  return { references: 16, start: kind === "video", end: kind === "video", transparent: false };
}

export const isSunraModelList = (value: unknown): value is DynamicRecord[] =>
  Array.isArray(value) && value.every(isDynamicRecord);
