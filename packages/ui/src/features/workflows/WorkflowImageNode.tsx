/** A media step: an image or a video that a model makes from a description. */

import { ProviderLogo } from "@openbot/brand";
import {
  WORKFLOW_MEDIA_KINDS,
  WORKFLOW_VIDEO_DURATIONS,
  WORKFLOW_VIDEO_RESOLUTIONS,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowMediaKind,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  ChevronDown,
  Download,
  DropdownMenu,
  Film,
  Image,
  Maximize2,
  Mic,
  Minimize2,
  Play,
  Square,
  Textarea,
  Type,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
import { MediaGenerationCanvas } from "../conversation/media-generation-frame";
import { VideoPlayer } from "../conversation/VideoPlayer";
import { type PickerGroup, PickerMenu } from "./WorkflowPicker";
import { resultValue, useBoard } from "./workflow-board";
import type { WorkflowImageModel } from "./workflow-model";
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

const ASPECTS = ["1:1", "4:3", "16:9", "9:16"] as const;
type Aspect = (typeof ASPECTS)[number];
type Duration = (typeof WORKFLOW_VIDEO_DURATIONS)[number];
type Resolution = (typeof WORKFLOW_VIDEO_RESOLUTIONS)[number];

function aspectRatio(aspect: Aspect): string {
  return aspect.replace(":", " / ");
}

const ASPECT_SHAPE = {
  "1:1": "workflow.image.aspect.square",
  "4:3": "workflow.image.aspect.landscape",
  "16:9": "workflow.image.aspect.wide",
  "9:16": "workflow.image.aspect.portrait",
} as const satisfies Record<Aspect, AppTextKey>;

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

/** Each aspect ratio with its frame, drawn with the longer side one icon long. */
const aspectGroups = (t: AppTranslate): readonly PickerGroup<Aspect>[] => [
  {
    options: ASPECTS.map((aspect) => {
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
  },
];

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

/** The model that makes the media, in the same pill as the agent and effort choices. */
function MediaModelPill(props: {
  kind: WorkflowMediaKind;
  model: WorkflowImageModel | undefined;
  disabled?: boolean;
  onChange: (model: WorkflowImageModel) => void;
}) {
  const board = useBoard();
  const { t } = useText();
  const models = () => board.catalogs().imageModels.filter((choice) => choice.kinds.includes(props.kind));
  const name = () => props.model?.name ?? t("workflow.image.chooseModel");
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill`}
        aria-label={t("workflow.model.label", { name: name() })}
        disabled={props.disabled}
      >
        <Show when={props.model}>{(model) => <ProviderLogo provider={model().provider} class="wfn-model-logo" />}</Show>
        <span>{name()}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={t(KIND_TEXT[props.kind].models)}
          groups={[
            {
              options: models().map((choice) => ({
                value: choice.id,
                label: choice.name,
                tile: () => <ProviderLogo provider={choice.provider} class="wfn-model-logo" />,
                chips: [
                  {
                    text: choice.apiKey
                      ? t("workflow.media.apiKey", { name: choice.maker })
                      : t("workflow.media.subscription", { name: choice.subscription }),
                  },
                ],
              })),
            },
          ]}
          value={props.model?.id}
          onSelect={(id) => {
            const model = models().find((choice) => choice.id === id);
            if (model) props.onChange(model);
          }}
        />
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

/** The width of a card: a portrait card is narrow, and a video is wide enough to watch. */
function cardWidth(kind: WorkflowMediaKind, aspect: Aspect): string | undefined {
  if (aspect === "9:16") return "240px";
  return kind === "video" ? "380px" : undefined;
}

/**
 * An image or a video that a model makes. The card is the media; on hover or selection a glass panel
 * holds the description, the model and Run, with the specs on the right of the bar above it. While
 * the model works, the dots of the chat frame fill the card at its final size, with the time.
 */
export function ImageNode(props: { id: string; image?: string | undefined; prompt?: string; aspect?: Aspect }) {
  const board = useBoard();
  const { t } = useText();
  const [kind] = useField<WorkflowMediaKind>(() => props.id, "media", "image", oneOf(WORKFLOW_MEDIA_KINDS));
  const text = (key: keyof (typeof KIND_TEXT)["image"]) => t(KIND_TEXT[kind()][key]);
  const [prompt, setPrompt] = useTextField(
    () => props.id,
    "prompt",
    untrack(() => props.prompt ?? ""),
  );
  const [aspect, setAspect] = useField<Aspect>(
    () => props.id,
    "aspect",
    untrack(() => props.aspect ?? "1:1"),
    oneOf(ASPECTS),
  );
  const [duration, setDuration] = useField<Duration>(
    () => props.id,
    "duration",
    WORKFLOW_VIDEO_DURATIONS[0],
    oneOf(WORKFLOW_VIDEO_DURATIONS),
  );
  const [resolution, setResolution] = useField<Resolution>(
    () => props.id,
    "resolution",
    "720p",
    oneOf(WORKFLOW_VIDEO_RESOLUTIONS),
  );
  const models = () => board.catalogs().imageModels.filter((choice) => choice.kinds.includes(kind()));
  const [modelId, setModelId] = useField(
    () => props.id,
    "model",
    untrack(() => models()[0]?.id ?? ""),
    asString,
  );
  const model = () => models().find((candidate) => candidate.id === modelId());
  const [firstFrame] = useField(() => props.id, "firstFrame", "", asString);
  const [lastFrame] = useField(() => props.id, "lastFrame", "", asString);
  const [voice, setVoice] = useField(() => props.id, "voice", "", asString);
  /** The image steps that give this step a picture, in connection order. The host reads them the same way. */
  const inputs = () => board.inputs(props.id, "image");
  /** The picture of an image step's newest result, or the file of an asset. */
  const inputUrl = (source: string) => {
    const shown = board.shown(source);
    const file = board.field(source, "fileId");
    const value = shown && !shown.failed ? resultValue(shown) : typeof file === "string" && file ? file : undefined;
    return value === undefined ? undefined : board.catalogs().media?.(value, "image");
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
   * a host without media results gives it.
   */
  const urlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const made = board.catalogs().media?.(value, kind());
    if (made) return made;
    return (
      board.catalogs().files.find((file) => file.name === value && file.previewKind === "image")?.previewUrl ??
      undefined
    );
  };
  const shownValue = () => {
    const shown = board.shown(props.id);
    return shown ? resultValue(shown) : props.image;
  };
  const shownUrl = () => urlOf(shownValue());
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
  const durationText = (value: Duration) => t("workflow.video.seconds", { value: String(value) });
  return (
    <>
      <NodeShell
        id={props.id}
        label={text("title")}
        kind="image"
        media
        thumb={(result) => (kind() === "image" ? urlOf(result.value) : undefined)}
        inputs={["text", "image"]}
        inputPorts={kind() === "video" ? videoPorts(t) : undefined}
        output={kind() === "video" ? "file" : "image"}
        style={{ "--wfn-aspect": aspectRatio(aspect()), "--wfn-width": cardWidth(kind(), aspect()) }}
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
            when={shownUrl()}
            fallback={
              <span class="wfn-media-empty" aria-hidden="true">
                <Show when={kind() === "video"} fallback={<Image />}>
                  <Film />
                </Show>
              </span>
            }
          >
            {(url) => (
              <Show
                when={kind() === "video"}
                fallback={
                  <img
                    ref={(element: HTMLImageElement) => {
                      media = element;
                    }}
                    class="wfn-media"
                    src={url()}
                    alt={prompt() || text("description")}
                    draggable="false"
                  />
                }
              >
                <VideoPlayer
                  src={url()}
                  label={prompt() || text("description")}
                  durationSeconds={duration()}
                  fullControls
                  ref={(element) => {
                    media = element;
                  }}
                />
                <span class="wfn-clip-length" aria-hidden="true">
                  {clock(duration())}
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
              <ChipMenu
                label={t("workflow.image.aspectLabel", { value: aspect() })}
                title={t("workflow.image.aspect")}
                text={aspect()}
                value={aspect()}
                groups={aspectGroups(t)}
                disabled={specsDisabled()}
                onSelect={setAspect}
              />
              <Show when={kind() === "video"}>
                <ChipMenu
                  label={t("workflow.video.lengthLabel", { value: durationText(duration()) })}
                  title={t("workflow.video.length")}
                  text={durationText(duration())}
                  value={String(duration())}
                  groups={[
                    {
                      options: WORKFLOW_VIDEO_DURATIONS.map((value) => ({
                        value: String(value),
                        label: durationText(value),
                      })),
                    },
                  ]}
                  disabled={specsDisabled()}
                  onSelect={(value) => {
                    const next = WORKFLOW_VIDEO_DURATIONS.find((option) => String(option) === value);
                    if (next !== undefined) setDuration(next);
                  }}
                />
                <ChipMenu
                  label={t("workflow.video.resolutionLabel", { value: resolution() })}
                  title={t("workflow.video.resolution")}
                  text={resolution()}
                  value={resolution()}
                  groups={[{ options: WORKFLOW_VIDEO_RESOLUTIONS.map((value) => ({ value, label: value })) }]}
                  disabled={specsDisabled()}
                  onSelect={setResolution}
                />
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
                <MediaModelPill
                  kind={kind()}
                  model={model()}
                  disabled={specsDisabled()}
                  onChange={(next) => setModelId(next.id)}
                />
                <Show
                  when={run.stop()}
                  fallback={
                    <Button
                      size="xs"
                      class="wfn-run-pill"
                      loading={making()}
                      disabled={!prompt().trim() || locked() || !model()}
                      onClick={run.start}
                    >
                      <Play aria-hidden="true" />
                      {t("workflow.node.run")}
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
