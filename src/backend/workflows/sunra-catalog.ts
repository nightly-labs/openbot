import type { WorkflowMediaCatalogModel, WorkflowMediaKind } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { canvasAspects, catalogDurations, numbers, strings, text } from "./higgsfield-catalog";

export interface SunraPlan {
  references: number;
  start: boolean;
  end: boolean;
  transparent: boolean;
}

export interface SunraCatalogEntry {
  model: WorkflowMediaCatalogModel;
  plan: SunraPlan;
}

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

const UNSET_REFERENCES = 4;

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0);

function maker(id: string): string {
  return MAKERS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "Sunra";
}

export function sunraCatalogEntry(item: DynamicRecord): SunraCatalogEntry | null {
  const id = text(item.model_id);
  const kind: WorkflowMediaKind | null = item.type === "image" ? "image" : item.type === "video" ? "video" : null;
  if (!/^[a-z0-9_.-]{1,120}$/iu.test(id) || !kind) return null;
  const aspects = canvasAspects(item.supported_aspect_ratios);
  if (aspects.length === 0) return null;
  const capabilities = new Set(strings(item.capabilities));
  const editsVideo = [...capabilities].some((capability) => capability.startsWith("video-to-video"));
  if (kind === "video" && editsVideo && !capabilities.has("image-to-video")) return null;
  const durations = kind === "video" ? catalogDurations(numbers(item.supported_durations)) : [];
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

export function sunraFixedPlan(kind: WorkflowMediaKind): SunraPlan {
  return { references: 16, start: kind === "video", end: kind === "video", transparent: false };
}

export const isSunraModelList = (value: unknown): value is DynamicRecord[] =>
  Array.isArray(value) && value.every(isDynamicRecord);
