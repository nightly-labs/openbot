import type { WorkflowMediaInput } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { Button, Download, Film, Image, Maximize2, Mic, Square, Textarea } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
import { MediaGenerationCanvas } from "../conversation/media-generation-frame";
import { VideoPlayer } from "../conversation/VideoPlayer";
import { usePictureShape } from "./picture-shape";
import { MediaModelPicker } from "./WorkflowMediaModelPicker";
import { resultValue, useBoard } from "./workflow-board";
import {
  type Aspect,
  BACKGROUND_TEXT,
  clock,
  KIND_TEXT,
  RunContent,
  resolutionName,
  useElapsed,
  useMediaStep,
} from "./workflow-media-step";
import { download, NodeShell, NodeToolbar, ToolAction, type WfnInputPort } from "./workflow-node-parts";
import { CardPicture, CardPictureLoading } from "./workflow-picture";
import { StepSettingsAction } from "./workflow-step-settings";

function aspectRatio(aspect: Aspect): string {
  return aspect.replace(":", " / ");
}

function clipLabel(t: AppTranslate, inputs: readonly WorkflowMediaInput[]) {
  if (!inputs.includes("audios")) return t("workflow.video.role.video");
  return inputs.includes("videos") ? t("workflow.video.role.clips") : t("workflow.video.role.audio");
}

function videoPorts(
  t: AppTranslate,
  inputs: readonly WorkflowMediaInput[],
  connected: (type: "image" | "file", branch?: string) => boolean,
): readonly WfnInputPort[] {
  const shows = (input: WorkflowMediaInput, type: "image" | "file", branch?: string) =>
    inputs.includes(input) || connected(type, branch);
  const clipInputs = inputs.includes("videos") || inputs.includes("audios") ? inputs : (["videos"] as const);
  return [
    { type: "text" },
    ...(shows("frames", "image", "firstFrame")
      ? [{ type: "image" as const, branch: "firstFrame", label: t("workflow.video.role.first") }]
      : []),
    ...(shows("frames", "image", "lastFrame")
      ? [{ type: "image" as const, branch: "lastFrame", label: t("workflow.video.role.last") }]
      : []),
    ...(shows("references", "image") ? [{ type: "image" as const, label: t("workflow.video.role.reference") }] : []),
    ...(inputs.includes("videos") || inputs.includes("audios") || connected("file")
      ? [{ type: "file" as const, label: clipLabel(t, clipInputs) }]
      : []),
  ];
}

function cardWidth(ratio: number) {
  return ratio < 0.7 ? "240px" : "380px";
}

function SpecChip(props: { text: string; icon?: JSX.Element }) {
  return (
    <span class="wfn-chip">
      {props.icon}
      {props.text}
    </span>
  );
}

export function ImageNode(props: { id: string; image?: string | undefined; prompt?: string; aspect?: Aspect }) {
  const board = useBoard();
  const { t } = useText();
  const step = useMediaStep(
    untrack(() => props.id),
    untrack(() => ({ prompt: props.prompt, aspect: props.aspect })),
  );
  const { kind, prompt, specs, model, run } = step;
  const text = (key: keyof (typeof KIND_TEXT)["image"]) => t(KIND_TEXT[kind()][key]);
  const frameRatio = () => {
    const size = specs().size;
    if (size) {
      const value = Math.min(16 / 9, Math.max(9 / 16, size.width / size.height));
      return { css: String(value), value };
    }
    const [w = 1, h = 1] = specs().aspect.split(":").map(Number);
    return { css: aspectRatio(specs().aspect), value: w / h };
  };
  const seconds = useElapsed(run.running);
  const urlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    return step.orFile(board.catalogs().media?.(value, kind()), value);
  };
  const smallUrlOf = (value: string | undefined) => {
    if (value === undefined) return undefined;
    return kind() === "image" ? step.pictureUrl(value) : urlOf(value);
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
  const [videoReady, setVideoReady] = createSignal<string>();
  let media: HTMLElement | undefined;
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
  const durationText = (value: number) => t("workflow.video.seconds", { value: String(value) });
  const frameText = () => {
    const size = specs().size;
    return size
      ? t("workflow.image.sizeValue", { width: String(size.width), height: String(size.height) })
      : specs().aspect;
  };
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
        inputPorts={
          kind() === "video"
            ? videoPorts(t, step.mediaInputs(), (type, branch) => board.connected(props.id, "in", type, branch))
            : undefined
        }
        output={kind() === "video" ? "file" : "image"}
        style={{ "--wfn-aspect": frameRatio().css, "--wfn-width": cardWidth(frameRatio().value) }}
        toolbar={
          <NodeToolbar id={props.id} name={text("name")} locked={step.locked()} onLock={step.setLocked}>
            <StepSettingsAction id={props.id} kind="image" />
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
                  loading={videoReady() !== url()}
                  onMetadata={() => setVideoReady(url())}
                  onError={() => setVideoReady(url())}
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
        <div class="wfn-overlay wfn-media-overlay" inert>
          <div class="wfn-overlay-bar">
            <Show when={making()}>
              <span class="wfn-elapsed">{clock(seconds())}</span>
            </Show>
            <span class="wfn-media-specs">
              <SpecChip text={frameText()} />
              <Show when={kind() === "video"}>
                <SpecChip text={durationText(specs().duration)} />
              </Show>
              <Show when={!specs().size && specs().resolution}>
                {(current) => <SpecChip text={resolutionName(current())} />}
              </Show>
              <Show when={kind() === "image" && model()?.transparent}>
                <SpecChip text={backgroundText()} />
              </Show>
              <Show when={kind() === "video" && model()?.voices}>
                <SpecChip text={step.voiceText()} icon={<Mic aria-hidden="true" />} />
              </Show>
            </span>
          </div>
          <div class="wfn-panel">
            <Textarea
              class="wfn-input"
              rows={1}
              aria-label={text("description")}
              placeholder={text("placeholder")}
              readonly
              value={prompt()}
            />
            <div class="wfn-field-foot">
              <MediaModelPicker
                kind={kind()}
                models={step.models()}
                model={model()}
                account={step.account()}
                title={text("models")}
                disabled={step.specsDisabled()}
                onChange={() => undefined}
              />
              <Show
                when={run.stop()}
                fallback={
                  <Button
                    size="xs"
                    class="wfn-run-pill"
                    loading={making()}
                    disabled={!step.runnable() || step.locked() || !model()}
                    aria-label={step.runLabel()}
                  >
                    <RunContent credits={step.price()} />
                  </Button>
                }
              >
                <Button size="xs" variant="secondary" class="wfn-run-pill">
                  <Square aria-hidden="true" />
                  {t("workflow.node.stop")}
                </Button>
              </Show>
            </div>
          </div>
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
