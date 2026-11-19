/**
 * Reads Higgsfield's live model list (`models_explore`) into the canvas models of
 * `workflows-media-catalog-v1` and `-v2`, and keeps, for each model, how the host sends a request to it:
 * the roles of its input pictures, videos and audio files, its `mode`, the parameter names of its
 * resolution and background, and its other settings.
 *
 * Only the models that make an image or a video from a description, with optional pictures, are kept.
 * A model that needs an input (a source video, one exact picture, a style id) cannot run from the
 * canvas, so it is not shown.
 */

import {
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_INPUTS,
  WORKFLOW_MEDIA_MODE_OPTION,
  WORKFLOW_MEDIA_OPTION_TEXT_MAX,
  WORKFLOW_MEDIA_OPTION_VALUES_MAX,
  WORKFLOW_MEDIA_OPTIONS_MAX,
  type WorkflowMediaAspect,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaInput,
  type WorkflowMediaKind,
  type WorkflowMediaMode,
  type WorkflowMediaOption,
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
  /**
   * The modes that a person can choose (`workflows-media-catalog-v2`): the inputs that the model takes
   * in each. The host sends the chosen mode and only these inputs. Without a choice, `mode` applies.
   */
  modes?: Readonly<Record<string, readonly WorkflowMediaInput[]>>;
  /** The role and the most files of the reference videos and of the reference audio files of a video. */
  videos?: { role: string; max: number };
  audios?: { role: string; max: number };
  /** The parameter that takes the resolution, and the value that it takes for each canvas resolution. */
  resolution?: { param: string; values: Readonly<Record<string, string>> };
  /** How a transparent background is asked for: `background` "transparent", or `remove_bg`. */
  background?: { param: "background"; opaque: boolean } | { param: "remove_bg" };
  /**
   * The other settings of the model (`workflows-media-catalog-v2`), by parameter name: the value that the
   * host sends for each canvas value. Only these names and values go to Higgsfield.
   */
  options?: Readonly<Record<string, Readonly<Record<string, string | boolean>>>>;
  /**
   * The settings whose canvas default is not the service default, by parameter name: the canvas value
   * that the host sends when the step has no choice, so the step makes what its settings show.
   */
  defaults?: Readonly<Record<string, string>>;
}

/** A canvas model of the catalog with its plan, which stays on the host. */
export interface HiggsfieldCatalogEntry {
  model: WorkflowMediaCatalogModel;
  plan: HiggsfieldPlan;
}

const IMAGE_ROLES = ["start_image", "end_image", "image_references", "image"] as const;
const VIDEO_ROLES = ["video_references", "video"] as const;
const AUDIO_ROLES = ["audio_references", "audio"] as const;
/** A video model that gives no count of reference videos or audio files gets this many of each. */
const DEFAULT_CLIPS = 3;
/** A model that takes no reference count in its catalog entry gets this many. */
const DEFAULT_REFERENCES = 16;
/**
 * The most lengths that a catalog model can send: the `durations` limit of the catalog wire. A model
 * with more shows only some of them; see `shownDurations`.
 */
const MAX_DURATION_CHOICES = 64;
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
const KNOWN_LIMITS: Readonly<
  Record<string, Partial<Pick<HiggsfieldPlan, "references" | "total"> & { videos: number; audios: number }>>
