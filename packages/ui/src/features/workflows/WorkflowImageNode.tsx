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
  workflowVideoLengthChoices,
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
  SliderField,
  Square,
  Textarea,
  Type,
  Zap,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
import { MediaGenerationCanvas } from "../conversation/media-generation-frame";
import { VideoPlayer } from "../conversation/VideoPlayer";
import { usePictureShape } from "./picture-shape";
import { MediaModelPicker } from "./WorkflowMediaModelPicker";
import { type PickerGroup, PickerMenu, type PickerOption } from "./WorkflowPicker";
import { resultValue, useBoard } from "./workflow-board";
import { InputPictures, type InputRole, orStoredPicture, pictureUrl } from "./workflow-input-pictures";
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
type Frame = Aspect | typeof WORKFLOW_MEDIA_CUSTOM_ASPECT;
const FRAMES: readonly Frame[] = [...WORKFLOW_MEDIA_ASPECTS, WORKFLOW_MEDIA_CUSTOM_ASPECT];

const asSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
const asText = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const asSide = (value: unknown): number | undefined => (isWorkflowMediaSide(value) ? value : undefined);

function aspectRatio(aspect: Aspect): string {
  return aspect.replace(":", " / ");
}

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

const BACKGROUNDS = ["solid", "transparent"] as const;
type Background = (typeof BACKGROUNDS)[number];

const BACKGROUND_TEXT = {
  solid: "workflow.image.background.solid",
  transparent: "workflow.image.background.transparent",
} as const satisfies Record<Background, AppTextKey>;

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

const customOption = (t: AppTranslate): PickerOption<Frame> => ({
  value: WORKFLOW_MEDIA_CUSTOM_ASPECT,
  label: t("workflow.image.aspect.custom"),
  tile: () => (
    <span class="wfn-picker-aspect" data-custom="" style={{ "--wfn-aspect-w": "1", "--wfn-aspect-h": "0.75" }} />
  ),
});

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

function typedSide(text: string, current: number): number {
  const value = Math.round(Number(text));
  if (!text.trim() || !Number.isFinite(value)) return current;
  return Math.min(WORKFLOW_MEDIA_SIZE_MAX, Math.max(WORKFLOW_MEDIA_SIZE_MIN, value));
}

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

const CUSTOM_LENGTH = "custom" as const;
type LengthChoice = `${number}` | typeof CUSTOM_LENGTH;

function LengthChip(props: {
  seconds: number;
  lengths: readonly number[];
  disabled: boolean;
  onChange: (seconds: number) => void;
}) {
  const { t } = useText();
  const [dragged, setDragged] = createSignal<number | null>(null);
  const sorted = createMemo(() => [...new Set(props.lengths)].sort((left, right) => left - right));
  const index = () => dragged() ?? Math.max(sorted().indexOf(props.seconds), 0);
  const at = (place: number) => sorted()[place] ?? props.seconds;
  const seconds = (place: number) => t("workflow.video.seconds", { value: String(at(place)) });
  const commit = (place: number) => {
    if (at(place) !== props.seconds) props.onChange(at(place));
    setDragged(null);
  };
  return (
    <Popover.Root placement="top" gutter={6}>
      <Popover.Trigger
        class="wfn-chip"
        aria-label={t("workflow.video.lengthLabel", { value: seconds(index()) })}
        disabled={props.disabled}
      >
        {seconds(index())}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="ui-popover-menu-surface wfn-popover wfn-length-popover"
          aria-label={t("workflow.video.length")}
          data-wfn-portal=""
        >
          <SliderField
            label={t("workflow.video.length")}
            value={index()}
            minValue={0}
            maxValue={Math.max(sorted().length - 1, 1)}
            step={1}
            disabled={props.disabled}
            formatValue={seconds}
            onChange={setDragged}
            onChangeEnd={commit}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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

const resolutionName = (value: string) => value.replace(/k$/u, "K");

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
    quote(next).then(
      (answer) => {
        if (sent === asked) setCredits(answer.credits);
      },
      () => undefined,
    );
  });
  return credits;
}

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

function videoPorts(t: AppTranslate): readonly WfnInputPort[] {
  return [
    { type: "text" },
    { type: "image", branch: "firstFrame", label: t("workflow.video.role.first") },
    { type: "image", branch: "lastFrame", label: t("workflow.video.role.last") },
    { type: "image", label: t("workflow.video.role.reference") },
  ];
}

