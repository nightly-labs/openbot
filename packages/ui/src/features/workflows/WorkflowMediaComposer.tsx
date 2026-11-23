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
import { ROLE_BADGE, ROLE_TEXT } from "./workflow-input-pictures";
import {
  ASPECT_SHAPE,
  BACKGROUND_TEXT,
  type Background,
  type Frame,
  KIND_TEXT,
  MEDIA_BATCH_SIZES,
  type MediaStep,
  type MediaStepOption,
  modeNameKey,
  optionNameKey,
  optionValueKey,
  RunContent,
  readableName,
  resolutionName,
  typedSide,
  useMediaStep,
} from "./workflow-media-step";
import { clock, useElapsed } from "./workflow-node-parts";

const GAP = 10;
const TOP_ROOM = 56;
const BOTTOM_ROOM = 80;
const BELOW = '.wfn-card-frame, .wfn-strip, .wfn-toolbar[data-side="below"]';
const ABOVE = ".wfn-card-frame, .wfn-label, .wfn-toolbar";

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

export function WorkflowMediaComposer(props: {
  id: string;
  root: () => HTMLElement | undefined;
  moves: () => unknown;
}) {
  const { t } = useText();
  const step = useMediaStep(untrack(() => props.id));
  const text = (key: keyof (typeof KIND_TEXT)["image"]) => t(KIND_TEXT[step.kind()][key]);
  let section: HTMLElement | undefined;
  const node = () => props.root()?.querySelector<HTMLElement>(`.wfn-node[data-node-id="${CSS.escape(props.id)}"]`);
  const focusCard = () => node()?.focus({ preventScroll: true });

  let placed = "";
  let frame = 0;
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(place);
  };
  const sizes = new ResizeObserver(schedule);
  const parts = new MutationObserver(schedule);
  let watched: Element | undefined;
  const watch = (root: Element, card: Element) => {
    if (watched === card) return;
    if (watched) sizes.unobserve(watched);
    parts.disconnect();
    watched = card;
    sizes.observe(root);
    sizes.observe(card);
    parts.observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-side"] });
  };
  function place() {
    frame = 0;
    const root = props.root();
    const card = node();
    const media = card?.querySelector(".wfn-card-frame") ?? card;
    if (!section || !root || !card || !media) return;
    watch(root, card);
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
  }
  createEffect(props.moves, schedule);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    sizes.disconnect();
    parts.disconnect();
  });

  const pictures = () => step.inputs().filter((source) => step.inputUrl(source) !== undefined);
  const ready = () => !step.busy() && step.runnable() && !step.locked() && !step.short() && step.model() !== undefined;
  takeKey(
    isEscape,
    (target) => section?.contains(target) === true,
    () => focusCard(),
  );
  takeKey(
    isSend,
    (target) =>
      section?.contains(target) === true ||
      (target instanceof Element && target.closest(".wfn-composer-popover, .wfn-composer-list") !== null),
    () => {
      if (ready()) step.run.start();
    },
  );

  const promptFades = createScrollFades();
  onCleanup(promptFades.stop);
  createEffect(step.prompt, () => promptFades.remeasure());

  return (
    <section
      ref={(element: HTMLElement) => {
        section = element;
        sizes.observe(element);
        schedule();
      }}
      class="wfn-composer"
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
  name?: string;
}

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
      size || !specs().resolution ? undefined : resolutionName(specs().resolution ?? ""),
      !video() && specs().transparent ? t(BACKGROUND_TEXT.transparent) : undefined,
      video() && step.model()?.voices && step.voice() ? step.voiceText() : undefined,
      step.batch() > 1 ? t("workflow.media.batchCount", { value: String(step.batch()) }) : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const batches = (): readonly Choice<string>[] =>
    MEDIA_BATCH_SIZES.map((count) => ({
      value: String(count),
      label: t(video() ? "workflow.media.batchVideos" : "workflow.media.batchImages", { count }),
    }));
  const frames = (): readonly Choice<Frame>[] => [
    ...step.aspects().map((value) => ({ value, label: value, name: t(ASPECT_SHAPE[value]) })),
    ...(step.customAllowed()
      ? [{ value: WORKFLOW_MEDIA_CUSTOM_ASPECT, label: t("workflow.image.aspect.custom") } as const]
      : []),
  ];
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
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (!content || content.contains(document.activeElement)) return;
      content.querySelector<HTMLElement>("[role='slider'], button, input")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });
  takeKey(
    isEscape,
    (target) => open() && !(target instanceof Element && target.closest(".wfn-composer-list")),
    () => {
      setOpen(false);
      trigger?.focus();
    },
  );
  return (
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
          <ScrollEdges axis="y" class="wfn-composer-scroll" viewClass="wfn-composer-settings">
            <Show when={video() && durations().length > 1}>
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
            <Show when={!specs().size && step.resolutions().length > 0}>
              <PickTile
                label={t("workflow.video.resolution")}
                value={specs().resolution ?? ""}
                options={step.resolutions().map((value) => ({ value, label: resolutionName(value) }))}
                onChange={step.setResolution}
              />
            </Show>
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
            <PickTile
              label={t("workflow.media.batch")}
              value={String(step.batch())}
              options={batches()}
              onChange={(value) => step.setBatch(Number(value))}
            />
          </ScrollEdges>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelOptions(props: { options: readonly MediaStepOption[]; onChange: (name: string, value: string) => void }) {
  const { t } = useText();
  const name = (entry: MediaStepOption) => {
    const key = optionNameKey(entry.option);
    return key ? t(key) : readableName(entry.option.name);
  };
  return (
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

function PickTile<T extends string>(props: {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  const choice = (value: T) => props.options.find((option) => option.value === value);
  const values = createMemo(() => props.options.map((option) => option.value), {
    equals: (before, after) => before.length === after.length && before.every((value, index) => value === after[index]),
  });
  return (
    <Select<T>
      class="wfn-composer-tile"
      options={values()}
      value={props.value}
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
      <SelectTrigger class="wfn-composer-pick" aria-label={props.label}>
        <span class="wfn-composer-pick-name">{props.label}</span>
        <SelectValue<T>>{(state) => choice(state.selectedOption())?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent class="wfn-composer-list" data-wfn-portal="" />
    </Select>
  );
}

function RunButton(props: { step: MediaStep; id: string; ready: boolean }) {
  const { t } = useText();
  const step = props.step;
  const seconds = useElapsed(step.busy);
  const making = () =>
    t(step.kind() === "video" ? "workflow.video.making" : "workflow.image.making", { time: clock(seconds()) });
  return (
    <>
      <Show when={step.busy()}>
        <span class="wfn-composer-elapsed" role="timer" aria-label={making()}>
          {clock(seconds())}
        </span>
      </Show>
      <Show
        when={step.run.stop()}
        fallback={
          <Button
            class="wfn-composer-generate"
            loading={step.busy()}
            disabled={!props.ready}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-label={step.runLabel()}
            onClick={step.run.start}
          >
            <RunContent credits={step.total()} takes={step.batch()} />
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
