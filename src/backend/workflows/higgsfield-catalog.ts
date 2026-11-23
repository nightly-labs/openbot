import {
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX,
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

export interface HiggsfieldPlan {
  referenceRole: string | null;
  references: number;
  start: boolean;
  end: boolean;
  total?: number;
  exclusive?: boolean;
  endNeedsStart?: boolean;
  mode?: { text: string; frames: string | null; references: string | null };
  modes?: Readonly<Record<string, readonly WorkflowMediaInput[]>>;
  videos?: { role: string; max: number };
  audios?: { role: string; max: number };
  resolution?: { param: string; values: Readonly<Record<string, string>> };
  background?: { param: "background"; opaque: boolean } | { param: "remove_bg" };
  options?: Readonly<Record<string, Readonly<Record<string, string | boolean>>>>;
  defaults?: Readonly<Record<string, string>>;
}

export interface HiggsfieldCatalogEntry {
  model: WorkflowMediaCatalogModel;
  plan: HiggsfieldPlan;
}

const IMAGE_ROLES = ["start_image", "end_image", "image_references", "image"] as const;
const VIDEO_ROLES = ["video_references", "video"] as const;
const AUDIO_ROLES = ["audio_references", "audio"] as const;
const DEFAULT_CLIPS = 3;
const DEFAULT_REFERENCES = 16;
const SIZE_OPTION = /^\d+(?:\.\d+)?k$|^\d+p$/iu;
const NEEDS_INPUT = /exactly one(?![^.|]*\bfor (?:edit|extend)\b)/iu;

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

function roleTexts(description: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const part of description.replace(/^Media roles:\s*/iu, "").split(" | ")) {
    const match = /^\s*([a-z_]+)\s+—\s+(.*)$/su.exec(part);
    if (match?.[1] && match[2] !== undefined) texts.set(match[1], match[2]);
  }
  return texts;
}

function textLimit(value: string | undefined): number | null {
  const match = value ? /(?:max|at most|up to)\s+(\d+)/iu.exec(value) : null;
  return match?.[1] ? Number(match[1]) : null;
}

export function canvasAspects(value: unknown): WorkflowMediaAspect[] {
  const listed = new Set(strings(value));
  return WORKFLOW_MEDIA_ASPECTS.filter((aspect) => listed.has(aspect));
}

export function catalogDurations(all: readonly number[]): number[] {
  const sorted = [...new Set(all)].sort((left, right) => left - right);
  const max = WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX;
  if (sorted.length <= max) return sorted;
  const step = (sorted.length - 1) / (max - 1);
  const kept = new Set(Array.from({ length: max }, (_, place) => Math.round(place * step)));
  return sorted.filter((_, index) => kept.has(index));
}

const range = (min: number, max: number) =>
  max >= min && max - min <= 120 ? Array.from({ length: max - min + 1 }, (_, index) => min + index) : [];

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
  "extension_mode",
  "draft_job_id",
  "output_format",
  "prompt_language",
  "folder_id",
]);
const OPTION_NAME = /^[a-z][a-z0-9_]{0,63}$/iu;
const isOptionValue = (value: string) => value.length > 0 && value.length <= WORKFLOW_MEDIA_OPTION_TEXT_MAX;

const NEEDS_MORE = new Set(["custom", "user"]);
const SERVICE_CHOICE = "auto";
const CANVAS_DEFAULTS: Readonly<Record<string, string>> = { bitrate_mode: "high" };

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
  const preferred = CANVAS_DEFAULTS[name];
  if (preferred !== undefined && options.includes(preferred)) {
    if (options.length > WORKFLOW_MEDIA_OPTION_VALUES_MAX || !options.every(isOptionValue)) return null;
    return {
      option: { name, kind: "choice", values: options, default: preferred },
      sent: Object.fromEntries(options.map((value) => [value, value])),
    };
  }
  const chosen = options.includes(fallback) ? fallback : SERVICE_CHOICE;
  const shown = options.includes(chosen) ? options : [SERVICE_CHOICE, ...options];
  if (shown.length > WORKFLOW_MEDIA_OPTION_VALUES_MAX || !options.every(isOptionValue)) return null;
  return {
    option: { name, kind: "choice", values: shown, default: chosen },
    sent: Object.fromEntries(options.map((value) => [value, value])),
  };
}

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

function idName(id: string): string {
  const words: string[] = [];
  for (const word of id.split(/[_-]+/u).filter(Boolean)) {
    const last = words.at(-1);
    if (last !== undefined && /\d$/u.test(last) && /^\d+$/u.test(word)) words[words.length - 1] = `${last}.${word}`;
    else words.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return words.join(" ") || id;
}

const canvasResolution = (value: string) => value.replace(/k$/u, "K");

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

function chosenModes(parameter: DynamicRecord | undefined, takes: ReadonlySet<WorkflowMediaInput>) {
  const modes: WorkflowMediaMode[] = [];
  for (const value of new Set(strings(parameter?.options))) {
    const inputs = modeInputs(value, takes);
    if (inputs && isOptionValue(value) && modes.length < WORKFLOW_MEDIA_OPTION_VALUES_MAX)
      modes.push({ value, inputs });
  }
  return modes.length >= 2 ? modes : [];
}

export function higgsfieldCatalogEntry(item: DynamicRecord): HiggsfieldCatalogEntry | null {
  const id = text(item.id);
  const kind: WorkflowMediaKind | null =
    item.output_type === "image" ? "image" : item.output_type === "video" ? "video" : null;
  if (!/^[a-z0-9_.-]{1,117}$/iu.test(id) || !kind) return null;
  const aspects = canvasAspects(item.aspect_ratios);
  if (aspects.length === 0) return null;
  const parameters = records(item.parameters);
  const mode = modeChoice(parameters.find((entry) => entry.name === "mode"));
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
      ...(settings.options.length > 0 ? { options: settings.options } : {}),
      ...(kind === "video" ? { inputs: WORKFLOW_MEDIA_INPUTS.filter((input) => takes.has(input)) } : {}),
      ...(kind === "video" && takes.has("frames") ? { frameCount: roles.has("end_image") ? 2 : 1 } : {}),
      ...(modes.length > 0 ? { modes } : {}),
    },
    plan,
  };
}

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

export function higgsfieldFixedPlan(model: string, kind: WorkflowMediaKind): HiggsfieldPlan {
  return FIXED_PLANS[model] ?? { referenceRole: null, references: 0, start: kind === "video", end: kind === "video" };
}