function cardWidth(kind: WorkflowMediaKind, ratio: number): string | undefined {
  if (ratio < 0.7) return "240px";
  return kind === "video" ? "380px" : undefined;
}

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
  const [account] = useField(() => props.id, "account", "", asString);
  const specs = () =>
    workflowMediaSpecs(
      {
        aspect: hostAspect(aspect()),
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
  const lengths = () => workflowVideoDurations(model());
  const lengthChoices = () => workflowVideoLengthChoices(lengths());
  const customLengthAllowed = () => lengthChoices().length < lengths().length;
  const [customLengthModel, setCustomLengthModel] = createSignal<string | null>(null);
  const customLength = () => customLengthModel() === (model()?.id ?? "");
  const lengthIsCustom = () => customLengthAllowed() && (customLength() || !lengthChoices().includes(specs().duration));
  const chooseLength = (choice: LengthChoice) => {
    if (choice === CUSTOM_LENGTH) {
      setCustomLengthModel(model()?.id ?? "");
      return;
    }
    const next = lengths().find((option) => String(option) === choice);
    if (next === undefined) return;
    setCustomLengthModel(null);
    setDuration(next);
  };
  const price = useMediaPrice(() => {
    const chosen = model();
    if (!chosen?.credits || (chosen.provider !== "sunra" && chosen.provider !== "higgsfield")) return null;
    const { aspect, duration, resolution, transparent } = specs();
    return { model: chosen.id, kind: kind(), aspect, duration, resolution, transparent };
  });
  const quote = () => {
    const credits = price();
    return credits === null ? undefined : { credits };
  };
  const runLabel = () => {
    const credits = price();
    return credits === null ? undefined : t("workflow.node.runPriceLabel", { credits: format.number(credits) });
  };
  const frameRatio = () => {
    const size = specs().size;
    if (size) {
      const value = Math.min(16 / 9, Math.max(9 / 16, size.width / size.height));
      return { css: String(value), value };
    }
    const [w = 1, h = 1] = specs().aspect.split(":").map(Number);
    return { css: aspectRatio(specs().aspect), value: w / h };
  };
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
  const inputs = () => board.inputs(props.id, "image");
  const runnable = () => prompt().trim() !== "" || inputs().length > 0 || board.inputs(props.id, "text").length > 0;
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
  const urlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    return orStoredPicture(board, board.catalogs().media?.(value, kind()), value);
  };
  const smallUrlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    return kind() === "image" ? pictureUrl(board, value) : urlOf(value);
  };
  const shownValue = () => {
    const shown = board.shown(props.id);
    return shown ? resultValue(shown) : props.image;
  };
  const shownUrl = () => urlOf(shownValue());
  const shownPicture = () => smallUrlOf(shownValue());
  const shape = usePictureShape(() => (kind() === "image" ? (shownPicture() ?? undefined) : undefined));
  const clear = () => kind() === "image" && !run.running() && shape()?.clear === true;
  const backgroundText = () => t(BACKGROUND_TEXT[specs().transparent ? "transparent" : "solid"]);
  const fileName = () => (kind() === "video" ? "video.mp4" : "image.png");
  const [viewer, setViewer] = createSignal<ImageLightboxOpening>();
  let media: HTMLElement | undefined;
  let promptInput: HTMLTextAreaElement | undefined;
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
  const pictureLoading = () => shownValue() !== undefined && shownPicture() !== null && Boolean(board.catalogs().media);
  const generated = () => !making() && (Boolean(shownPicture()) || pictureLoading());
  const panelShown = () => generated() || !collapsed();
  const specsDisabled = () => locked() || making();
  const durationText = (value: number) => t("workflow.video.seconds", { value: String(value) });
  const frameText = () => (specs().size ? t("workflow.image.aspect.custom") : specs().aspect);
  const lengthText = () => (lengthIsCustom() ? t("workflow.video.length.custom") : durationText(specs().duration));
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
              <Show when={!pictureLoading()} fallback={<CardPictureLoading />}>
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
        <div
          class="wfn-overlay wfn-media-overlay"
          data-collapsed={collapsed() ? "" : undefined}
          data-reveal={generated() ? "" : undefined}
        >
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
                <ChipMenu<LengthChoice>
                  label={t("workflow.video.lengthLabel", { value: lengthText() })}
                  title={t("workflow.video.length")}
                  text={lengthText()}
                  value={lengthIsCustom() ? CUSTOM_LENGTH : `${specs().duration}`}
                  groups={[
                    {
                      options: [
                        ...lengthChoices().map((value) => ({ value: `${value}` as const, label: durationText(value) })),
                        ...(customLengthAllowed()
                          ? [{ value: CUSTOM_LENGTH, label: t("workflow.video.length.custom") }]
                          : []),
                      ],
                    },
                  ]}
                  disabled={specsDisabled()}
                  onSelect={chooseLength}
                />
                <Show when={lengthIsCustom()}>
                  <LengthChip
                    seconds={specs().duration}
                    lengths={lengths()}
                    disabled={specsDisabled()}
                    onChange={(seconds) => {
                      setCustomLengthModel(model()?.id ?? "");
                      setDuration(seconds);
                    }}
                  />
                </Show>
              </Show>
              <Show when={!specs().size && specs().resolution}>
                {(current) => (
                  <ChipMenu
                    label={t("workflow.video.resolutionLabel", { value: resolutionName(current()) })}
                    title={t("workflow.video.resolution")}
                    text={resolutionName(current())}
                    value={current()}
                    groups={[{ options: resolutions().map((value) => ({ value, label: resolutionName(value) })) }]}
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
              when={!generated() && !collapsed()}
              fallback={
                <Button
                  variant="ghost"
                  size="xs"
                  class="wfn-chip"
                  onClick={() => (generated() ? promptInput?.focus() : setCollapsed(false))}
                >
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
          <Show when={panelShown()}>
            <div class="wfn-panel" data-inputs={inputs().length > 0 ? "" : undefined}>
              <Show when={inputs().length > 0}>
                <InputPictures sources={inputs()} roleOf={roleOf} />
              </Show>
              <Textarea
                ref={(element: HTMLTextAreaElement) => {
                  promptInput = element;
                }}
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
