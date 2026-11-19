/**
 * The composer of the selected image or video step, under its card: the pictures that come in, the
 * description, and one bar with the model, the settings and Run with its price. The card shows only
 * its media while the composer is open.
 */

import {
  WORKFLOW_MEDIA_CUSTOM_ASPECT,
  WORKFLOW_MEDIA_SIZE_MAX,
  WORKFLOW_MEDIA_SIZE_MIN,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowMediaSize,
} from "@openbot/contracts/ipc";
import {
  Button,
  ChevronDown,
  Input,
  Play,
  Popover,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SliderField,
  SlidersHorizontal,
  Square,
  SwitchField,
  Textarea,
  X,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdges } from "../../components/ScrollEdges";
import { useText } from "../../text";
import { MediaModelPicker } from "./WorkflowMediaModelPicker";
import { useBoard } from "./workflow-board";
import {
  ASPECT_SHAPE,
  BACKGROUND_TEXT,
  type Background,
  clock,
  type Frame,
  KIND_TEXT,
  type MediaStep,
  type MediaStepOption,
  modeNameKey,
  optionNameKey,
  optionValueKey,
  ROLE_BADGE,
  ROLE_TEXT,
  readableName,
  typedSide,
  useElapsed,
  useMediaStep,
} from "./workflow-media-step";

/** The space between the card, with its strip of results, and the composer. */
const GAP = 10;
/** The top bar and the bottom bar of the canvas, which the composer keeps clear of. */
const TOP_ROOM = 56;
const BOTTOM_ROOM = 80;
/** The parts of a node that the composer goes below: the media, the strip of results and a tool bar below. */
const BELOW = '.wfn-card-frame, .wfn-strip, .wfn-toolbar[data-side="below"]';
/** The parts of a node that the composer goes above when the room below is too small. */
const ABOVE = ".wfn-card-frame, .wfn-label, .wfn-toolbar";

/**
 * Runs `action` for a key that `matches` while `owns` takes it. The canvas reads its shortcuts on the
 * document, so the key stops here, in the capture phase, before them: Escape does not clear the
 * selection, and Mod+Enter does not run the whole routine.
 */