> = {
  gpt_image_2_6: { references: 16 },
  nano_banana_pro: { references: 14 },
  seedream_v5_pro: { references: 10 },
  flux_3_image: { references: 10 },
  seedance_2_0: { references: 9, total: 9, videos: 3, audios: 3 },
  seedance_2_0_mini: { videos: 3, audios: 3 },
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
 * The lengths to show: each length of the model, so the slider stops at each whole second. A model
 * with more lengths than the wire takes shows its shortest and longest length and each multiple of 5
 * between them.
 */
export function shownDurations(all: readonly number[]): number[] {
  const sorted = [...new Set(all)].sort((left, right) => left - right);
  if (sorted.length <= MAX_DURATION_CHOICES) return sorted;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return sorted.filter((value) => value === first || value === last || value % 5 === 0);
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

/**
 * Parameters that are never a setting of the canvas: the host sets them itself, or they need a value
 * that the canvas does not have (an inpaint mask, more than one shot or file in one job).
 */
const RESERVED_OPTIONS = new Set([
  "model",
  "prompt",
  "count",
  "use_unlim",
  "get_cost",
  "medias",
  "aspect_ratio",
  "duration",
  "resolution",
  "quality",
  "background",
  "remove_bg",
  "is_inpaint",
  "multi_shots",
  "multi_shot_mode",
  "batch_size",
  "seed",
  // An extension or a draft job needs a job id that the canvas does not have.
  "extension_mode",
  "draft_job_id",
  // The canvas keeps a picture, and the service reads the language of the description itself.
  "output_format",
  "prompt_language",
  "folder_id",
]);
const OPTION_NAME = /^[a-z][a-z0-9_]{0,63}$/iu;
const isOptionValue = (value: string) => value.length > 0 && value.length <= WORKFLOW_MEDIA_OPTION_TEXT_MAX;

/** A value that needs another parameter, such as a curve or an id, that the canvas does not have. */
const NEEDS_MORE = new Set(["custom", "user"]);
/** The first value of a list with no default: the host sends no value, and the service chooses. */
const SERVICE_CHOICE = "auto";
/**
 * The canvas default of a setting when the model has that value, in place of the service default.
 * A high bitrate keeps the detail of the video; it costs no more credits.
 */
const CANVAS_DEFAULTS: Readonly<Record<string, string>> = { bitrate_mode: "high" };

/** A canvas option and the values that the host sends for it, from one catalog parameter. */
function optionChoice(
  parameter: DynamicRecord,
): { option: WorkflowMediaOption; sent: Record<string, string | boolean> } | null {
  const name = text(parameter.name);
  const values: unknown[] = Array.isArray(parameter.options) ? parameter.options : [];
  const flags = values.length > 0 && values.every((value) => typeof value === "boolean");
  if (parameter.type === "boolean" || typeof parameter.default === "boolean" || flags) {
    return {
      option: { name, kind: "switch", values: ["off", "on"], default: parameter.default === true ? "on" : "off" },
      sent: { off: false, on: true },
    };
  }
  const listed = [...new Set(strings(values))];
  if (listed.length !== values.length) return null;
  const options = listed.filter((value) => !NEEDS_MORE.has(value));
  if (options.length < 2) return null;
  const fallback = text(parameter.default);
  if (options.length === 2 && options.includes("on") && options.includes("off")) {
    return {
      option: { name, kind: "switch", values: ["off", "on"], default: fallback === "on" ? "on" : "off" },
      sent: { off: "off", on: "on" },
    };
  }
  // With no default, the service uses none of the values: "Auto" comes first, and the host sends nothing
  // for it. Before, the first value showed as chosen although the host did not send it.
  const preferred = CANVAS_DEFAULTS[name];
  if (preferred !== undefined && options.includes(preferred)) {
    if (options.length > WORKFLOW_MEDIA_OPTION_VALUES_MAX || !options.every(isOptionValue)) return null;
    return {
      option: { name, kind: "choice", values: options, default: preferred },
      sent: Object.fromEntries(options.map((value) => [value, value])),
    };
  }
  const auto = !options.includes(fallback) && !options.includes(SERVICE_CHOICE);
  const shown = auto ? [SERVICE_CHOICE, ...options] : options;
  if (shown.length > WORKFLOW_MEDIA_OPTION_VALUES_MAX || !options.every(isOptionValue)) return null;
  return {
    option: { name, kind: "choice", values: shown, default: auto ? SERVICE_CHOICE : fallback },
    sent: Object.fromEntries(options.map((value) => [value, value])),
  };
}

/**
 * The settings of a model that a person can change on the canvas: each optional parameter with a
 * switch or a short list of values, other than the parameters that the host sets.
 */
function optionChoices(
  parameters: readonly DynamicRecord[],
  reserved: ReadonlySet<string>,
  first: { option: WorkflowMediaOption; sent: Record<string, string> } | null,
) {
  const options: WorkflowMediaOption[] = first ? [first.option] : [];
  const sent: Record<string, Readonly<Record<string, string | boolean>>> = first
    ? { [first.option.name]: first.sent }
    : {};
  const defaults: Record<string, string> = {};
  for (const parameter of parameters) {
    const name = text(parameter.name);
    if (!OPTION_NAME.test(name) || RESERVED_OPTIONS.has(name) || reserved.has(name) || name in sent) continue;
    const choice = optionChoice(parameter);
    if (!choice) continue;
    options.push(choice.option);
    sent[name] = choice.sent;
    if (CANVAS_DEFAULTS[name] === choice.option.default) defaults[name] = choice.option.default;
    if (options.length === WORKFLOW_MEDIA_OPTIONS_MAX) break;
  }
  return { options, sent, defaults: Object.keys(defaults).length > 0 ? defaults : undefined };
}

/** The canvas name of a resolution option: "2k" is "2K", "720p" stays. */
const canvasResolution = (value: string) => value.replace(/k$/u, "K");

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
 * The inputs of a `mode` value, from its name, or null for a mode that the canvas cannot run (an edit
 * or an extension of one source video). Only the inputs that the model takes stay.
 */
function modeInputs(value: string, takes: ReadonlySet<WorkflowMediaInput>): WorkflowMediaInput[] | null {
  const name = value.toLowerCase();
  const wanted: readonly WorkflowMediaInput[] | null = /^(?:t2v|text[-_]?to[-_]?video)$/u.test(name)
    ? []
    : /^(?:i2v|image[-_]?to[-_]?video)$|frame/u.test(name)
      ? ["frames"]
      : /^(?:r2v|reference[-_]?to[-_]?video)$/u.test(name)
        ? ["references", "videos", "audios"]
        : /omni|reference/u.test(name)
          ? WORKFLOW_MEDIA_INPUTS
          : null;
  return wanted ? wanted.filter((input) => takes.has(input)) : null;
}

/**
 * The modes that a person can choose: each `mode` value whose inputs the canvas knows, when there are
 * two or more of them.
 */
function chosenModes(parameter: DynamicRecord | undefined, takes: ReadonlySet<WorkflowMediaInput>) {
  const modes: WorkflowMediaMode[] = [];
  for (const value of new Set(strings(parameter?.options))) {
    const inputs = modeInputs(value, takes);
    if (inputs && isOptionValue(value) && modes.length < WORKFLOW_MEDIA_OPTION_VALUES_MAX)
      modes.push({ value, inputs });
  }
  return modes.length >= 2 ? modes : [];
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
      ? shownDurations(
          videoDurations(
            item,
            parameters.find((entry) => entry.name === "duration"),
          ),
        )
      : [];
  if (kind === "video" && durations.length === 0) return null;

  const known = KNOWN_LIMITS[id];
  const referenceRole = roles.has("image_references") ? "image_references" : roles.has("image") ? "image" : null;
  const referenceText = referenceRole ? texts.get(referenceRole) : undefined;
  const listedMax =
    medias
      .filter((media) => referenceRole !== null && strings(media.roles).includes(referenceRole))
      .map((media) => wholeNumber(media.max))
      .find((value) => value !== null) ?? null;
  const references = referenceRole
    ? (known?.references ?? listedMax ?? textLimit(referenceText) ?? DEFAULT_REFERENCES)
    : 0;
  const total =
    known?.total ??
    (referenceText && /across/iu.test(referenceText) ? (textLimit(referenceText) ?? undefined) : undefined);
  /** The role and the most files of reference videos or audio files, for a video model. */
  const clips = (candidates: readonly string[], limit: number | undefined) => {
    const role = kind === "video" ? candidates.find((name) => roles.has(name)) : undefined;
    return role ? { role, max: limit ?? textLimit(texts.get(role)) ?? DEFAULT_CLIPS } : undefined;
  };
  const videos = clips(VIDEO_ROLES, known?.videos);
  const audios = clips(AUDIO_ROLES, known?.audios);
  const takes = new Set<WorkflowMediaInput>([
    ...(roles.has("start_image") || roles.has("end_image") ? (["frames"] as const) : []),
    ...(referenceRole ? (["references"] as const) : []),
    ...(videos ? (["videos"] as const) : []),
    ...(audios ? (["audios"] as const) : []),
  ]);
  const modes = mode
    ? chosenModes(
        parameters.find((entry) => entry.name === "mode"),
        takes,
      )
    : [];
  const startText = texts.get("start_image") ?? "";
  const endText = texts.get("end_image") ?? "";
  const resolution = resolutionChoice(parameters);
  const background = parameters.find((entry) => entry.name === "background");
  const removesBackground = parameters.some((entry) => entry.name === "remove_bg");
  const transparent = kind === "image" && (strings(background?.options).includes("transparent") || removesBackground);
  // A mode that says which inputs the model takes is the first setting, with its own tile. The host
  // chooses it from the pictures when the step has no mode. A mode with other meanings is a setting.
  const modeOption =
    modes.length > 0
      ? {
          option: {
            name: WORKFLOW_MEDIA_MODE_OPTION,
            kind: "choice" as const,
            values: modes.map((entry) => entry.value),
            default: mode && modes.some((entry) => entry.value === mode.text) ? mode.text : (modes[0]?.value ?? ""),
          },
          sent: Object.fromEntries(modes.map((entry) => [entry.value, entry.value])),
        }
      : null;
  const settings = optionChoices(
    parameters.filter((entry) => entry.required !== "required"),
    new Set([...(mode ? ["mode"] : []), ...(resolution ? [resolution.param] : [])]),
    modeOption,
  );
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
    ...(modes.length > 0 ? { modes: Object.fromEntries(modes.map((entry) => [entry.value, entry.inputs])) } : {}),
    ...(videos ? { videos } : {}),
    ...(audios ? { audios } : {}),
    ...(resolution ? { resolution: { param: resolution.param, values: resolution.values } } : {}),
    ...(transparent
      ? {
          background:
            background && strings(background.options).includes("transparent")
              ? { param: "background" as const, opaque: strings(background.options).includes("opaque") }
              : { param: "remove_bg" as const },
        }
      : {}),
    ...(settings.options.length > 0 ? { options: settings.sent } : {}),
    ...(settings.defaults ? { defaults: settings.defaults } : {}),
  };
  const name = text(item.name).trim().slice(0, 160) || id;
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
      ...(settings.options.length > 0 ? { options: settings.options } : {}),
      ...(kind === "video" ? { inputs: WORKFLOW_MEDIA_INPUTS.filter((input) => takes.has(input)) } : {}),
      ...(modes.length > 0 ? { modes } : {}),
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
  seedance_2_0: {
    referenceRole: "image_references",
    references: 9,
    start: true,
    end: true,
    total: 9,
    videos: { role: "video_references", max: 3 },
    audios: { role: "audio_references", max: 3 },
  },
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
