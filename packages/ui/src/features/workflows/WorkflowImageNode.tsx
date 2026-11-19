/** A media step: an image or a video that a model makes from a description. */

import {
  isWorkflowMediaSide,
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_CUSTOM_ASPECT,
  WORKFLOW_MEDIA_KINDS,
  WORKFLOW_MEDIA_LEGACY_ASPECTS,
  WORKFLOW_MEDIA_SIZE_MAX,
  WORKFLOW_MEDIA_SIZE_MIN,
  WORKFLOW_VIDEO_DURATIONS,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowMediaAspect,
  type WorkflowMediaKind,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaSize,
  workflowMediaAspects,
  workflowMediaResolutions,
  workflowMediaSpecs,
  workflowVideoDurations,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Button,
  Download,
  DropdownMenu,
  Film,
  Image,
  Input,
  Label,
  Maximize2,
  Mic,
  Minimize2,
  Play,
  Popover,
  Square,
  Textarea,
  Type,
  Zap,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
import { MediaGenerationCanvas } from "../conversation/media-generation-frame";
import { VideoPlayer } from "../conversation/VideoPlayer";
import { usePictureShape } from "./picture-shape";
import { MediaModelPicker } from "./WorkflowMediaModelPicker";
import { type PickerGroup, PickerMenu, type PickerOption } from "./WorkflowPicker";
import { resultValue, useBoard } from "./workflow-board";
import {
  asBoolean,
  asString,
  download,
  NodeShell,
  NodeToolbar,
  oneOf,
  ToolAction,
  useField,
  useLocked,
  useStepRun,
  useTextField,
  type WfnInputPort,
} from "./workflow-node-parts";
import { CardPicture, CardPictureLoading } from "./workflow-picture";

type Aspect = WorkflowMediaAspect;
/** The frame of a step: an aspect ratio of the model, or a size of its own in pixels. */
type Frame = Aspect | typeof WORKFLOW_MEDIA_CUSTOM_ASPECT;
const FRAMES: readonly Frame[] = [...WORKFLOW_MEDIA_ASPECTS, WORKFLOW_MEDIA_CUSTOM_ASPECT];

/** A length in whole seconds. The model of the step sets which lengths it takes. */
const asSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
const asText = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const asSide = (value: unknown): number | undefined => (isWorkflowMediaSide(value) ? value : undefined);

function aspectRatio(aspect: Aspect): string {
  return aspect.replace(":", " / ");
}

/** The size that a custom frame starts at: the aspect ratio that the step had, in common pixels. */
const CUSTOM_START = {
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "5:4": { width: 1350, height: 1080 },
} as const satisfies Record<Aspect, WorkflowMediaSize>;

const ASPECT_SHAPE = {
  "1:1": "workflow.image.aspect.square",
  "4:3": "workflow.image.aspect.landscape",
  "16:9": "workflow.image.aspect.wide",
  "9:16": "workflow.image.aspect.portrait",
  "4:5": "workflow.image.aspect.post",
  "5:4": "workflow.image.aspect.print",
} as const satisfies Record<Aspect, AppTextKey>;

/** The background of an image: the model's own, or clear pixels around the subject. */
const BACKGROUNDS = ["solid", "transparent"] as const;
type Background = (typeof BACKGROUNDS)[number];

const BACKGROUND_TEXT = {
  solid: "workflow.image.background.solid",
  transparent: "workflow.image.background.transparent",
} as const satisfies Record<Background, AppTextKey>;

/** The text of each media kind. */
const KIND_TEXT = {
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

/** The option of a custom size. Its frame is dashed, as it has no fixed shape. */
const customOption = (t: AppTranslate): PickerOption<Frame> => ({
  value: WORKFLOW_MEDIA_CUSTOM_ASPECT,
  label: t("workflow.image.aspect.custom"),
  tile: () => (
    <span class="wfn-picker-aspect" data-custom="" style={{ "--wfn-aspect-w": "1", "--wfn-aspect-h": "0.75" }} />
  ),
});

/**
 * Each aspect ratio of the model with its frame, drawn with the longer side one icon long, and Custom
 * when the host can crop a picture to a size of its own.
 */
const aspectGroups = (t: AppTranslate, aspects: readonly Aspect[], custom: boolean): readonly PickerGroup<Frame>[] => [
  {
    options: [
      ...aspects.map((aspect) => {
        const [width = 1, height = 1] = aspect.split(":").map(Number);
        const long = Math.max(width, height);
        return {
          value: aspect,
          label: aspect,
          tile: () => (
            <span
              class="wfn-picker-aspect"
              style={{ "--wfn-aspect-w": String(width / long), "--wfn-aspect-h": String(height / long) }}
            />
          ),
          chips: [{ text: t(ASPECT_SHAPE[aspect]) }],
        };
      }),
      ...(custom ? [customOption(t)] : []),
    ],
  },
];

/** A side that the user typed, kept in range; the side that it had for text that is not a number. */
function typedSide(text: string, current: number): number {
  const value = Math.round(Number(text));
  if (!text.trim() || !Number.isFinite(value)) return current;
  return Math.min(WORKFLOW_MEDIA_SIZE_MAX, Math.max(WORKFLOW_MEDIA_SIZE_MIN, value));
}

/** The glass chip of a custom size. It opens a width and a height field. */
function SizeChip(props: { size: WorkflowMediaSize; disabled: boolean; onChange: (size: WorkflowMediaSize) => void }) {
  const { t } = useText();
  const value = () =>
    t("workflow.image.sizeValue", { width: String(props.size.width), height: String(props.size.height) });
  const commit = (side: keyof WorkflowMediaSize, input: HTMLInputElement) => {
    const next = typedSide(input.value, props.size[side]);
    input.value = String(next);
    if (next !== props.size[side]) props.onChange({ ...props.size, [side]: next });
  };
  const field = (side: keyof WorkflowMediaSize) => (
    <Label class="wfn-size-field">
      {t(side === "width" ? "workflow.image.width" : "workflow.image.height")}
      <Input
        type="number"
        inputmode="numeric"
        size="sm"
        min={WORKFLOW_MEDIA_SIZE_MIN}
        max={WORKFLOW_MEDIA_SIZE_MAX}
        step={1}
        value={String(props.size[side])}
        onChange={(event) => commit(side, event.currentTarget)}
      />
    </Label>
  );
  return (
    <Popover.Root placement="top-start" gutter={6}>
      <Popover.Trigger
        class="wfn-chip"
        aria-label={t("workflow.image.sizeLabel", { value: value() })}
        disabled={props.disabled}
      >
        {value()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface wfn-popover wfn-size-popover" data-wfn-portal="">
          <Popover.Title class="wfn-popover-title">{t("workflow.image.size")}</Popover.Title>
          <div class="wfn-size-fields">
            {field("width")}
            {field("height")}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A time as minutes and seconds, such as 0:07. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The whole seconds since `running` became true, while it stays true. */
function useElapsed(running: () => boolean) {
  const [now, setNow] = createSignal(0);
  let start = 0;
  createEffect(running, (on) => {
    if (!on) return;
    start = performance.now();
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

/** A glass chip on the media that opens a short list, as the aspect chip does. */
function ChipMenu<T extends string>(props: {
  label: string;
  title: string;
  text: string;
  icon?: JSX.Element;
  value: T;
  groups: readonly PickerGroup<T>[];
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <DropdownMenu.Root placement="top-start" gutter={6}>
      <DropdownMenu.Trigger class="wfn-chip" aria-label={props.label} disabled={props.disabled}>
        {props.icon}
        {props.text}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu label={props.title} groups={props.groups} value={props.value} onSelect={props.onSelect} />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** How a video uses a picture that comes in: as a reference, or as its first frame, its last frame or both. */
type InputRole = "reference" | "first" | "last" | "both";

const ROLE_TEXT = {
  reference: "workflow.video.role.reference",
  first: "workflow.video.role.first",
  last: "workflow.video.role.last",
  both: "workflow.video.role.both",
} as const satisfies Record<InputRole, AppTextKey>;

/** The short mark on a picture that is a frame. A reference has none. */
const ROLE_BADGE = {
  first: "workflow.video.badge.first",
  last: "workflow.video.badge.last",
  both: "workflow.video.badge.both",
} as const satisfies Record<Exclude<InputRole, "reference">, AppTextKey>;

/**
 * A picture that an image step before this one gives. On a video, a mark shows when it is a frame.
 * The port that the line ends on sets how the video uses it.
 */
function InputPicture(props: { index: number; url: string | undefined; role: InputRole }) {
  const { t } = useText();
  const badge = () => (props.role === "reference" ? undefined : t(ROLE_BADGE[props.role]));
  const label = () =>
    t("workflow.media.inputLabel", { index: String(props.index + 1), role: t(ROLE_TEXT[props.role]) });
  return (
    <span class="wfn-media-input" role="img" aria-label={label()}>
      <Show when={props.url} fallback={<Image aria-hidden="true" />}>
        {(url) => <img src={url()} alt="" draggable="false" />}
      </Show>
      <Show when={badge()}>{(text) => <span class="wfn-media-input-badge">{text()}</span>}</Show>
    </span>
  );
}

/**
 * The inputs of a video: the description, the first frame, the last frame and the references. The
 * frame ports keep their source in the field of the same name.
 */
function videoPorts(t: AppTranslate): readonly WfnInputPort[] {
  return [
    { type: "text" },
    { type: "image", branch: "firstFrame", label: t("workflow.video.role.first") },
    { type: "image", branch: "lastFrame", label: t("workflow.video.role.last") },
    { type: "image", label: t("workflow.video.role.reference") },
  ];
}

/** The width of a card for a frame of `ratio` (width / height): a tall card is narrow, and a video is wide enough to watch. */
function cardWidth(kind: WorkflowMediaKind, ratio: number): string | undefined {
  if (ratio < 0.7) return "240px";
  return kind === "video" ? "380px" : undefined;
}

/**
 * An image or a video that a model makes. The card is the media; on hover or selection a glass panel
 * holds the description, the model and Run, with the specs on the right of the bar above it. While
 * the model works, the dots of the chat frame fill the card at its final size, with the time.
 */
export function ImageNode(props: { id: string; image?: string | undefined; prompt?: string; aspect?: Aspect }) {
  const board = useBoard();
  const { t, format } = useText();
  const [kind] = useField<WorkflowMediaKind>(() => props.id, "media", "image", oneOf(WORKFLOW_MEDIA_KINDS));
  const text = (key: keyof (typeof KIND_TEXT)["image"]) => t(KIND_TEXT[kind()][key]);
  const [prompt, setPrompt] = useTextField(
    () => props.id,
    "prompt",
    untrack(() => props.prompt ?? ""),
  );
  const [aspect] = useField<Frame>(
    () => props.id,
    "aspect",
    untrack(() => props.aspect ?? "1:1"),
    oneOf(FRAMES),
  );
  /**
   * A host without `workflows-media-size-v1` reads a custom frame, 4:5 and 5:4 as the first aspect
   * ratio of the model, so the canvas offers them only on a host with it and shows what an older host makes.
   */
  const sizeHost = () => board.catalogs().mediaSize === true;
  const customAllowed = () => kind() === "image" && sizeHost();
  const hostAspect = (frame: Frame) =>
    sizeHost() || WORKFLOW_MEDIA_LEGACY_ASPECTS.some((legacy) => legacy === frame) ? frame : "";
  const aspects = () => workflowMediaAspects(model(), kind()).filter((value) => hostAspect(value) !== "");
  const [duration, setDuration] = useField<number>(() => props.id, "duration", WORKFLOW_VIDEO_DURATIONS[0], asSeconds);
  const [resolution, setResolution] = useField<string>(() => props.id, "resolution", "720p", asText);
  const [background, setBackground] = useField<Background>(() => props.id, "background", "solid", oneOf(BACKGROUNDS));
  const models = () => board.catalogs().imageModels.filter((choice) => choice.kinds.includes(kind()));
  const [modelId] = useField(
    () => props.id,
    "model",
    untrack(() => models()[0]?.id ?? ""),
    asString,
  );
  const model = () => models().find((candidate) => candidate.id === modelId());
  /** The account of the model's provider that pays, or "" for the provider's own sign-in. */
  const [account] = useField(() => props.id, "account", "", asString);
  /** What the model gets: a choice that it does not make shows as the one it makes in its place. */
  const specs = () =>
    workflowMediaSpecs(
      {
        aspect: hostAspect(aspect()),
        // The stored sides with no default: a missing (0) or out of range side gives no custom size, as on the host.
        width: board.field(props.id, "width") ?? 0,
        height: board.field(props.id, "height") ?? 0,
        duration: duration(),
        resolution: resolution(),
        background: background(),
      },
      kind(),
      model(),
    );
  const resolutions = () => workflowMediaResolutions(model(), kind());
  /** A Sunra or Higgsfield step shows what one file costs with its choices. */
  const price = useMediaPrice(() => {
    const chosen = model();
    if (!chosen?.credits || (chosen.provider !== "sunra" && chosen.provider !== "higgsfield")) return null;
    const { aspect, duration, resolution, transparent } = specs();
    return { model: chosen.id, kind: kind(), aspect, duration, resolution, transparent };
  });
  /** The price of one run as an object, so that a price of 0 credits also shows. */
  const quote = () => {
    const credits = price();
    return credits === null ? undefined : { credits };
  };
  const runLabel = () => {
    const credits = price();
    return credits === null ? undefined : t("workflow.node.runPriceLabel", { credits: format.number(credits) });
  };
  /**
   * The shape of the card: the custom size, else the aspect ratio that the model makes. A custom size
   * stays from 9:16 to 16:9, so the card holds its controls; the picture fills the card.
   */
  const frameRatio = () => {
    const size = specs().size;
    if (size) {
      const value = Math.min(16 / 9, Math.max(9 / 16, size.width / size.height));
      return { css: String(value), value };
    }
    const [w = 1, h = 1] = specs().aspect.split(":").map(Number);
    return { css: aspectRatio(specs().aspect), value: w / h };
  };
  /** Sets an aspect ratio, or a custom size that starts at the shape of the aspect ratio on view. */
  const chooseFrame = (frame: Frame) => {
    if (frame !== WORKFLOW_MEDIA_CUSTOM_ASPECT) {
      board.setField(props.id, "aspect", frame);
      return;
    }
    const kept =
      asSide(board.field(props.id, "width")) !== undefined && asSide(board.field(props.id, "height")) !== undefined;
    board.setFields(props.id, { aspect: frame, ...(kept ? {} : CUSTOM_START[specs().aspect]) });
  };
  const [firstFrame] = useField(() => props.id, "firstFrame", "", asString);
  const [lastFrame] = useField(() => props.id, "lastFrame", "", asString);
  const [voice, setVoice] = useField(() => props.id, "voice", "", asString);
  /** The image steps that give this step a picture, in connection order. The host reads them the same way. */
  const inputs = () => board.inputs(props.id, "image");
  /** A step runs with no description when a text or a picture comes in: the host makes the media from them. */
  const runnable = () => prompt().trim() !== "" || inputs().length > 0 || board.inputs(props.id, "text").length > 0;
  /** The picture of an image step's newest result, or the file of an asset. */
  const inputUrl = (source: string) => {
    const shown = board.shown(source);
    const file = board.field(source, "fileId");
    const value = shown && !shown.failed ? resultValue(shown) : typeof file === "string" && file ? file : undefined;
    return value === undefined ? undefined : (pictureUrl(value) ?? undefined);
  };
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
  const [collapsed, setCollapsed] = useField(() => props.id, "collapsed", false, asBoolean);
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const seconds = useElapsed(run.running);
  /**
   * The address of a result: the attachment that the step made, else a workspace image by name, as
   * a host without media results gives it. Undefined while it loads, null when it cannot show.
   */
  const urlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    return orFile(board.catalogs().media?.(value, kind()), value);
  };
  const orFile = (made: string | null | undefined, value: string) => made ?? fileUrl(value) ?? made;
  /** A workspace image by name, as a host without media results gives it. */
  const fileUrl = (value: string) =>
    board.catalogs().files.find((file) => file.name === value && file.previewKind === "image")?.previewUrl ?? undefined;
  /**
   * The small copy of a picture, which the card, its strip and its inputs show. A host that sends
   * it gives no full file here, so the card does not download both. The viewer and a download read
   * the file.
   */
  const pictureUrl = (value: string) => {
    const preview = board.catalogs().mediaPreview;
    return orFile(preview ? preview(value) : board.catalogs().media?.(value, "image"), value);
  };
  const smallUrlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    return kind() === "image" ? pictureUrl(value) : urlOf(value);
  };
  const shownValue = () => {
    const shown = board.shown(props.id);
    return shown ? resultValue(shown) : props.image;
  };
  const shownUrl = () => urlOf(shownValue());
  const shownPicture = () => smallUrlOf(shownValue());
  /** An image with clear pixels shows on the canvas with no card behind it. The copy keeps clear pixels. */
  const shape = usePictureShape(() => (kind() === "image" ? (shownPicture() ?? undefined) : undefined));
  const clear = () => kind() === "image" && !run.running() && shape()?.clear === true;
  const backgroundText = () => t(BACKGROUND_TEXT[specs().transparent ? "transparent" : "solid"]);
  /** The name that a download of the media takes. */
  const fileName = () => (kind() === "video" ? "video.mp4" : "image.png");
  const [viewer, setViewer] = createSignal<ImageLightboxOpening>();
  let media: HTMLElement | undefined;
  /** Opens the viewer on the image on view. The arrows step through every image of the step. */
  const openViewer = () => {
    const shown = board.shown(props.id);
    const images = board.results(props.id).flatMap((result) => {
      const url = result.failed ? undefined : urlOf(result.value);
      return url
        ? [
            {
              id: result.id,
              name: fileName(),
              size: 0,
              kind: "image" as const,
              mimeType: "image/png",
              previewKind: "image" as const,
              previewUrl: url,
            },
          ]
        : [];
    });
    const index = images.findIndex((entry) => entry.id === shown?.id);
    setViewer({ images, index: Math.max(0, index), origin: media });
  };
  const making = () => run.running();
  const specsDisabled = () => locked() || making();
  const durationText = (value: number) => t("workflow.video.seconds", { value: String(value) });
  const frameText = () => (specs().size ? t("workflow.image.aspect.custom") : specs().aspect);
  return (
    <>
      <NodeShell
        id={props.id}
        label={text("title")}
        kind="image"
        media
        clear={clear()}
        thumb={(result) => (kind() === "image" ? (smallUrlOf(result.value) ?? undefined) : undefined)}
        inputs={["text", "image"]}
        inputPorts={kind() === "video" ? videoPorts(t) : undefined}
        output={kind() === "video" ? "file" : "image"}
        style={{ "--wfn-aspect": frameRatio().css, "--wfn-width": cardWidth(kind(), frameRatio().value) }}
        toolbar={
          <NodeToolbar id={props.id} name={text("name")} locked={locked()} onLock={setLocked}>
            <Show when={kind() === "image" && shownUrl()}>
              <ToolAction
                text={t("workflow.node.toolbar.view")}
                label={t("workflow.node.toolbar.viewLabel")}
                icon={<Maximize2 />}
                onClick={openViewer}
              />
            </Show>
            <Show when={shownUrl()}>
              {(url) => (
                <ToolAction
                  text={t("workflow.node.toolbar.download")}
                  label={text("download")}
                  icon={<Download />}
                  onClick={() => download(url(), fileName())}
                />
              )}
            </Show>
          </NodeToolbar>
        }
      >
        <Show
          when={!making()}
          fallback={
            <div
              class="wfn-generating"
              role="status"
              aria-live="polite"
              aria-label={
                kind() === "video"
                  ? t("workflow.video.making", { time: clock(seconds()) })
                  : t("workflow.image.making", { time: clock(seconds()) })
              }
            >
              <MediaGenerationCanvas />
            </div>
          }
        >
          <Show
            when={shownPicture()}
            fallback={
              // A result with no address yet still comes from the host. Null: it cannot show here.
              <Show
                when={shownValue() === undefined || shownPicture() === null || !board.catalogs().media}
                fallback={<CardPictureLoading />}
              >
                <span class="wfn-media-empty" aria-hidden="true">
                  <Show when={kind() === "video"} fallback={<Image />}>
                    <Film />
                  </Show>
                </span>
              </Show>
            }
          >
            {(url) => (
              <Show
                when={kind() === "video"}
                fallback={
                  <CardPicture
                    ref={(element) => {
                      media = element;
                    }}
                    src={url()}
                    alt={prompt() || text("description")}
                  />
                }
              >
                <VideoPlayer
                  src={url()}
                  label={prompt() || text("description")}
                  durationSeconds={specs().duration}
                  fullControls
                  ref={(element) => {
                    media = element;
                  }}
                />
                <span class="wfn-clip-length" aria-hidden="true">
                  {clock(specs().duration)}
                </span>
              </Show>
            )}
          </Show>
        </Show>
        <div class="wfn-overlay wfn-media-overlay" data-collapsed={collapsed() ? "" : undefined}>
          <div class="wfn-overlay-bar">
            <Show when={making()}>
              <span class="wfn-elapsed" aria-hidden="true">
                {clock(seconds())}
              </span>
            </Show>
            <span class="wfn-media-specs">
              <ChipMenu<Frame>
                label={t("workflow.image.aspectLabel", { value: frameText() })}
                title={t("workflow.image.aspect")}
                text={frameText()}
                value={specs().size ? WORKFLOW_MEDIA_CUSTOM_ASPECT : specs().aspect}
                groups={aspectGroups(t, aspects(), customAllowed())}
                disabled={specsDisabled()}
                onSelect={chooseFrame}
              />
              <Show when={specs().size}>
                {(size) => (
                  <SizeChip
                    size={size()}
                    disabled={specsDisabled()}
                    onChange={(next) => board.setFields(props.id, { width: next.width, height: next.height })}
                  />
                )}
              </Show>
              <Show when={kind() === "video"}>
                <ChipMenu
                  label={t("workflow.video.lengthLabel", { value: durationText(specs().duration) })}
                  title={t("workflow.video.length")}
                  text={durationText(specs().duration)}
                  value={String(specs().duration)}
                  groups={[
                    {
                      options: workflowVideoDurations(model()).map((value) => ({
                        value: String(value),
                        label: durationText(value),
                      })),
                    },
                  ]}
                  disabled={specsDisabled()}
                  onSelect={(value) => {
                    const next = workflowVideoDurations(model()).find((option) => String(option) === value);
                    if (next !== undefined) setDuration(next);
                  }}
                />
              </Show>
              {/* A custom size sets the resolution that the model makes. */}
              <Show when={!specs().size && specs().resolution}>
                {(current) => (
                  <ChipMenu
                    label={t("workflow.video.resolutionLabel", { value: current() })}
                    title={t("workflow.video.resolution")}
                    text={current()}
                    value={current()}
                    groups={[{ options: resolutions().map((value) => ({ value, label: value })) }]}
                    disabled={specsDisabled()}
                    onSelect={setResolution}
                  />
                )}
              </Show>
              <Show when={kind() === "image" && model()?.transparent}>
                <ChipMenu
                  label={t("workflow.image.backgroundLabel", { value: backgroundText() })}
                  title={t("workflow.image.background")}
                  text={backgroundText()}
                  value={specs().transparent ? "transparent" : "solid"}
                  groups={[{ options: BACKGROUNDS.map((value) => ({ value, label: t(BACKGROUND_TEXT[value]) })) }]}
                  disabled={specsDisabled()}
                  onSelect={setBackground}
                />
              </Show>
              <Show when={kind() === "video"}>
                <Show when={model()?.voices}>
                  <ChipMenu
                    label={t("workflow.video.voiceLabel", { value: voiceText() })}
                    title={t("workflow.video.voice")}
                    text={voiceText()}
                    icon={<Mic aria-hidden="true" />}
                    value={voice()}
                    groups={[
                      {
                        options: [
                          { value: "", label: t("workflow.video.voiceAuto") },
                          ...WORKFLOW_VIDEO_VOICES.map((preset) => ({ value: preset.id, label: preset.name })),
                        ],
                      },
                    ]}
                    disabled={specsDisabled()}
                    onSelect={setVoice}
                  />
                </Show>
              </Show>
            </span>
            <Show
              when={!collapsed()}
              fallback={
                <Button variant="ghost" size="xs" class="wfn-chip" onClick={() => setCollapsed(false)}>
                  <Type aria-hidden="true" />
                  {t("workflow.prompt.title")}
                </Button>
              }
            >
              <Button
                variant="ghost"
                size="icon-xs"
                class="wfn-collapse"
                aria-label={t("workflow.image.hidePrompt")}
                onClick={() => setCollapsed(true)}
              >
                <Minimize2 />
              </Button>
            </Show>
          </div>
          <Show when={!collapsed()}>
            <div class="wfn-panel" data-inputs={inputs().length > 0 ? "" : undefined}>
              <Show when={inputs().length > 0}>
                <fieldset class="wfn-media-inputs" aria-label={t("workflow.media.inputs")}>
                  <For each={inputs()}>
                    {(source, index) => <InputPicture index={index()} url={inputUrl(source)} role={roleOf(source)} />}
                  </For>
                </fieldset>
              </Show>
              <Textarea
                class="wfn-input"
                rows={1}
                aria-label={text("description")}
                placeholder={text("placeholder")}
                readonly={locked()}
                value={prompt()}
                onValueChange={setPrompt}
              />
              <div class="wfn-field-foot">
                <MediaModelPicker
                  kind={kind()}
                  models={models()}
                  model={model()}
                  account={account()}
                  title={t(KIND_TEXT[kind()].models)}
                  disabled={specsDisabled()}
                  onChange={(next, accountId) =>
                    board.setFields(props.id, { model: next.id, account: accountId ?? "" })
                  }
                />
                <Show
                  when={run.stop()}
                  fallback={
                    <Button
                      size="xs"
                      class="wfn-run-pill"
                      loading={making()}
                      disabled={!runnable() || locked() || !model()}
                      onClick={run.start}
                      aria-label={runLabel()}
                    >
                      {/* A step with a price shows the credits of one run; its label says "Run" for screen readers. */}
                      <Show
                        when={quote()}
                        fallback={
                          <>
                            <Play aria-hidden="true" />
                            {t("workflow.node.run")}
                          </>
                        }
                      >
                        {(shown) => (
                          <>
                            <Zap class="wfn-run-credits-icon" aria-hidden="true" />
                            {format.number(shown().credits)}
                          </>
                        )}
                      </Show>
                    </Button>
                  }
                >
                  {(stop) => (
                    <Button size="xs" variant="secondary" class="wfn-run-pill" onClick={() => stop()(props.id)}>
                      <Square aria-hidden="true" />
                      {t("workflow.node.stop")}
                    </Button>
                  )}
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </NodeShell>
      <Show when={viewer()}>
        {(opening) => (
          <ImageLightbox
            opening={opening()}
            onDownload={(attachment) => {
              if (attachment.previewUrl) download(attachment.previewUrl, attachment.name);
            }}
            onClose={() => setViewer(undefined)}
          />
        )}
      </Show>
    </>
  );
}
