/** An image step: an image that an image model makes from a description. */

import { ProviderLogo } from "@openbot/brand";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  ChevronDown,
  Download,
  DropdownMenu,
  Image,
  Maximize2,
  Minimize2,
  Play,
  Square,
  Textarea,
  Type,
} from "@openbot/ui";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ImageLightbox, type ImageLightboxOpening } from "../conversation/ImageLightbox";
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
} from "./workflow-node-parts";

const ASPECTS = ["1:1", "4:3", "16:9", "9:16"] as const;
type Aspect = (typeof ASPECTS)[number];

function aspectRatio(aspect: Aspect): string {
  return aspect.replace(":", " / ");
}

const ASPECT_SHAPE = {
  "1:1": "workflow.image.aspect.square",
  "4:3": "workflow.image.aspect.landscape",
  "16:9": "workflow.image.aspect.wide",
  "9:16": "workflow.image.aspect.portrait",
} as const satisfies Record<Aspect, AppTextKey>;

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

/** The model that draws the image, in the same pill as the agent and effort choices. */
function ImageModelPill(props: {
  model: WorkflowImageModel | undefined;
  disabled?: boolean;
  onChange: (model: WorkflowImageModel) => void;
}) {
  const board = useBoard();
  const { t } = useText();
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
          label={t("workflow.image.models")}
          groups={[
            {
              options: board.catalogs().imageModels.map((choice) => ({
                value: choice.id,
                label: choice.name,
                tile: () => <ProviderLogo provider={choice.provider} class="wfn-model-logo" />,
                chips: [{ text: choice.maker }],
              })),
            },
          ]}
          value={props.model?.id}
          onSelect={(id) => {
            const model = board.catalogs().imageModels.find((choice) => choice.id === id);
            if (model) props.onChange(model);
          }}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * An image that an image model makes. The card is the image; on hover or selection a glass panel
 * holds the description, the model and Run, with the aspect chip above it.
 */
export function ImageNode(props: { id: string; image?: string | undefined; prompt?: string; aspect?: Aspect }) {
  const board = useBoard();
  const { t } = useText();
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
  const [modelId, setModelId] = useField(
    () => props.id,
    "model",
    untrack(() => board.catalogs().imageModels[0]?.id ?? ""),
    asString,
  );
  const model = () => board.catalogs().imageModels.find((candidate) => candidate.id === modelId());
  const setModel = (next: WorkflowImageModel) => setModelId(next.id);
  /** The images of the workspace files, by name. A result names one of them. */
  const imageFile = (name: string | undefined) =>
    name === undefined
      ? undefined
      : board.catalogs().files.find((file) => file.name === name && file.previewKind === "image" && file.previewUrl);
  const [collapsed, setCollapsed] = useField(() => props.id, "collapsed", false, asBoolean);
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  /** The shown result, else the image that the host gives the node. */
  const image = () => {
    const shown = board.shown(props.id);
    return imageFile(shown ? resultValue(shown) : props.image);
  };
  const [viewer, setViewer] = createSignal<ImageLightboxOpening>();
  let media: HTMLImageElement | undefined;
  /** Opens the viewer on the image on view. The arrows step through every result of the step. */
  const openViewer = () => {
    const shown = board.shown(props.id);
    const images = board.results(props.id).flatMap((result) => {
      const file = imageFile(result.value);
      return file ? [{ ...file, id: result.id }] : [];
    });
    const index = images.findIndex((entry) => entry.id === shown?.id);
    const single = image();
    if (index >= 0) setViewer({ images, index, origin: media });
    else if (single) setViewer({ images: [single], index: 0, origin: media });
  };
  return (
    <>
      <NodeShell
        id={props.id}
        label={t("workflow.image.title")}
        kind="image"
        media
        thumb={(result) => imageFile(result.value)?.previewUrl ?? undefined}
        inputs={["text", "image"]}
        output="image"
        style={{ "--wfn-aspect": aspectRatio(aspect()) }}
        toolbar={
          <NodeToolbar id={props.id} name={t("workflow.image.name")} locked={locked()} onLock={setLocked}>
            <Show when={image()}>
              <ToolAction
                text={t("workflow.node.toolbar.view")}
                label={t("workflow.node.toolbar.viewLabel")}
                icon={<Maximize2 />}
                onClick={openViewer}
              />
            </Show>
            <Show when={image()}>
              {(file) => (
                <Show when={file().previewUrl}>
                  {(url) => (
                    <ToolAction
                      text={t("workflow.node.toolbar.download")}
                      label={t("workflow.image.download")}
                      icon={<Download />}
                      onClick={() => download(url(), file().name)}
                    />
                  )}
                </Show>
              )}
            </Show>
          </NodeToolbar>
        }
      >
        <Show
          when={image()}
          fallback={
            <span class="wfn-media-empty" aria-hidden="true">
              <Image />
            </span>
          }
        >
          {(file) => (
            <img
              ref={(element: HTMLImageElement) => {
                media = element;
              }}
              class="wfn-media"
              src={file().previewUrl ?? ""}
              alt={prompt() || file().name}
            />
          )}
        </Show>
        <div class="wfn-overlay" data-collapsed={collapsed() ? "" : undefined}>
          <div class="wfn-overlay-bar">
            <DropdownMenu.Root placement="top-start" gutter={6}>
              <DropdownMenu.Trigger
                class="wfn-chip"
                aria-label={t("workflow.image.aspectLabel", { value: aspect() })}
                disabled={locked()}
              >
                {aspect()}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <PickerMenu
                  label={t("workflow.image.aspect")}
                  groups={aspectGroups(t)}
                  value={aspect()}
                  onSelect={setAspect}
                />
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
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
            <div class="wfn-panel">
              <Textarea
                class="wfn-input"
                rows={1}
                aria-label={t("workflow.image.description")}
                placeholder={t("workflow.image.descriptionPlaceholder")}
                readonly={locked()}
                value={prompt()}
                onValueChange={setPrompt}
              />
              <div class="wfn-field-foot">
                <ImageModelPill model={model()} disabled={locked()} onChange={setModel} />
                <Show
                  when={run.stop()}
                  fallback={
                    <Button
                      size="xs"
                      class="wfn-run-pill"
                      loading={run.running()}
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
