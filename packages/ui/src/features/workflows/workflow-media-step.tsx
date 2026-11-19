/**
 * The state of a media step (an image or a video that a model makes), as the card and the composer
 * under the selected card read it: the model, the choices that the model makes, the price and the
 * pictures that come in.
 */

import {
  isWorkflowMediaSide,
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_CUSTOM_ASPECT,
  WORKFLOW_MEDIA_KINDS,
  WORKFLOW_MEDIA_LEGACY_ASPECTS,
  WORKFLOW_MEDIA_MODE_OPTION,
  WORKFLOW_MEDIA_SIZE_MAX,
  WORKFLOW_MEDIA_SIZE_MIN,
  WORKFLOW_VIDEO_DURATIONS,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowMediaAspect,
  type WorkflowMediaInput,
  type WorkflowMediaKind,
  type WorkflowMediaModel,
  type WorkflowMediaOption,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaSize,
  workflowMediaAspects,
  workflowMediaResolutions,
  workflowMediaSpecs,
  workflowVideoDurations,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createSignal, untrack } from "solid-js";
import { useText } from "../../text";
import { resultValue, useBoard } from "./workflow-board";
import { asString, oneOf, useField, useLocked, useStepRun, useTextField } from "./workflow-node-parts";

/** The size of a resolution name such as "720p" or "2K" (1000 for each K), or null for another name. */
function resolutionSize(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(p|k)$/iu.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return Number(match[1]) * (match[2].toLowerCase() === "k" ? 1000 : 1);
}

/**
 * The resolutions from the smallest to the largest. The catalog puts the default first; the choices
 * show the sizes in order. A list with a name that is not a size keeps its order.
 */
export function resolutionsBySize(values: readonly string[]): string[] {
  const sized = values.map((value) => ({ value, size: resolutionSize(value) }));
  if (sized.some((entry) => entry.size === null)) return [...values];
  return sized.sort((left, right) => (left.size ?? 0) - (right.size ?? 0)).map((entry) => entry.value);
}

export type Aspect = WorkflowMediaAspect;
/** The frame of a step: an aspect ratio of the model, or a size of its own in pixels. */
export type Frame = Aspect | typeof WORKFLOW_MEDIA_CUSTOM_ASPECT;
const FRAMES: readonly Frame[] = [...WORKFLOW_MEDIA_ASPECTS, WORKFLOW_MEDIA_CUSTOM_ASPECT];

/** A length in whole seconds. The model of the step sets which lengths it takes. */
const asSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
const asText = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const asSide = (value: unknown): number | undefined => (isWorkflowMediaSide(value) ? value : undefined);