function takeKey(matches: (event: KeyboardEvent) => boolean, owns: (target: Node) => boolean, action: () => void) {
  const listener = (event: KeyboardEvent) => {
    if (!matches(event) || !(event.target instanceof Node) || !owns(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  document.addEventListener("keydown", listener, true);
  onCleanup(() => document.removeEventListener("keydown", listener, true));
}

const isEscape = (event: KeyboardEvent) => event.key === "Escape";
const isSend = (event: KeyboardEvent) =>
  event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing;

/**
 * The composer of one media step. `root` is the canvas: the composer stays below the card in each
 * frame as the camera moves, centred on the card and at the same size at each zoom, as the tool bar
 * of a card. When the room below is too small, it goes above the card. Near an edge it stays inside
 * the canvas, clear of its bars. While the card is out of view, the composer hides. Escape gives the focus back to the card.
 */
export function WorkflowMediaComposer(props: { id: string; root: () => HTMLElement | undefined }) {
  const { t } = useText();
  const step = useMediaStep(untrack(() => props.id));
  const text = (key: keyof (typeof KIND_TEXT)["image"]) => t(KIND_TEXT[step.kind()][key]);
  let section: HTMLElement | undefined;
  const node = () => props.root()?.querySelector<HTMLElement>(`.wfn-node[data-node-id="${CSS.escape(props.id)}"]`);
  const focusCard = () => node()?.focus({ preventScroll: true });

  let placed = "";
  let frame = requestAnimationFrame(function place() {
    frame = requestAnimationFrame(place);
    const root = props.root();
    const card = node();
    const media = card?.querySelector(".wfn-card-frame") ?? card;
    if (!section || !root || !card || !media) return;
    const outer = root.getBoundingClientRect();
    const inner = media.getBoundingClientRect();
    const visible =
      inner.right > outer.left && inner.left < outer.right && inner.bottom > outer.top && inner.top < outer.bottom;
    if (!visible) {
      delete section.dataset.placed;
      return;
    }
    const edges = (selector: string, side: "top" | "bottom") =>
      Array.from(card.querySelectorAll(selector), (part) => part.getBoundingClientRect()[side]);
    const bottom = Math.max(inner.bottom, ...edges(BELOW, "bottom"));
    const above = Math.min(inner.top, ...edges(ABOVE, "top"));
    const width = section.offsetWidth;
    const height = section.offsetHeight;
    const left = Math.min(
      Math.max(inner.left + inner.width / 2 - width / 2 - outer.left, GAP),
      outer.width - width - GAP,
    );
    const below = bottom + GAP - outer.top;
    const over = above - GAP - height - outer.top;
    const room = outer.height - height - BOTTOM_ROOM;
    const top = Math.max(Math.min(below > room && over >= TOP_ROOM ? over : below, room), TOP_ROOM);
    const next = `${Math.round(left)}px ${Math.round(top)}px`;
    if (next !== placed) {
      placed = next;
      section.style.translate = next;
    }
    if (section.dataset.placed === undefined) section.dataset.placed = "";
  });
  onCleanup(() => cancelAnimationFrame(frame));

  /** The inputs that have a picture. An input without one, such as a step that did not run yet, has no tile. */
  const pictures = () => step.inputs().filter((source) => step.inputUrl(source) !== undefined);
  const ready = () => !step.run.running() && step.runnable() && !step.locked() && step.model() !== undefined;
  takeKey(
    isEscape,
    (target) => section?.contains(target) === true,
    () => focusCard(),
  );
  // As in the chat composer, Mod+Enter sends: here it runs the step. Its settings popover is in a portal.
  takeKey(
    isSend,
    (target) =>
      section?.contains(target) === true ||
      (target instanceof Element && target.closest(".wfn-composer-popover, .wfn-composer-list") !== null),
    () => {
      if (ready()) step.run.start();
    },
  );

  // A description longer than 5 lines scrolls: an edge with more text behind it fades out.
  const promptFades = createScrollFades();
  onCleanup(promptFades.stop);
  createEffect(step.prompt, () => promptFades.remeasure());

  return (
    <section
      ref={(element: HTMLElement) => {
        section = element;
      }}
      class="wfn-composer"
      // The canvas keeps its selection, its drag and its keys for a press or a key in the composer.
      data-wfn-portal=""
      aria-label={text("title")}
    >
      <Show when={pictures().length > 0}>
        <ComposerPictures step={step} sources={pictures()} />
      </Show>
      <Textarea
        ref={(element: HTMLTextAreaElement) => promptFades.bind(element)}
        class={["wfn-composer-prompt", promptFades.classes()]}
        onScroll={promptFades.measure}
        aria-label={text("description")}
        placeholder={text("placeholder")}
        readonly={step.locked()}
        value={step.prompt()}
        onValueChange={step.setPrompt}
      />
      <div class="wfn-composer-bar">
        <ComposerModel step={step} id={props.id} />
        <SettingsChip step={step} id={props.id} />
        <RunButton step={step} id={props.id} ready={ready()} />
      </div>
    </section>
  );
}

function ComposerModel(props: { step: MediaStep; id: string }) {
  const { t } = useText();
  const board = useBoard();
  return (
    <MediaModelPicker
      kind={props.step.kind()}
      models={props.step.models()}
      model={props.step.model()}
      account={props.step.account()}
      title={t(KIND_TEXT[props.step.kind()].models)}
      disabled={props.step.specsDisabled()}
      onChange={(next, accountId) => board.setFields(props.id, { model: next.id, account: accountId ?? "" })}
    />
  );
}

/**
 * The pictures that come into the step, with the frame that each one gives a video. A connection on
 * the canvas adds or removes a picture.
 */
function ComposerPictures(props: { step: MediaStep; sources: readonly string[] }) {
  const { t } = useText();
  return (
    <ScrollEdges axis="x" label={t("workflow.media.inputs")}>
      <ul class="wfn-composer-pictures">
        <For each={props.sources}>
          {(source, index) => {
            const role = () => props.step.roleOf(source);
            const badge = () => {
              const current = role();
              return current === "reference" ? undefined : t(ROLE_BADGE[current]);
            };
            return (
              <li class="wfn-composer-picture">
                <img src={props.step.inputUrl(source)} alt="" />
                <Show when={badge()}>
                  {(mark) => (
                    <span class="wfn-composer-badge" aria-hidden="true">
                      {mark()}
                    </span>
                  )}
                </Show>
                <span class="sr-only">
                  {t("workflow.media.inputLabel", { index: String(index() + 1), role: t(ROLE_TEXT[role()]) })}
                </span>
              </li>
            );
          }}
        </For>
      </ul>
    </ScrollEdges>
  );
}

interface Choice<T extends string> {
  value: T;
  label: string;
  /** A longer name for a screen reader, such as the shape of an aspect ratio. */
  name?: string;
}

/**
 * One chip with the specs of the step. It opens all the settings at once, as tiles: the length, the
 * frame, the resolution, the voice of a video or the background of a picture, and the other settings
 * of the model.
 */
function SettingsChip(props: { step: MediaStep; id: string }) {
  const { t } = useText();
  const board = useBoard();
  const step = props.step;
  const specs = () => step.specs();
  const video = () => step.kind() === "video";
  const durations = () => step.durations();
  const durationIndex = () => Math.max(0, durations().indexOf(specs().duration));
  const seconds = (value: number) => t("workflow.video.seconds", { value: String(value) });
  const sizeText = (size: WorkflowMediaSize) =>
    t("workflow.image.sizeValue", { width: String(size.width), height: String(size.height) });
  const summary = () => {
    const size = specs().size;
    return [
      size ? sizeText(size) : specs().aspect,
      video() ? seconds(specs().duration) : undefined,
      size ? undefined : specs().resolution,
      !video() && specs().transparent ? t(BACKGROUND_TEXT.transparent) : undefined,
      video() && step.model()?.voices && step.voice() ? step.voiceText() : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const frames = (): readonly Choice<Frame>[] => [
    ...step.aspects().map((value) => ({ value, label: value, name: t(ASPECT_SHAPE[value]) })),
    ...(step.customAllowed()
      ? [{ value: WORKFLOW_MEDIA_CUSTOM_ASPECT, label: t("workflow.image.aspect.custom") } as const]
      : []),
  ];
  /** Auto, where the host chooses the mode from the inputs that come in, then each mode of the model. */
  const modes = (): readonly Choice<string>[] => [
    { value: "auto", label: t("workflow.video.modeAuto") },
    ...step.modes().map((entry) => {
      const key = modeNameKey(entry.value);
      return { value: entry.value, label: key ? t(key) : readableName(entry.value) };
    }),
  ];
  const voices = (): readonly Choice<string>[] => [
    { value: "auto", label: t("workflow.video.voiceAuto") },
    ...WORKFLOW_VIDEO_VOICES.map((preset) => ({ value: preset.id, label: preset.name })),
  ];
  const backgrounds = (): readonly Choice<Background>[] => [
    { value: "solid", label: t(BACKGROUND_TEXT.solid) },
    { value: "transparent", label: t(BACKGROUND_TEXT.transparent) },
  ];
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let content: HTMLElement | undefined;
  // A press on the chip also reaches the canvas. So after the popover opens, the focus goes to its
  // first setting, and Tab and the arrow keys start in the settings.
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (!content || content.contains(document.activeElement)) return;
      content.querySelector<HTMLElement>("[role='slider'], button, input")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });
  // The popover takes each Escape while it is open, so the canvas keeps its selection. An open list of
  // a tile closes first.
  takeKey(
    isEscape,
    (target) => open() && !(target instanceof Element && target.closest(".wfn-composer-list")),
    () => {
      setOpen(false);
      trigger?.focus();
    },
  );
  return (
    // Under the chip, so the card stays in view. With no space under it, the popover goes over the chip.
    <Popover.Root placement="bottom-start" gutter={8} open={open()} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={(element: HTMLButtonElement) => {
          trigger = element;
        }}
        class="wfn-composer-chip"
        aria-label={t("workflow.media.settingsLabel", { value: summary() })}
        disabled={step.specsDisabled()}
      >
        <SlidersHorizontal aria-hidden="true" />
        {summary()}
        <ChevronDown class="wfn-composer-arrow" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLElement) => {
            content = element;
          }}
          class="wfn-composer-popover"
          data-wfn-portal=""
          aria-label={t("workflow.media.settings")}
        >
          {/* A short window keeps the popover in view: the settings scroll, and an edge with more fades out. */}
          <ScrollEdges axis="y" class="wfn-composer-scroll" viewClass="wfn-composer-settings">
            <Show when={video() && durations().length > 1}>
              {/* A tick marks each length that the model makes. */}
              <div
                class="wfn-composer-length"
                style={{ "--wfn-composer-steps": String(durations().length - 1) }}
                data-full={durationIndex() === durations().length - 1 ? "" : undefined}
              >
                <SliderField
                  label={t("workflow.video.length")}
                  value={durationIndex()}
                  minValue={0}
                  maxValue={durations().length - 1}
                  step={1}
                  formatValue={(index) => seconds(durations()[index] ?? specs().duration)}
                  onChange={(index) => {
                    const next = durations()[index];
                    if (next !== undefined && next !== specs().duration) step.setDuration(next);
                  }}
                />
              </div>
            </Show>
            <PickTile
              label={t("workflow.image.aspect")}
              value={specs().size ? WORKFLOW_MEDIA_CUSTOM_ASPECT : specs().aspect}
              options={frames()}
              onChange={step.chooseFrame}
            />
            <Show when={specs().size}>
              {(size) => (
                <SizeFields
                  size={size()}
                  onChange={(next) => board.setFields(props.id, { width: next.width, height: next.height })}
                />
              )}
            </Show>
            {/* A custom size sets the resolution that the model makes. */}
            <Show when={!specs().size && step.resolutions().length > 0}>
              <PickTile
                label={t("workflow.video.resolution")}
                value={specs().resolution ?? ""}
                options={step.resolutions().map((value) => ({ value, label: value }))}
                onChange={step.setResolution}
              />
            </Show>
            {/* The mode sets which inputs the card has. It comes after the frame tiles, so that it does not stand alone on a row. */}
            <Show when={step.modes().length > 0}>
              <PickTile
                label={t("workflow.video.mode")}
                value={step.mode() || "auto"}
                options={modes()}
                onChange={(value) => step.setMode(value === "auto" ? "" : value)}
              />
            </Show>
            <Show when={video() && step.model()?.voices}>
              <PickTile
                label={t("workflow.video.voice")}
                value={step.voice() || "auto"}
                options={voices()}
                onChange={(value) => step.setVoice(value === "auto" ? "" : value)}
              />
            </Show>
            <Show when={!video() && step.model()?.transparent}>
              <PickTile
                label={t("workflow.image.background")}
                value={specs().transparent ? "transparent" : "solid"}
                options={backgrounds()}
                onChange={step.setBackground}
              />
            </Show>
            <Show when={step.options().length > 0}>
              <ModelOptions options={step.options()} onChange={step.setOption} />
            </Show>
          </ScrollEdges>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The other settings that the service lists for the model, such as sound or bitrate. A switch is a tile with a switch. */
function ModelOptions(props: { options: readonly MediaStepOption[]; onChange: (name: string, value: string) => void }) {
  const { t } = useText();
  const name = (entry: MediaStepOption) => {
    const key = optionNameKey(entry.option);
    return key ? t(key) : readableName(entry.option.name);
  };
  return (
    // Each change gives new entries; a key by name keeps the tiles, so an open list stays open.
    <For each={props.options} keyed={(entry) => entry.option.name}>
      {(entry) => (
        <Show
          when={entry().option.kind === "switch"}
          fallback={
            <PickTile
              label={name(entry())}
              value={entry().value}
              options={entry().option.values.map((value) => {
                const key = optionValueKey(value);
                return { value, label: key ? t(key) : readableName(value) };
              })}
              onChange={(value) => props.onChange(entry().option.name, value)}
            />
          }
        >
          <SwitchField
            class="wfn-composer-toggle"
            label={name(entry())}
            checked={entry().value === "on"}
            onChange={(on: boolean) => props.onChange(entry().option.name, on ? "on" : "off")}
          />
        </Show>
      )}
    </For>
  );
}

/** A custom size as one tile, next to the aspect ratio: its name over the width and the height. */
function SizeFields(props: { size: WorkflowMediaSize; onChange: (size: WorkflowMediaSize) => void }) {
  const { t } = useText();
  const commit = (side: keyof WorkflowMediaSize, input: HTMLInputElement) => {
    const next = typedSide(input.value, props.size[side]);
    input.value = String(next);
    if (next !== props.size[side]) props.onChange({ ...props.size, [side]: next });
  };
  const field = (side: keyof WorkflowMediaSize) => (
    <Input
      class="wfn-composer-size-input"
      type="number"
      inputmode="numeric"
      size="sm"
      aria-label={t(side === "width" ? "workflow.image.width" : "workflow.image.height")}
      min={WORKFLOW_MEDIA_SIZE_MIN}
      max={WORKFLOW_MEDIA_SIZE_MAX}
      step={1}
      value={String(props.size[side])}
      onChange={(event) => commit(side, event.currentTarget)}
    />
  );
  return (
    <fieldset class="wfn-composer-size">
      <legend class="wfn-composer-pick-name">{t("workflow.image.size")}</legend>
      <div class="wfn-composer-size-row">
        {field("width")}
        <X class="wfn-composer-size-by" aria-hidden="true" />
        {field("height")}
      </div>
    </fieldset>
  );
}

/**
 * A setting as a tile: its name over its value. A press opens the list of its choices, which shows the
 * longer name of a choice, such as the shape of an aspect ratio.
 */
function PickTile<T extends string>(props: {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  const choice = (value: T) => props.options.find((option) => option.value === value);
  // Kobalte fails when its list changes in a render; the list changes only when its values do.
  const values = createMemo(() => props.options.map((option) => option.value), {
    equals: (before, after) => before.length === after.length && before.every((value, index) => value === after[index]),
  });
  return (
    <Select<T>
      class="wfn-composer-tile"
      options={values()}
      value={props.value}
      // A new list of choices with the same value sends no change.
      onChange={(next) => {
        if (next !== null && next !== props.value) props.onChange(next);
      }}
      placement="bottom-start"
      itemComponent={(item) => (
        <SelectItem item={item.item}>
          {choice(item.item.rawValue)?.label}
          <Show when={choice(item.item.rawValue)?.name}>
            {(name) => <span class="wfn-composer-list-note"> {name()}</span>}
          </Show>
        </SelectItem>
      )}
    >
      {/* Kobalte names the trigger by this label and then its value. */}
      <SelectTrigger class="wfn-composer-pick" aria-label={props.label}>
        <span class="wfn-composer-pick-name">{props.label}</span>
        <SelectValue<T>>{(state) => choice(state.selectedOption())?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent class="wfn-composer-list" data-wfn-portal="" />
    </Select>
  );
}

/**
 * Run with the price, as on the card, so the card shows the same run. While the step runs, the time
 * shows before Stop. A step in a run of the whole routine stops from the bar of the canvas.
 */
function RunButton(props: { step: MediaStep; id: string; ready: boolean }) {
  const { t } = useText();
  const step = props.step;
  const seconds = useElapsed(step.run.running);
  const making = () =>
    t(step.kind() === "video" ? "workflow.video.making" : "workflow.image.making", { time: clock(seconds()) });
  return (
    <>
      <Show when={step.run.running()}>
        <span class="wfn-composer-elapsed" role="timer" aria-label={making()}>
          {clock(seconds())}
        </span>
      </Show>
      <Show
        when={step.run.stop()}
        fallback={
          <Button
            class="wfn-composer-generate"
            loading={step.run.running()}
            disabled={!props.ready}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-label={step.runLabel()}
            onClick={step.run.start}
          >
            <Play aria-hidden="true" />
            {step.runText()}
          </Button>
        }
      >
        {(stop) => (
          <Button class="wfn-composer-generate" variant="secondary" onClick={() => stop()(props.id)}>
            <Square class="wfn-composer-stop" aria-hidden="true" />
            {t("workflow.node.stop")}
          </Button>
        )}
      </Show>
    </>
  );
}
