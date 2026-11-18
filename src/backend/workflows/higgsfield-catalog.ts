/**
 * Reads Higgsfield's live model list (`models_explore`) into the canvas models of
 * `workflows-media-catalog-v1`, and keeps, for each model, how the host sends a request to it: the
 * roles of its input pictures, its `mode`, and the parameter names of its resolution and background.
 *
 * Only the models that make an image or a video from a description, with optional pictures, are kept.
 * A model that needs an input (a source video, one exact picture, a style id) cannot run from the
 * canvas, so it is not shown.
 */

import {
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX,
  type WorkflowMediaAspect,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaKind,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

/** How the host sends the pictures and the choices of a step to one Higgsfield model. */
export interface HiggsfieldPlan {
  /** The role of a reference picture ("image_references" or "image"), or null when it takes none. */
  referenceRole: string | null;
  /** The most reference pictures. */
  references: number;
  /** Whether it takes a first frame (`start_image`) and a last frame (`end_image`). */
  start: boolean;
  end: boolean;
  /** The most pictures in all roles together. */
  total?: number;
  /** Frames and references cannot go together. The frames are sent. */
  exclusive?: boolean;
  /** A last frame needs a first frame. A last frame alone is not sent. */
  endNeedsStart?: boolean;
  /** The values of the `mode` parameter: with no picture, with a frame, and with references only. */
  mode?: { text: string; frames: string | null; references: string | null };
  /** The parameter that takes the resolution, and the value that it takes for each canvas resolution. */
  resolution?: { param: string; values: Readonly<Record<string, string>> };
  /** How a transparent background is asked for: `background` "transparent", or `remove_bg`. */
  background?: { param: "background"; opaque: boolean } | { param: "remove_bg" };
}

/** A canvas model of the catalog with its plan, which stays on the host. */
export interface HiggsfieldCatalogEntry {
  model: WorkflowMediaCatalogModel;
  plan: HiggsfieldPlan;
}

const IMAGE_ROLES = ["start_image", "end_image", "image_references", "image"] as const;
/** A model that takes no reference count in its catalog entry gets this many. */
const DEFAULT_REFERENCES = 16;
/** A resolution option that is a size: "2k", "1.5k", "720p". */
const SIZE_OPTION = /^\d+(?:\.\d+)?k$|^\d+p$/iu;
/**
 * A role text that needs an exact input, such as "Exactly one image is required.". A text that
 * needs it only in another mode ("exactly one source video for edit") does not stop the model.
 */
const NEEDS_INPUT = /exactly one(?![^.|]*\bfor (?:edit|extend)\b)/iu;

/**
 * Fixed counts that the catalog text does not give in a form that can be read. The catalog values are
 * used for every other model.
 */
const KNOWN_LIMITS: Readonly<Record<string, Partial<Pick<HiggsfieldPlan, "references" | "total">>>> = {
  gpt_image_2_6: { references: 16 },
  nano_banana_pro: { references: 14 },
  seedream_v5_pro: { references: 10 },
  flux_3_image: { references: 10 },
  seedance_2_0: { references: 9, total: 9 },
  kling4_0: { references: 10, total: 10 },
};

export const text = (value: unknown) => (typeof value === "string" ? value : "");
const records = (value: unknown): DynamicRecord[] => (Array.isArray(value) ? value.filter(isDynamicRecord) : []);
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
export const numbers = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry > 0)
    : [];
const wholeNumber = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/** The text of each media role, from a description such as "Media roles: a — text | b — text". */
function roleTexts(description: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const part of description.replace(/^Media roles:\s*/iu, "").split(" | ")) {
    const match = /^\s*([a-z_]+)\s+—\s+(.*)$/su.exec(part);
    if (match?.[1] && match[2] !== undefined) texts.set(match[1], match[2]);
  }
  return texts;
}

/** The first number after "max", "at most" or "up to" in a role text. */
function textLimit(value: string | undefined): number | null {
  const match = value ? /(?:max|at most|up to)\s+(\d+)/iu.exec(value) : null;
  return match?.[1] ? Number(match[1]) : null;
}

/** The canvas aspect ratios of a model, in the order of the canvas. */
export function canvasAspects(value: unknown): WorkflowMediaAspect[] {
  const listed = new Set(strings(value));
  return WORKFLOW_MEDIA_ASPECTS.filter((aspect) => listed.has(aspect));
}

/**
 * The lengths that a catalog model sends: each length that the service takes, in ascending order, so
 * the canvas can ask for any of them. A list longer than the wire limit keeps the first and the last
 * length and lengths at even steps between them, so the canvas still shows Custom.
 */
