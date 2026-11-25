import {
  isWorkflowMediaSide,
  WORKFLOW_CATALOG_SOURCES,
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_CUSTOM_ASPECT,
  WORKFLOW_MEDIA_KINDS,
  WORKFLOW_MEDIA_LEGACY_ASPECTS,
  WORKFLOW_MEDIA_MODE_OPTION,
  WORKFLOW_MEDIA_SIZE_MAX,
  WORKFLOW_MEDIA_SIZE_MIN,
  WORKFLOW_VIDEO_DURATIONS,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowFields,
  type WorkflowMediaAspect,
  type WorkflowMediaInput,
  type WorkflowMediaKind,
  type WorkflowMediaModel,
  type WorkflowMediaOption,
  type WorkflowMediaPrice,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaSize,
  workflowMediaAspects,
  workflowMediaResolutions,
  workflowMediaSpecs,
  workflowVideoDurations,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { AppTextKey } from "@openbot/i18n";
import { Play } from "@openbot/ui";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { CreditIcon } from "../credits/CreditIcon";
import { resultValue, useBoard, type WfnBoard } from "./workflow-board";
import { type InputRole, orStoredPicture, pictureUrl as storedPictureUrl } from "./workflow-input-pictures";
import { asString, oneOf, useField, useLocked, useStepRun, useTextField } from "./workflow-node-parts";

function resolutionSize(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(p|k)$/iu.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return Number(match[1]) * (match[2].toLowerCase() === "k" ? 1000 : 1);
}

export function resolutionsBySize(values: readonly string[]): string[] {
  const sized = values.map((value) => ({ value, size: resolutionSize(value) }));
  if (sized.some((entry) => entry.size === null)) return [...values];
  return sized.sort((left, right) => (left.size ?? 0) - (right.size ?? 0)).map((entry) => entry.value);
}

export type Aspect = WorkflowMediaAspect;
export type Frame = Aspect | typeof WORKFLOW_MEDIA_CUSTOM_ASPECT;
const FRAMES: readonly Frame[] = [...WORKFLOW_MEDIA_ASPECTS, WORKFLOW_MEDIA_CUSTOM_ASPECT];

const asSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
const asText = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const asSide = (value: unknown): number | undefined => (isWorkflowMediaSide(value) ? value : undefined);

export const MEDIA_BATCH_SIZES = [1, 2, 3, 4] as const;
const asBatch = (value: unknown): number | undefined =>
  typeof value === "number" && MEDIA_BATCH_SIZES.some((size) => size === value) ? value : undefined;
export const mediaTakes = (value: unknown) => asBatch(value) ?? 1;

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

const MODE_NAMES: Readonly<Record<string, AppTextKey>> = {
  t2v: "workflow.video.mode.text",
  "text-to-video": "workflow.video.mode.text",
  i2v: "workflow.video.mode.image",
  "image-to-video": "workflow.video.mode.image",
  r2v: "workflow.video.mode.reference",
  "reference-to-video": "workflow.video.mode.reference",
  omni_reference: "workflow.video.mode.omni",
};

export const modeNameKey = (value: string): AppTextKey | null => MODE_NAMES[value] ?? null;

const VALUE_NAMES: Readonly<Record<string, AppTextKey>> = {
  auto: "workflow.video.modeAuto",
  std: "workflow.media.value.standard",
  standard: "workflow.media.value.standard",
  fast: "workflow.media.value.fast",
  high: "workflow.media.value.high",
  on: "workflow.media.value.on",
  off: "workflow.media.value.off",
};

export const optionValueKey = (value: string): AppTextKey | null => VALUE_NAMES[value] ?? null;

const PICTURE_INPUTS: readonly WorkflowMediaInput[] = ["frames", "references"];

function shownMediaInputs(
  model: Pick<WorkflowMediaModel, "inputs" | "modes"> | undefined,
  mode: string,
): readonly WorkflowMediaInput[] {
  const chosen = model?.modes?.find((entry) => entry.value === mode);
  return chosen?.inputs ?? model?.inputs ?? PICTURE_INPUTS;
}

export function readableName(value: string): string {
  const words = value
    .replace(/(\d)[_-](?=\d)/gu, "$1.")
    .replace(/[_-]+/gu, " ")
    .replace(/\b[A-Z]{2,}\b/gu, (word) => word.toLowerCase())
    .replace(/\b(\d+(?:\.\d+)?)k\b/gu, "$1K")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

export interface MediaStepOption {
  option: WorkflowMediaOption;
  value: string;
}

export const optionNameKey = (option: WorkflowMediaOption): AppTextKey | null => OPTION_NAMES[option.name] ?? null;

function storedOptions(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value) return {};
  try {
    return textEntries(JSON.parse(value));
  } catch {
    return {};
  }
}

function textEntries(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

const BACKGROUNDS = ["solid", "transparent"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const BACKGROUND_TEXT = {
  solid: "workflow.image.background.solid",
  transparent: "workflow.image.background.transparent",
} as const satisfies Record<Background, AppTextKey>;

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

export function typedSide(text: string, current: number): number {
  const value = Math.round(Number(text));
  if (!text.trim() || !Number.isFinite(value)) return current;
  return Math.min(WORKFLOW_MEDIA_SIZE_MAX, Math.max(WORKFLOW_MEDIA_SIZE_MIN, value));
}

const openQuotes = new WeakMap<WfnBoard, Map<string, Promise<WorkflowMediaPrice>>>();

function sharedQuote(
  board: WfnBoard,
  choices: string,
  quote: (request: WorkflowMediaPriceRequest) => Promise<WorkflowMediaPrice>,
  request: WorkflowMediaPriceRequest,
) {
  const open = openQuotes.get(board) ?? new Map<string, Promise<WorkflowMediaPrice>>();
  openQuotes.set(board, open);
  const known = open.get(choices);
  if (known) return known;
  const asked = quote(request).finally(() => open.delete(choices));
  open.set(choices, asked);
  return asked;
}

function useMediaPrice(request: () => WorkflowMediaPriceRequest | null) {
  const board = useBoard();
  const [credits, setCredits] = createSignal<number | null>(null);
  let asked = 0;
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
    sharedQuote(board, choices, quote, next).then(
      (answer) => {
        if (sent === asked) setCredits(answer.credits);
      },
      () => undefined,
    );
  });
  return credits;
}

export function useMediaStep(id: string, defaults: { prompt?: string | undefined; aspect?: Aspect | undefined } = {}) {
  const board = useBoard();
  const { t, format } = useText();
  const key = () => id;
  const [kind] = useField<WorkflowMediaKind>(key, "media", "image", oneOf(WORKFLOW_MEDIA_KINDS));
  const [prompt, setPrompt] = useTextField(key, "prompt", defaults.prompt ?? "");
  const [aspect] = useField<Frame>(key, "aspect", defaults.aspect ?? "1:1", oneOf(FRAMES));
  const sizeHost = () => board.catalogs().mediaSize === true;
  const customAllowed = () => kind() === "image" && sizeHost();
  const hostAspect = (frame: Frame) =>
    sizeHost() || WORKFLOW_MEDIA_LEGACY_ASPECTS.some((legacy) => legacy === frame) ? frame : "";
  const [, setDuration] = useField<number>(key, "duration", WORKFLOW_VIDEO_DURATIONS[0], asSeconds);
  const storedDuration = (): WorkflowFields => {
    const seconds = asSeconds(board.field(id, "duration"));
    return seconds === undefined ? {} : { duration: seconds };
  };
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
  const modelMissing = () => board.catalogs().imageModelsReady === true && modelId() !== "" && model() === undefined;
  const savedModelName = () =>
    model() === undefined
      ? board.catalogs().unavailableModels?.find((entry) => entry.id === modelId() && entry.kinds.includes(kind()))
          ?.name
      : undefined;
  const aspects = () => workflowMediaAspects(model(), kind()).filter((value) => hostAspect(value) !== "");
  const [account] = useField(key, "account", "", asString);
  const specs = () =>
    workflowMediaSpecs(
      {
        aspect: hostAspect(aspect()),
        width: board.field(id, "width") ?? 0,
        height: board.field(id, "height") ?? 0,
        ...storedDuration(),
        resolution: resolution(),
        background: background(),
        options: optionsField(),
      },
      kind(),
      model(),
    );
  const options = (): readonly MediaStepOption[] => {
    const chosen = new Map(specs().options.map((entry) => [entry.name, entry.value]));
    return (model()?.options ?? [])
      .filter((option) => option.name !== WORKFLOW_MEDIA_MODE_OPTION || !model()?.modes)
      .map((option) => ({ option, value: chosen.get(option.name) ?? option.default }));
  };
  const setOption = (name: string, value: string) => {
    const { [name]: _removed, ...kept } = storedOptions(optionsField());
    board.setField(id, "options", JSON.stringify(value === "" ? kept : { ...kept, [name]: value }));
  };
  const modes = () => (kind() === "video" ? (model()?.modes ?? []) : []);
  const mode = () => specs().options.find((entry) => entry.name === WORKFLOW_MEDIA_MODE_OPTION)?.value ?? "";
  const setMode = (value: string) => setOption(WORKFLOW_MEDIA_MODE_OPTION, value);
  const mediaInputs = () => shownMediaInputs(model(), mode());
  const frameCount = () => (kind() === "video" ? model()?.frameCount : undefined);
  const resolutions = () => resolutionsBySize(workflowMediaResolutions(model(), kind()));
  const durations = () => workflowVideoDurations(model());
  const price = useMediaPrice(() => {
    const chosen = model();
    if (!chosen?.credits || !isOneOf(WORKFLOW_CATALOG_SOURCES, chosen.provider)) return null;
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
  const [batch, setBatch] = useField<number>(key, "batch", 1, asBatch);
  const total = () => {
    const credits = price();
    return credits === null ? null : credits * batch();
  };
  const balance = () => (model()?.provider === "openbot" ? board.catalogs().creditBalance : undefined);
  const exceeds = (credits: number | null) => {
    const available = balance();
    return typeof available === "number" && credits !== null && credits > available;
  };
  const short = () => exceeds(total());
  const retryShort = () => exceeds(price());
  const priced = (label: string, isShort: boolean) =>
    isShort ? [t("billing.credits.notEnough"), label].join(", ") : label;
  const runLabel = () => {
    const credits = total();
    return credits === null || modelMissing()
      ? undefined
      : priced(t("workflow.node.runPriceLabel", { credits: format.number(credits) }), short());
  };
  const retryLabel = () => {
    const credits = price();
    return credits === null
      ? undefined
      : priced(t("workflow.node.retryPriceLabel", { credits: format.number(credits) }), retryShort());
  };
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
  const inputs = () => board.inputs(id, "image");
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
  const busy = () => run.running() || board.pending(id).length > 0;
  const orFile = (made: string | null | undefined, value: string) => orStoredPicture(board, made, value);
  const pictureUrl = (value: string) => storedPictureUrl(board, value);
  const inputUrl = (source: string) => {
    const shown = board.shown(source);
    const file = board.field(source, "fileId");
    const value = shown && !shown.failed ? resultValue(shown) : typeof file === "string" && file ? file : undefined;
    if (value !== undefined) return pictureUrl(value) ?? undefined;
    const name = board.field(source, "file");
    return typeof name === "string" && name ? (orStoredPicture(board, undefined, name) ?? undefined) : undefined;
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
    modelMissing,
    savedModelName,
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
    frameCount,
    price,
    total,
    batch,
    setBatch,
    short,
    retryShort,
    runLabel,
    retryLabel,
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
    busy,
    specsDisabled: () => locked() || busy(),
    orFile,
    pictureUrl,
    inputUrl,
  };
}

export type MediaStep = ReturnType<typeof useMediaStep>;

export const resolutionName = (value: string) => value.replace(/k$/u, "K");

export function RunContent(props: { credits: number | null; takes?: number; modelMissing?: boolean }) {
  const { t, format } = useText();
  return (
    <Show when={!props.modelMissing} fallback={t("workflow.image.modelUnavailable")}>
      <Show
        when={props.credits !== null}
        fallback={
          <>
            <Play aria-hidden="true" />
            {t("workflow.node.run")}
          </>
        }
      >
        <CreditIcon class="wfn-run-credits-icon" />
        {format.number(props.credits ?? 0)}
      </Show>
      <Show when={(props.takes ?? 1) > 1}>
        <span class="wfn-run-takes">{t("workflow.media.batchCount", { value: String(props.takes) })}</span>
      </Show>
    </Show>
  );
}