/** The size that a custom frame starts at: the aspect ratio that the step had, in common pixels. */
const CUSTOM_START = {
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "5:4": { width: 1350, height: 1080 },
  "21:9": { width: 2520, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
} as const satisfies Record<Aspect, WorkflowMediaSize>;

export const ASPECT_SHAPE = {
  "1:1": "workflow.image.aspect.square",
  "4:3": "workflow.image.aspect.landscape",
  "16:9": "workflow.image.aspect.wide",
  "9:16": "workflow.image.aspect.portrait",
  "4:5": "workflow.image.aspect.post",
  "5:4": "workflow.image.aspect.print",
  "21:9": "workflow.image.aspect.cinema",
  "3:4": "workflow.image.aspect.tall",
} as const satisfies Record<Aspect, AppTextKey>;

/**
 * The names of the settings that many models share. The name of another setting is the parameter
 * name of the service, made readable: "camera_motion" is "Camera motion".
 */
const OPTION_NAMES: Readonly<Record<string, AppTextKey>> = {
  generate_audio: "workflow.media.option.sound",
  sound: "workflow.media.option.sound",
  audio: "workflow.media.option.sound",
  bitrate_mode: "workflow.media.option.bitrate",
  genre: "workflow.media.option.genre",
  mode: "workflow.media.option.mode",
  quality: "workflow.media.option.quality",
  variant: "workflow.media.option.variant",
  style: "workflow.media.option.style",
  enhance_prompt: "workflow.media.option.enhancePrompt",
  prompt_optimizer: "workflow.media.option.enhancePrompt",
};

/** The names of the modes that a service gives a video model. Another mode shows as `readableName` gives it. */
const MODE_NAMES: Readonly<Record<string, AppTextKey>> = {
  t2v: "workflow.video.mode.text",
  "text-to-video": "workflow.video.mode.text",
  i2v: "workflow.video.mode.image",
  "image-to-video": "workflow.video.mode.image",
  r2v: "workflow.video.mode.reference",
  "reference-to-video": "workflow.video.mode.reference",
  omni_reference: "workflow.video.mode.omni",
};

/** The text key of a mode that has one, else null. */
export const modeNameKey = (value: string): AppTextKey | null => MODE_NAMES[value] ?? null;

/** The names of the setting values that many models share. Another value shows as `readableName` gives it. */
const VALUE_NAMES: Readonly<Record<string, AppTextKey>> = {
  auto: "workflow.video.modeAuto",
  std: "workflow.media.value.standard",
  standard: "workflow.media.value.standard",
  fast: "workflow.media.value.fast",
  high: "workflow.media.value.high",
  on: "workflow.media.value.on",
  off: "workflow.media.value.off",
};

/** The text key of a setting value that has one, else null. */
export const optionValueKey = (value: string): AppTextKey | null => VALUE_NAMES[value] ?? null;

/** The inputs of a video model from a host that does not list them: the frames and the references. */
const PICTURE_INPUTS: readonly WorkflowMediaInput[] = ["frames", "references"];

/**
 * The inputs that a video step shows: those of its chosen mode, else every input of the model. With
 * no mode, the host chooses the mode from the inputs that come in.
 */
export function shownMediaInputs(
  model: Pick<WorkflowMediaModel, "inputs" | "modes"> | undefined,
  mode: string,
): readonly WorkflowMediaInput[] {
  const chosen = model?.modes?.find((entry) => entry.value === mode);
  return chosen?.inputs ?? model?.inputs ?? PICTURE_INPUTS;
}

/** A parameter name or value of a service, made readable: "camera_motion" is "Camera motion". */
export function readableName(value: string): string {
  const words = value
    // A version: "veo-3-1-preview" is "Veo 3.1 preview".
    .replace(/(\d)[_-](?=\d)/gu, "$1.")
    .replace(/[_-]+/gu, " ")
    // A word in capitals: "MINIMAL" is "Minimal".
    .replace(/\b[A-Z]{2,}\b/gu, (word) => word.toLowerCase())
    // A size: "4k" is "4K".
    .replace(/\b(\d+(?:\.\d+)?)k\b/gu, "$1K")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/** A setting of the model and the value that the step uses. */
export interface MediaStepOption {
  option: WorkflowMediaOption;
  value: string;
}

/** The text key of a setting that has one, else null: the name is shown as `readableName` gives it. */
export const optionNameKey = (option: WorkflowMediaOption): AppTextKey | null => OPTION_NAMES[option.name] ?? null;

/** The chosen settings that the `options` field keeps, by name. A field that is not an object gives none. */
function storedOptions(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value) return {};
  try {
    return textEntries(JSON.parse(value));
  } catch {
    return {};
  }
}

/** The entries of an object whose value is a text. A value that is not an object gives none. */
function textEntries(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** The background of an image: the model's own, or clear pixels around the subject. */
export const BACKGROUNDS = ["solid", "transparent"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const BACKGROUND_TEXT = {
  solid: "workflow.image.background.solid",
  transparent: "workflow.image.background.transparent",
} as const satisfies Record<Background, AppTextKey>;

/** The text of each media kind. */
export const KIND_TEXT = {
  image: {
    title: "workflow.image.title",
    name: "workflow.image.name",
    download: "workflow.image.download",
    description: "workflow.image.description",
    placeholder: "workflow.image.descriptionPlaceholder",
    models: "workflow.image.models",
  },
  video: {
    title: "workflow.video.title",
    name: "workflow.video.name",
    download: "workflow.video.download",
    description: "workflow.video.description",
    placeholder: "workflow.video.descriptionPlaceholder",
    models: "workflow.video.models",
  },
} as const satisfies Record<WorkflowMediaKind, Record<string, AppTextKey>>;

/** How a video uses a picture that comes in: as a reference, or as its first frame, its last frame or both. */
export type InputRole = "reference" | "first" | "last" | "both";

export const ROLE_TEXT = {
  reference: "workflow.video.role.reference",
  first: "workflow.video.role.first",
  last: "workflow.video.role.last",
  both: "workflow.video.role.both",
} as const satisfies Record<InputRole, AppTextKey>;

/** The short mark on a picture that is a frame. A reference has none. */
export const ROLE_BADGE = {
  first: "workflow.video.badge.first",
  last: "workflow.video.badge.last",
  both: "workflow.video.badge.both",
} as const satisfies Record<Exclude<InputRole, "reference">, AppTextKey>;

/** A side that the user typed, kept in range; the side that it had for text that is not a number. */
export function typedSide(text: string, current: number): number {
  const value = Math.round(Number(text));
  if (!text.trim() || !Number.isFinite(value)) return current;
  return Math.min(WORKFLOW_MEDIA_SIZE_MAX, Math.max(WORKFLOW_MEDIA_SIZE_MIN, value));
}

/** A time as minutes and seconds, such as 0:07. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The whole seconds since `running` became true, while it stays true. */
export function useElapsed(running: () => boolean) {
  const [now, setNow] = createSignal(0);
  let start = 0;
  createEffect(running, (on) => {
    if (!on) return;
    start = performance.now();
    setNow(start);
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  });
  return () => Math.max(0, Math.floor((now() - start) / 1000));
}

/**
 * The price of one file with the choices of the step, in the credits of the service, or null while
 * there is no quote. It asks again when a choice changes; an answer for older choices is dropped.
 */
function useMediaPrice(request: () => WorkflowMediaPriceRequest | null) {
  const board = useBoard();
  const [credits, setCredits] = createSignal<number | null>(null);
  let asked = 0;
  /** The choices as one string, so a new object with the same choices does not ask again. */
  const key = () => {
    const next = request();
    return next && board.catalogs().mediaPrice ? JSON.stringify(next) : null;
  };
  createEffect(key, (choices) => {
    asked += 1;
    const sent = asked;
    setCredits(null);
    const next = untrack(request);
    const quote = untrack(() => board.catalogs().mediaPrice);
    if (!choices || !next || !quote) return;
    quote(next).then(
      (answer) => {
        if (sent === asked) setCredits(answer.credits);
      },
      () => undefined,
    );
  });
  return credits;
}

/** The state of one media step. `defaults` are the fields of a node that has not stored them yet. */
export function useMediaStep(id: string, defaults: { prompt?: string | undefined; aspect?: Aspect | undefined } = {}) {
  const board = useBoard();
  const { t, format } = useText();
  const key = () => id;
  const [kind] = useField<WorkflowMediaKind>(key, "media", "image", oneOf(WORKFLOW_MEDIA_KINDS));
  const [prompt, setPrompt] = useTextField(key, "prompt", defaults.prompt ?? "");
  const [aspect] = useField<Frame>(key, "aspect", defaults.aspect ?? "1:1", oneOf(FRAMES));
  /**
   * A host without `workflows-media-size-v1` reads a custom frame, 4:5 and 5:4 as the first aspect
   * ratio of the model, so the canvas offers them only on a host with it and shows what an older host makes.
   */
  const sizeHost = () => board.catalogs().mediaSize === true;
  const customAllowed = () => kind() === "image" && sizeHost();
  const hostAspect = (frame: Frame) =>
    sizeHost() || WORKFLOW_MEDIA_LEGACY_ASPECTS.some((legacy) => legacy === frame) ? frame : "";
  const [duration, setDuration] = useField<number>(key, "duration", WORKFLOW_VIDEO_DURATIONS[0], asSeconds);
  const [resolution, setResolution] = useField<string>(key, "resolution", "720p", asText);
  const [background, setBackground] = useField<Background>(key, "background", "solid", oneOf(BACKGROUNDS));
  const [optionsField] = useField(key, "options", "", asString);
  const models = () => board.catalogs().imageModels.filter((choice) => choice.kinds.includes(kind()));
  const [modelId] = useField(
    key,
    "model",
    untrack(() => models()[0]?.id ?? ""),
    asString,
  );
  const model = () => models().find((candidate) => candidate.id === modelId());
  const aspects = () => workflowMediaAspects(model(), kind()).filter((value) => hostAspect(value) !== "");
  /** The account of the model's provider that pays, or "" for the provider's own sign-in. */
  const [account] = useField(key, "account", "", asString);
  /** What the model gets: a choice that it does not make shows as the one it makes in its place. */
  const specs = () =>
    workflowMediaSpecs(
      {
        aspect: hostAspect(aspect()),
        // The stored sides with no default: a missing (0) or out of range side gives no custom size, as on the host.
        width: board.field(id, "width") ?? 0,
        height: board.field(id, "height") ?? 0,
        duration: duration(),
        resolution: resolution(),
        background: background(),
        options: optionsField(),
      },
      kind(),
      model(),
    );
  /**
   * The settings of the model, with the value that the step uses: its choice, else the default. The
   * mode has its own tile.
   */
  const options = (): readonly MediaStepOption[] => {
    const chosen = new Map(specs().options.map((entry) => [entry.name, entry.value]));
    return (model()?.options ?? [])
      .filter((option) => option.name !== WORKFLOW_MEDIA_MODE_OPTION || !model()?.modes)
      .map((option) => ({ option, value: chosen.get(option.name) ?? option.default }));
  };
  /**
   * Keeps a setting, or with "" removes it. The other models' choices stay, so a model that comes back
   * has them again.
   */
  const setOption = (name: string, value: string) => {
    const { [name]: _removed, ...kept } = storedOptions(optionsField());
    board.setField(id, "options", JSON.stringify(value === "" ? kept : { ...kept, [name]: value }));
  };
  /** The modes of a video model that has them (`workflows-media-catalog-v2`). */
  const modes = () => (kind() === "video" ? (model()?.modes ?? []) : []);
  /** The chosen mode, or "" when the host chooses it from the inputs. */
  const mode = () => specs().options.find((entry) => entry.name === WORKFLOW_MEDIA_MODE_OPTION)?.value ?? "";
  const setMode = (value: string) => setOption(WORKFLOW_MEDIA_MODE_OPTION, value);
  /** The inputs that the step shows now, from its mode. */
  const mediaInputs = () => shownMediaInputs(model(), mode());
  /** The resolution choices, by size. The default stays the first value of the model. */
  const resolutions = () => resolutionsBySize(workflowMediaResolutions(model(), kind()));
  const durations = () => workflowVideoDurations(model());
  /** A Sunra or Higgsfield step shows what one file costs with its choices. */
  const price = useMediaPrice(() => {
    const chosen = model();
    if (!chosen?.credits || (chosen.provider !== "sunra" && chosen.provider !== "higgsfield")) return null;
    const { aspect, duration, resolution, transparent, options } = specs();
    return {
      model: chosen.id,
      kind: kind(),
      aspect,
      duration,
      resolution,
      transparent,
      ...(options.length > 0 ? { options } : {}),
    };
  });
  const runText = () => {
    const credits = price();
    return credits === null ? t("workflow.node.run") : t("workflow.node.runPrice", { credits: format.number(credits) });
  };
  const runLabel = () => {
    const credits = price();
    return credits === null ? undefined : t("workflow.node.runPriceLabel", { credits: format.number(credits) });
  };
  /** Sets an aspect ratio, or a custom size that starts at the shape of the aspect ratio on view. */
  const chooseFrame = (frame: Frame) => {
    if (frame !== WORKFLOW_MEDIA_CUSTOM_ASPECT) {
      board.setField(id, "aspect", frame);
      return;
    }
    const kept = asSide(board.field(id, "width")) !== undefined && asSide(board.field(id, "height")) !== undefined;
    board.setFields(id, { aspect: frame, ...(kept ? {} : CUSTOM_START[specs().aspect]) });
  };
  const [firstFrame] = useField(key, "firstFrame", "", asString);
  const [lastFrame] = useField(key, "lastFrame", "", asString);
  const [voice, setVoice] = useField(key, "voice", "", asString);
  /** The image steps that give this step a picture, in connection order. The host reads them the same way. */
  const inputs = () => board.inputs(id, "image");
  /** A step runs with no description when a text or a picture comes in: the host makes the media from them. */
  const runnable = () =>
    prompt().trim() !== "" ||
    inputs().length > 0 ||
    board.inputs(id, "text").length > 0 ||
    (kind() === "video" && board.inputs(id, "file").length > 0);
  const roleOf = (source: string): InputRole => {
    if (kind() !== "video") return "reference";
    const first = firstFrame() === source;
    const last = lastFrame() === source;
    if (first && last) return "both";
    if (first) return "first";
    return last ? "last" : "reference";
  };
  const voiceName = () => WORKFLOW_VIDEO_VOICES.find((preset) => preset.id === voice())?.name;
  const voiceText = () => voiceName() ?? t("workflow.video.voiceAuto");
  const [locked, setLocked] = useLocked(key);
  const run = useStepRun(id);
  /** A workspace image by name, as a host without media results gives it. */
  const fileUrl = (value: string) =>
    board.catalogs().files.find((file) => file.name === value && file.previewKind === "image")?.previewUrl ?? undefined;
  const orFile = (made: string | null | undefined, value: string) => made ?? fileUrl(value) ?? made;
  /**
   * The small copy of a picture, which the card, its strip and its inputs show. A host that sends
   * it gives no full file here, so the card does not download both. The viewer and a download read
   * the file.
   */
  const pictureUrl = (value: string) => {
    const preview = board.catalogs().mediaPreview;
    return orFile(preview ? preview(value) : board.catalogs().media?.(value, "image"), value);
  };
  /**
   * The picture of an image step's newest result, or the file of an asset. An asset saved before files
   * had ids has only the name of its file.
   */
  const inputUrl = (source: string) => {
    const shown = board.shown(source);
    const file = board.field(source, "fileId");
    const value = shown && !shown.failed ? resultValue(shown) : typeof file === "string" && file ? file : undefined;
    if (value !== undefined) return pictureUrl(value) ?? undefined;
    const name = board.field(source, "file");
    return typeof name === "string" && name ? fileUrl(name) : undefined;
  };
  return {
    kind,
    prompt,
    setPrompt,
    customAllowed,
    aspects,
    setDuration,
    setResolution,
    setBackground,
    models,
    model,
    account,
    specs,
    resolutions,
    durations,
    options,
    setOption,
    modes,
    mode,
    setMode,
    mediaInputs,
    price,
    runText,
    runLabel,
    chooseFrame,
    voice,
    setVoice,
    voiceText,
    inputs,
    runnable,
    roleOf,
    locked,
    setLocked,
    run,
    /** The settings and the model wait while the step is locked or makes its file. */
    specsDisabled: () => locked() || run.running(),
    orFile,
    pictureUrl,
    inputUrl,
  };
}

export type MediaStep = ReturnType<typeof useMediaStep>;