export function catalogDurations(all: readonly number[]): number[] {
  const sorted = [...new Set(all)].sort((left, right) => left - right);
  const max = WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX;
  if (sorted.length <= max) return sorted;
  const step = (sorted.length - 1) / (max - 1);
  const kept = new Set(Array.from({ length: max }, (_, place) => Math.round(place * step)));
  return sorted.filter((_, index) => kept.has(index));
}

/** Each whole second from `min` to `max`. */
const range = (min: number, max: number) =>
  max >= min && max - min <= 120 ? Array.from({ length: max - min + 1 }, (_, index) => min + index) : [];

/** The lengths of a video model, from its `duration` parameter or its model fields. */
function videoDurations(item: DynamicRecord, duration: DynamicRecord | undefined): number[] {
  if (duration) {
    const options = numbers(duration.options);
    if (options.length > 0) return options;
    const span = /\((\d+)\s*-\s*(\d+)\)/u.exec(text(duration.description));
    const min = wholeNumber(duration.min) ?? (span?.[1] ? Number(span[1]) : null);
    const max = wholeNumber(duration.max) ?? (span?.[2] ? Number(span[2]) : null) ?? wholeNumber(duration.default);
    if (min !== null && max !== null) return range(min, max);
  }
  const listed = numbers(item.durations);
  if (listed.length > 0) return listed;
  const span = isDynamicRecord(item.duration_range) ? item.duration_range : null;
  const min = wholeNumber(span?.min);
  const max = wholeNumber(span?.max);
  return min !== null && max !== null ? range(min, max) : [];
}

/** A readable name from a model id: "soul_cinema_studio" is "Soul Cinema Studio". */
const idName = (id: string) =>
  id
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || id;

/** The canvas name of a resolution option: "2k" is "2K", "720p" stays. */
export const canvasResolution = (value: string) => value.replace(/k$/u, "K");

/** The resolution parameter of a model: `resolution`, or `quality` when its options are sizes. */
function resolutionChoice(parameters: readonly DynamicRecord[]) {
  for (const name of ["resolution", "quality"]) {
    const parameter = parameters.find((entry) => entry.name === name);
    const options = strings(parameter?.options).filter((option) => SIZE_OPTION.test(option));
    if (!parameter || options.length === 0) continue;
    const fallback = text(parameter.default);
    const ordered = options.includes(fallback)
      ? [fallback, ...options.filter((option) => option !== fallback)]
      : options;
    const values = Object.fromEntries(ordered.map((option) => [canvasResolution(option), option]));
    return { param: name, values, shown: ordered.map(canvasResolution) };
  }
  return null;
}

/** The `mode` values of a model whose mode says whether the request has pictures. */
function modeChoice(parameter: DynamicRecord | undefined): HiggsfieldPlan["mode"] | null {
  const options = strings(parameter?.options);
  if (options.includes("text-to-video"))
    return {
      text: "text-to-video",
      frames: options.includes("image-to-video") ? "image-to-video" : null,
      references: options.includes("reference-to-video") ? "reference-to-video" : null,
    };
  if (options.includes("t2v"))
    return {
      text: "t2v",
      frames: options.includes("omni_reference") ? "omni_reference" : null,
      references: options.includes("omni_reference") ? "omni_reference" : null,
    };
  return null;
}

/**
 * The catalog entry and plan of one `models_explore` item, or null when the canvas cannot run it.
 */
export function higgsfieldCatalogEntry(item: DynamicRecord): HiggsfieldCatalogEntry | null {
  const id = text(item.id);
  const kind: WorkflowMediaKind | null =
    item.output_type === "image" ? "image" : item.output_type === "video" ? "video" : null;
  // "higgsfield-" and the id fit the 128 characters of a wire identifier.
  if (!/^[a-z0-9_.-]{1,117}$/iu.test(id) || !kind) return null;
  const aspects = canvasAspects(item.aspect_ratios);
  if (aspects.length === 0) return null;
  const parameters = records(item.parameters);
  const mode = modeChoice(parameters.find((entry) => entry.name === "mode"));
  // A parameter that the canvas cannot fill, other than a mode that it sets, stops the model.
  if (parameters.some((entry) => entry.required === "required" && !(entry.name === "mode" && mode))) return null;
  const medias = records(item.medias);
  if (medias.some((media) => media.required === true)) return null;
  const roles = new Set(medias.flatMap((media) => strings(media.roles)));
  const texts = new Map(medias.flatMap((media) => [...roleTexts(text(media.description))]));
  if (roles.size > 0 && !IMAGE_ROLES.some((role) => roles.has(role))) return null;
  if ([...texts.values()].some((value) => NEEDS_INPUT.test(value))) return null;

  const durations =
    kind === "video"
      ? catalogDurations(
          videoDurations(
            item,
            parameters.find((entry) => entry.name === "duration"),
          ),
        )
      : [];
  if (kind === "video" && durations.length === 0) return null;

  const referenceRole = roles.has("image_references") ? "image_references" : roles.has("image") ? "image" : null;
  const referenceText = referenceRole ? texts.get(referenceRole) : undefined;
  const listedMax =
    medias
      .filter((media) => referenceRole !== null && strings(media.roles).includes(referenceRole))
      .map((media) => wholeNumber(media.max))
      .find((value) => value !== null) ?? null;
  const known = KNOWN_LIMITS[id];
  const references = referenceRole
    ? (known?.references ?? listedMax ?? textLimit(referenceText) ?? DEFAULT_REFERENCES)
    : 0;
  const total =
    known?.total ??
    (referenceText && /across/iu.test(referenceText) ? (textLimit(referenceText) ?? undefined) : undefined);
  const startText = texts.get("start_image") ?? "";
  const endText = texts.get("end_image") ?? "";
  const resolution = resolutionChoice(parameters);
  const background = parameters.find((entry) => entry.name === "background");
  const removesBackground = parameters.some((entry) => entry.name === "remove_bg");
  const transparent = kind === "image" && (strings(background?.options).includes("transparent") || removesBackground);
  const plan: HiggsfieldPlan = {
    referenceRole: mode && mode.references === null && mode.frames === null ? null : referenceRole,
    references: mode && mode.references === null ? 0 : references,
    start: roles.has("start_image") && (!mode || mode.frames !== null),
    end: roles.has("end_image") && (!mode || mode.frames !== null),
    ...(total === undefined ? {} : { total }),
    // A model whose references are for another mode than the frames takes one or the other.
    ...(/cannot be combined with reference/iu.test(startText) ||
    (mode?.text === "text-to-video" && referenceText !== undefined && !/image-to-video/iu.test(referenceText))
      ? { exclusive: true }
      : {}),
    ...(/requires start_image/iu.test(endText) ? { endNeedsStart: true } : {}),
    ...(mode ? { mode } : {}),
    ...(resolution ? { resolution: { param: resolution.param, values: resolution.values } } : {}),
    ...(transparent
      ? {
          background:
            background && strings(background.options).includes("transparent")
              ? { param: "background" as const, opaque: strings(background.options).includes("opaque") }
              : { param: "remove_bg" as const },
        }
      : {}),
  };
  // A model with no name, such as `soul_cinema_studio`, shows its id as words: "Soul Cinema Studio".
  const name = text(item.name).trim().slice(0, 160) || idName(id);
  const maker = text(item.provider_name).trim().slice(0, 120) || "Higgsfield";
  return {
    model: {
      id: `higgsfield-${id}`,
      provider: "higgsfield",
      providerModel: id,
      name,
      maker,
      kinds: [kind],
      aspects,
      durations,
      resolutions: resolution?.shown.slice(0, 16) ?? [],
      transparent,
    },
    plan,
  };
}

/**
 * The plan of a model of `WORKFLOW_MEDIA_MODELS` when the live list is not available: the inputs
 * that each one takes, from Higgsfield's catalog of 2026-11-16.
 */
const FIXED_PLANS: Readonly<Record<string, HiggsfieldPlan>> = {
  gpt_image_2_6: {
    referenceRole: "image_references",
    references: 16,
    start: false,
    end: false,
    background: { param: "background", opaque: true },
  },
  nano_banana_pro: { referenceRole: "image_references", references: 14, start: false, end: false },
  seedream_v5_pro: {
    referenceRole: "image_references",
    references: 10,
    start: false,
    end: false,
    background: { param: "remove_bg" },
  },
  flux_3_image: { referenceRole: "image_references", references: 10, start: false, end: false },
  seedance_2_0: { referenceRole: "image_references", references: 9, start: true, end: true, total: 9 },
  kling4_0: {
    referenceRole: "image_references",
    references: 10,
    start: true,
    end: true,
    total: 10,
    mode: { text: "text-to-video", frames: "image-to-video", references: "reference-to-video" },
  },
  wan2_7: { referenceRole: null, references: 0, start: true, end: true },
};

/** The plan of a model that is not in the live list. A video takes frames; an image takes no picture. */
export function higgsfieldFixedPlan(model: string, kind: WorkflowMediaKind): HiggsfieldPlan {
  return FIXED_PLANS[model] ?? { referenceRole: null, references: 0, start: kind === "video", end: kind === "video" };
}
