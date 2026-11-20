import type { ProviderLogoVariant } from "@openbot/brand";
import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import { isAgentProviderRef } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  CopyButton,
  CopyPlus,
  DropdownMenu,
  File,
  Image,
  Input,
  LabelTooltipTrigger,
  LoaderCircle,
  Lock,
  LockOpen,
  RotateCcw,
  Skeleton,
  Square,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Trash2,
  TriangleAlert,
  Type,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { children, createEffect, createSignal, createStore, For, onSettled, Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { PickerMenu } from "./WorkflowPicker";
import {
  customStepName,
  Hint,
  PORT_NAME,
  resizeCursor,
  resizeHandles,
  resultValue,
  STEP_NAME_FIELD,
  useBoard,
  type WfnBoard,
  type WfnFieldValue,
  type WfnPortSide,
  type WfnPortType,
  type WfnResult,
  type WorkflowAgentProgress,
} from "./workflow-board";
import type { WorkflowPlace } from "./workflow-model";

export type WfProvider = AgentProfile["provider"];

export function wfProviderLogo(provider: WfProvider): ProviderLogoVariant {
  return isKnownAgentProvider(provider) ? provider : "unknown";
}

export type NoteTone = "yellow" | "orange" | "red" | "pink" | "blue" | "teal" | "green";
export type CanvasColor = "ink" | NoteTone;
export type ShapeKind = "rectangle" | "circle" | "diamond" | "triangle" | "inverted" | "oval" | "star";
type BlockKind = "trigger" | "condition" | "output" | "approval" | "note" | "shape";

export function PortIcon(props: { type: WfnPortType }) {
  return (
    <Show when={props.type === "text"} fallback={props.type === "image" ? <Image /> : <File />}>
      <Type />
    </Show>
  );
}

export function Port(props: {
  node: string;
  type: WfnPortType;
  side: WfnPortSide;
  branch?: string | undefined;
  label?: string | undefined;
  missing?: boolean;
}) {
  const board = useBoard();
  const { t } = useText();
  let slot: HTMLSpanElement | undefined;
  onSettled(() =>
    slot
      ? board.port({ node: props.node, side: props.side, type: props.type, branch: props.branch, element: slot })
      : undefined,
  );
  const name = () => props.label ?? t(PORT_NAME[props.type]);
  const armed = () => board.armed(props.node, props.side, props.type, props.branch);
  const target = () => board.accepts(props.node, props.side, props.type, props.branch);
  const refused = () => board.refused(props.node, props.side, props.type, props.branch);
  const pressed = () => {
    if (!board.connecting()) return undefined;
    return armed() ? "true" : "false";
  };
  return (
    <span ref={slot} class="wfn-port-slot" data-side={props.side}>
      <Button
        variant="ghost"
        size="icon-xs"
        class="wfn-port"
        data-wfn-port-side={props.side}
        data-wfn-port-node={props.node}
        data-wfn-port-type={props.type}
        data-wfn-port-branch={props.branch}
        data-missing={props.missing ? "" : undefined}
        data-connected={board.drawsLine(props.node, props.side, props.type, props.branch) ? "" : undefined}
        data-armed={armed() ? "" : undefined}
        data-target={target() ? "" : undefined}
        data-refused={refused() ? "" : undefined}
        data-dim={board.connecting() && !armed() && !target() && !refused() ? "" : undefined}
        aria-label={
          props.side === "in"
            ? t("workflow.node.port.input", { name: name() })
            : t("workflow.node.port.output", { name: name() })
        }
        aria-pressed={pressed()}
        onPointerDown={(event: PointerEvent) => board.dragPort(props.node, props.side, props.type, event, props.branch)}
        onClick={() => board.pressPort(props.node, props.side, props.type, props.branch)}
      >
        <PortIcon type={props.type} />
      </Button>
      <span class="wfn-port-chip" aria-hidden="true">
        {name()}
      </span>
    </span>
  );
}

export function Toolbar(props: { id: string; children: JSX.Element }) {
  const board = useBoard();
  const [bar, setBar] = createSignal<{ width: number; height: number }>();
  let element: HTMLDivElement | undefined;
  onSettled(() => {
    const target = element;
    if (!target) return;
    const observer = new ResizeObserver(() => setBar({ width: target.offsetWidth, height: target.offsetHeight }));
    observer.observe(target);
    return () => observer.disconnect();
  });
  const below = () => {
    const size = bar();
    return size !== undefined && board.toolbarBelow(props.id, size);
  };
  return (
    <div
      ref={element}
      class="wfn-toolbar"
      data-wfn-portal=""
      data-side={below() ? "below" : undefined}
      data-strip={below() && board.results(props.id).length > 1 ? "" : undefined}
    >
      {props.children}
    </div>
  );
}

export function ToolbarSeparator() {
  return <span class="wfn-toolbar-separator" aria-hidden="true" />;
}

export function ToolAction(props: {
  text: string;
  label?: string;
  keys?: readonly string[];
  tone?: "danger";
  pressed?: boolean;
  icon: JSX.Element;
  onClick: () => void;
  onAim?: (aimed: boolean) => void;
}) {
  return (
    <Hint label={props.text} keys={props.keys}>
      <LabelTooltipTrigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        class="wfn-tool-action"
        aria-label={props.label ?? props.text}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
        data-tone={props.tone}
        onPointerEnter={() => props.onAim?.(true)}
        onPointerLeave={() => props.onAim?.(false)}
        onFocus={() => props.onAim?.(true)}
        onBlur={() => props.onAim?.(false)}
        onClick={() => props.onClick()}
      >
        {props.icon}
      </LabelTooltipTrigger>
    </Hint>
  );
}

export function download(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

export function NodeToolbar(props: {
  id: string;
  name: string;
  locked: boolean;
  onLock: (locked: boolean) => void;
  children?: JSX.Element;
}) {
  const board = useBoard();
  const { t } = useText();
  return (
    <>
      {props.children}
      <Show when={board.duplicate !== undefined}>
        <ToolAction
          text={t("workflow.node.toolbar.duplicate")}
          label={t("workflow.node.toolbar.duplicateNamed", { name: props.name })}
          icon={<CopyPlus />}
          onClick={() => board.duplicate?.(props.id)}
        />
      </Show>
      <ToolbarSeparator />
      <LockDelete id={props.id} name={props.name} locked={props.locked} onLock={props.onLock} />
    </>
  );
}

export function LockDelete(props: { id: string; name: string; locked: boolean; onLock: (locked: boolean) => void }) {
  const board = useBoard();
  const { t } = useText();
  return (
    <>
      <ToolAction
        text={props.locked ? t("workflow.node.toolbar.unlock") : t("workflow.node.toolbar.lock")}
        label={
          props.locked
            ? t("workflow.node.toolbar.unlockNamed", { name: props.name })
            : t("workflow.node.toolbar.lockNamed", { name: props.name })
        }
        pressed={props.locked}
        icon={
          <Show when={props.locked} fallback={<LockOpen />}>
            <Lock />
          </Show>
        }
        onClick={() => props.onLock(!props.locked)}
      />
      <Show when={!props.locked}>
        <ToolAction
          text={t("workflow.node.toolbar.delete")}
          label={t("workflow.node.toolbar.deleteNamed", { name: props.name })}
          keys={["⌫"]}
          tone="danger"
          icon={<Trash2 />}
          onAim={(aimed) => board.aimRemove(aimed ? [props.id] : [])}
          onClick={() => board.remove(props.id)}
        />
      </Show>
    </>
  );
}

export function useLocked(id: () => string): [() => boolean, (locked: boolean) => void] {
  const board = useBoard();
  return [() => board.isLocked(id()), (locked) => board.lock(id(), locked)];
}

export function useField<T extends WfnFieldValue>(
  id: () => string,
  key: string,
  initial: T,
  read: (value: WfnFieldValue) => T | undefined,
  typed = false,
): [() => T, (value: T) => void] {
  const board = useBoard();
  return [
    () => {
      const value = board.field(id(), key);
      return (value === undefined ? undefined : read(value)) ?? initial;
    },
    (value) => board.setField(id(), key, value, typed),
  ];
}

export function useTextField(id: () => string, key: string, initial: string): [() => string, (value: string) => void] {
  return useField(id, key, initial, asString, true);
}

export const asString = (value: WfnFieldValue): string | undefined => (typeof value === "string" ? value : undefined);
export const asBoolean = (value: WfnFieldValue): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export function oneOf<T extends WfnFieldValue>(values: readonly T[]): (value: WfnFieldValue) => T | undefined {
  return (value) => values.find((item) => item === value);
}

export const asProvider = (value: WfnFieldValue): WfProvider | undefined =>
  isAgentProviderRef(value) ? value : undefined;

export interface WfnInputPort {
  type: WfnPortType;
  branch?: string;
  label?: string;
}

export interface ShellProps {
  id: string;
  label: string;
  icon?: JSX.Element;
  kind:
    | "prompt"
    | "agent"
    | "llm"
    | "image"
    | "asset"
    | "trigger"
    | "condition"
    | "output"
    | "approval"
    | "note"
    | "shape";
  bare?: boolean;
  inputs?: readonly WfnPortType[];
  inputPorts?: readonly WfnInputPort[] | undefined;
  requires?: boolean;
  output?: WfnPortType | undefined;
  toolbar: JSX.Element;
  media?: boolean;
  clear?: boolean;
  thumb?: (result: WfnResult) => string | undefined;
  style?: JSX.CSSProperties;
  children: JSX.Element;
  action?: JSX.Element;
}

export function ResizeGrip(props: { id: string }) {
  const board = useBoard();
  return (
    <Show when={board.resizable && !board.isLocked(props.id)}>
      <For each={resizeHandles(board.stretch(props.id))}>
        {(handle) => (
          <span
            class="wfn-grip"
            data-wfn-resize={props.id}
            data-corner={handle}
            data-side={handle.length === 1 ? "" : undefined}
            data-cursor={resizeCursor(board.stretch(props.id), handle)}
            aria-hidden="true"
          />
        )}
      </For>
    </Show>
  );
}

export function NodeShell(props: ShellProps) {
  const board = useBoard();
  const { t } = useText();
  const selected = () => board.selected() === props.id;
  const action = children(() => props.action);
  const stop = () => stopOf(board, props.id);
  const inputPorts = (): readonly WfnInputPort[] => props.inputPorts ?? (props.inputs ?? []).map((type) => ({ type }));
  const missing = () =>
    props.requires === true && !inputPorts().some((port) => board.connected(props.id, "in", port.type, port.branch));
  const style = (): JSX.CSSProperties => {
    const size = board.size(props.id);
    return {
      ...props.style,
      ...(size?.width === undefined ? {} : { "--wfn-width": `${size.width}px` }),
      ...(size?.height === undefined ? {} : { "--wfn-height": `${size.height}px` }),
    };
  };
  return (
    <Show when={!board.isRemoved(props.id)}>
      <article
        class="wfn-node"
        data-kind={props.kind}
        data-node-id={props.id}
        data-selected={board.isSelected(props.id) ? "" : undefined}
        data-doomed={board.isDoomed(props.id) ? "" : undefined}
        data-locked={board.isLocked(props.id) ? "" : undefined}
        tabindex={board.resizable ? 0 : undefined}
        data-status={board.status(props.id)}
        data-height={board.size(props.id)?.height === undefined ? undefined : ""}
        aria-label={customStepName(board.field(props.id, STEP_NAME_FIELD)) ?? props.label}
        style={style()}
      >
        <Show when={selected()}>
          <Toolbar id={props.id}>{props.toolbar}</Toolbar>
        </Show>
        <span class="wfn-label" data-bare={props.bare ? "" : undefined}>
          <Show when={!props.bare}>
            {props.icon}
            <StepName id={props.id} kind={props.label} />
          </Show>
          <Show when={board.isLocked(props.id)}>
            <span class="wfn-lock-badge" role="img" aria-label={t("workflow.node.locked")}>
              <Lock />
            </span>
          </Show>
          <RunTime id={props.id} />
        </span>
        <div class="wfn-card-frame">
          <div
            class="wfn-card"
            data-media={props.media ? "" : undefined}
            data-clear={props.media && props.clear ? "" : undefined}
          >
            {props.children}
            <Show when={missing() && (selected() || board.status(props.id) !== undefined)}>
              <p class="wfn-alert" data-tone="warning">
                <TriangleAlert aria-hidden="true" />
                <span class="wfn-alert-text">{t("workflow.node.missingInput")}</span>
              </p>
            </Show>
            <Show when={action()}>
              <Show
                when={board.status(props.id) === "failed" && board.retry}
                fallback={
                  <Show when={stop()} fallback={action()}>
                    {(stop) => (
                      <Button class="wfn-run" variant="secondary" fullWidth onClick={() => stop()(props.id)}>
                        {t("workflow.node.stop")}
                        <Square aria-hidden="true" />
                      </Button>
                    )}
                  </Show>
                }
              >
                {(retry) => (
                  <Button class="wfn-run" fullWidth onClick={() => retry()(props.id)}>
                    {t("workflow.node.retry")}
                    <RotateCcw aria-hidden="true" />
                  </Button>
                )}
              </Show>
            </Show>
          </div>
          <ResizeGrip id={props.id} />
        </div>
        <Show when={selected()}>
          <ResultStrip id={props.id} thumb={props.thumb} />
        </Show>
        <Show when={inputPorts().length}>
          <span class="wfn-ports" data-side="in">
            <For each={inputPorts()}>
              {(port) => (
                <Port
                  node={props.id}
                  type={port.type}
                  side="in"
                  branch={port.branch}
                  label={port.label}
                  missing={missing()}
                />
              )}
            </For>
          </span>
        </Show>
        <Show when={props.output}>
          {(type) => (
            <span class="wfn-ports" data-side="out">
              <Port node={props.id} type={type()} side="out" />
            </span>
          )}
        </Show>
      </article>
    </Show>
  );
}

function StepName(props: { id: string; kind: string }) {
  const board = useBoard();
  const { t } = useText();
  const value = () => {
    const name = board.field(props.id, STEP_NAME_FIELD);
    return typeof name === "string" ? name : "";
  };
  return (
    <Input
      class="wfn-frame-name wfn-step-name"
      value={value()}
      placeholder={props.kind}
      aria-label={t("workflow.node.name")}
      spellcheck={false}
      autocomplete="off"
      readonly={board.isLocked(props.id)}
      onValueChange={(next) => board.setField(props.id, STEP_NAME_FIELD, next, true)}
      onBlur={() => {
        const trimmed = value().trim();
        if (trimmed !== value()) board.setField(props.id, STEP_NAME_FIELD, trimmed, true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}

function RunTime(props: { id: string }) {
  const board = useBoard();
  const { t, format } = useText();
  const [clock, setClock] = createStore({ ms: 0, done: false });
  let start = 0;
  createEffect(
    () => board.status(props.id),
    (status, before) => {
      if (status === "running") {
        start = performance.now();
        setClock((draft) => {
          draft.ms = 0;
          draft.done = false;
        });
        const timer = setInterval(
          () =>
            setClock((draft) => {
              draft.ms = performance.now() - start;
            }),
          100,
        );
        return () => clearInterval(timer);
      }
      if (status === "done" && before === "running") {
        setClock((draft) => {
          draft.ms = performance.now() - start;
          draft.done = true;
        });
        const timer = setTimeout(
          () =>
            setClock((draft) => {
              draft.done = false;
            }),
          1800,
        );
        return () => clearTimeout(timer);
      }
      setClock((draft) => {
        draft.done = false;
      });
      return undefined;
    },
  );
  return (
    <Show
      when={board.status(props.id) === "running" || clock.done}
      fallback={
        <Show when={board.status(props.id) === "failed"}>
          <span class="wfn-run-time" data-failed role="status">
            <CircleX aria-hidden="true" />
            {t("workflow.node.failed")}
          </span>
        </Show>
      }
    >
      <span class="wfn-run-time" data-done={clock.done ? "" : undefined}>
        <Show when={clock.done} fallback={<LoaderCircle class="wfn-hud-spin" aria-hidden="true" />}>
          <CircleCheck aria-hidden="true" />
        </Show>
        {t("workflow.node.runTime", {
          seconds: format.number(clock.ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        })}
      </span>
    </Show>
  );
}

export function ResultField(props: { id: string; running: boolean }) {
  const board = useBoard();
  const { t } = useText();
  const value = () => resultValue(board.shown(props.id)) ?? "";
  const failure = () => resultFailure(board, props.id);
  const live = () => (props.running ? board.progress(props.id) : undefined);
  return (
    <Show when={value() || failure() || props.running}>
      <Field class="wfn-field-result">
        <div class="wfn-field-head">
          <span>{t("workflow.node.result.title")}</span>
          <Show when={live()?.done}>
            {(done) => <span class="wfn-result-count">{t("workflow.node.stepsDone", { count: done() })}</span>}
          </Show>
          <CopyButton
            value={value()}
            iconOnly
            label={t("workflow.node.result.copy")}
            disabled={props.running || !value()}
          />
        </div>
        <div class="wfn-result-body" data-running={props.running ? "" : undefined} data-live={live() ? "" : undefined}>
          <Show when={value() || failure()}>
            <p data-failed={value() ? undefined : ""}>{value() || failure()}</p>
          </Show>
          <Show when={props.running}>
            <ResultPending />
          </Show>
          <Show when={live()}>{(progress) => <LiveProgress id={props.id} progress={progress()} />}</Show>
        </div>
      </Field>
    </Show>
  );
}

function resultFailure(board: WfnBoard, id: string): string | undefined {
  const shown = board.shown(id);
  if (shown?.failed) return shown.value;
  return shown === undefined && board.status(id) === "failed" ? board.error(id) : undefined;
}

export function FailureAlert(props: { id: string; running: boolean }) {
  const board = useBoard();
  return (
    <Show when={props.running ? undefined : resultFailure(board, props.id)}>
      {(failure) => (
        <p class="wfn-alert" data-tone="danger">
          <CircleX aria-hidden="true" />
          <span class="wfn-alert-text">{failure()}</span>
        </p>
      )}
    </Show>
  );
}

function LiveProgress(props: { id: string; progress: WorkflowAgentProgress }) {
  const board = useBoard();
  const agent = () => {
    const agentId = board.field(props.id, "agentId");
    return board.catalogs().agents.find((entry) => entry.id === agentId);
  };
  return (
    <div class="wfn-result-live" role="status" aria-live="polite">
      <AgentAvatar agent={agent()} mood="working" activity={props.progress.activity} class="wfn-result-live-avatar" />
      <div class="wfn-result-live-lines">
        <span class="wfn-result-live-text">{props.progress.detail}</span>
        <Show when={props.progress.previous}>
          {(previous) => <span class="wfn-result-live-previous">{previous()}</span>}
        </Show>
      </div>
    </div>
  );
}

function ResultPending() {
  return (
    <div class="wfn-result-pending" aria-hidden="true">
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}

export function Field(props: { class?: string; children: JSX.Element }) {
  return <div class={`wfn-field ${props.class ?? ""}`}>{props.children}</div>;
}

function resultName(t: AppTranslate, result: WfnResult): string {
  if (result.run === undefined)
    return result.failed ? t("workflow.node.result.stepFailed") : t("workflow.node.result.step");
  return result.failed
    ? t("workflow.node.result.runFailed", { run: result.run })
    : t("workflow.node.result.run", { run: result.run });
}

export function resultTime(format: AppFormat, at: string): string {
  const date = new Date(at);
  const today = date.toDateString() === new Date().toDateString();
  return format.date(
    date,
    today
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  );
}

function ResultStrip(props: { id: string; thumb?: ((result: WfnResult) => string | undefined) | undefined }) {
  const board = useBoard();
  const { t, format } = useText();
  const list = () => board.results(props.id);
  const index = () => {
    const shown = board.shown(props.id);
    return shown ? list().indexOf(shown) : -1;
  };
  const go = (step: number) => {
    const next = list()[index() + step];
    if (next) board.pick(props.id, next.id);
  };
  let items: HTMLSpanElement | undefined;
  createEffect(
    () => (list().length > 1 ? board.shown(props.id)?.id : undefined),
    (id, before) => {
      const item = id ? items?.querySelector<HTMLElement>('[aria-pressed="true"]') : null;
      if (!items || !item) return;
      items.scrollTo({
        left: item.offsetLeft + item.offsetWidth / 2 - items.clientWidth / 2,
        behavior: before === undefined || prefersReducedMotion() ? "instant" : "smooth",
      });
    },
  );
  const scrollOnWheel = (event: WheelEvent) => {
    if (!items || event.ctrlKey || event.metaKey) return;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? items.clientWidth
          : 1;
    const rightToLeft = getComputedStyle(items).direction === "rtl";
    const sideways = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
    const step = (sideways ? event.deltaX : rightToLeft ? -event.deltaY : event.deltaY) * unit;
    const end = items.scrollWidth - items.clientWidth;
    const [min, max] = rightToLeft ? [-end, 0] : [0, end];
    if (step === 0 || (step > 0 ? items.scrollLeft >= max - 1 : items.scrollLeft <= min + 1)) return;
    event.preventDefault();
    event.stopPropagation();
    items.scrollLeft += step;
  };
  return (
    <Show when={list().length > 1}>
      <fieldset class="wfn-strip" aria-label={t("workflow.node.result.list")}>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("workflow.node.result.previous")}
          disabled={index() <= 0}
          onClick={() => go(-1)}
        >
          <ChevronLeft />
        </Button>
        <span ref={items} class="wfn-strip-list" onWheel={scrollOnWheel}>
          <For each={list()}>
            {(result, at) => (
              <Hint
                label={t("workflow.node.result.hint", {
                  name: resultName(t, result),
                  time: resultTime(format, result.at),
                })}
              >
                <LabelTooltipTrigger
                  type="button"
                  class="wfn-strip-item"
                  aria-label={t("workflow.node.result.label", {
                    number: at() + 1,
                    name: resultName(t, result),
                    time: resultTime(format, result.at),
                  })}
                  aria-pressed={result.id === board.shown(props.id)?.id ? "true" : "false"}
                  data-failed={result.failed ? "" : undefined}
                  onClick={() => board.pick(props.id, result.id)}
                >
                  <Show when={!result.failed} fallback={<CircleX class="wfn-strip-failed" aria-hidden="true" />}>
                    <Show when={props.thumb?.(result)} fallback={<span class="wfn-strip-number">{at() + 1}</span>}>
                      {(src) => <img src={src()} alt="" />}
                    </Show>
                  </Show>
                </LabelTooltipTrigger>
              </Hint>
            )}
          </For>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("workflow.node.result.next")}
          disabled={index() >= list().length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight />
        </Button>
      </fieldset>
    </Show>
  );
}

export function useStepRun(id: string) {
  const board = useBoard();
  return {
    running: () => board.status(id) === "running",
    start: () => board.runStep(id),
    stop: () => stopOf(board, id),
  };
}

export function stopOf(board: WfnBoard, id: string) {
  return board.status(id) === "running" && !board.running() ? board.stopStep : undefined;
}

interface Range {
  min: number;
  max: number;
}

export const BLOCK_RESIZE: Record<BlockKind, { width: Range; height?: Range }> = {
  trigger: { width: { min: 240, max: 480 } },
  condition: { width: { min: 260, max: 560 } },
  output: { width: { min: 240, max: 480 } },
  approval: { width: { min: 260, max: 560 } },
  note: { width: { min: 160, max: 480 }, height: { min: 120, max: 480 } },
  shape: { width: { min: 48, max: 960 }, height: { min: 48, max: 960 } },
};

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon: () => JSX.Element;
}

export interface KeyedChoice<T extends string> {
  value: T;
  label: AppTextKey;
}

export const TONES: readonly KeyedChoice<NoteTone>[] = [
  { value: "yellow", label: "workflow.color.yellow" },
  { value: "orange", label: "workflow.color.orange" },
  { value: "red", label: "workflow.color.red" },
  { value: "pink", label: "workflow.color.pink" },
  { value: "blue", label: "workflow.color.blue" },
  { value: "teal", label: "workflow.color.teal" },
  { value: "green", label: "workflow.color.green" },
];

export const COLORS: readonly KeyedChoice<CanvasColor>[] = [{ value: "ink", label: "workflow.color.ink" }, ...TONES];

export const translated = <T extends string>(t: AppTranslate, choices: readonly KeyedChoice<T>[]) =>
  choices.map((choice) => ({ value: choice.value, label: t(choice.label) }));

export const colorVar = (color: CanvasColor) =>
  color === "ink" ? "var(--openbot-text-primary)" : `var(--openbot-file-${color})`;

export function Swatch(props: { color: CanvasColor }) {
  return <span class="wfn-swatch" style={{ "--wfn-swatch": colorVar(props.color) }} />;
}

export type TextFont = "sans" | "mono";
export type TextAlign = "start" | "center" | "end" | "justify";

export const FONTS: readonly KeyedChoice<TextFont>[] = [
  { value: "sans", label: "workflow.text.font.sans" },
  { value: "mono", label: "workflow.text.font.mono" },
];

export const ALIGNS: readonly KeyedChoice<TextAlign>[] = [
  { value: "start", label: "workflow.text.align.start" },
  { value: "center", label: "workflow.text.align.center" },
  { value: "end", label: "workflow.text.align.end" },
  { value: "justify", label: "workflow.text.align.justify" },
];

export const isTone = oneOf(TONES.map((choice) => choice.value));
export const isColor = oneOf(COLORS.map((choice) => choice.value));
export const isFont = oneOf(FONTS.map((choice) => choice.value));
export const isAlign = oneOf(ALIGNS.map((choice) => choice.value));

export const ALIGN_ICONS: Record<TextAlign, typeof TextAlignStart> = {
  start: TextAlignStart,
  center: TextAlignCenter,
  end: TextAlignEnd,
  justify: TextAlignJustify,
};

export function ToolbarChoice<T extends string>(props: {
  name: string;
  value: T;
  choices: readonly { value: T; label: string; meta?: string }[];
  icon?: (value: T) => JSX.Element;
  tile?: (value: T, index: number) => JSX.Element;
  onChange: (value: T) => void;
}) {
  const { t } = useText();
  const current = () => props.choices.find((choice) => choice.value === props.value);
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={8}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-toolbar-select`}
        aria-label={t("workflow.node.choice", { name: props.name, value: current()?.label ?? props.value })}
      >
        {props.icon ? props.icon(props.value) : current()?.meta}
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={props.name}
          groups={[
            {
              options: props.choices.map((choice, index) => ({
                value: choice.value,
                label: choice.label,
                tile: () => (props.tile ?? props.icon)?.(choice.value, index),
                ...(choice.meta ? { chips: [{ text: choice.meta }] } : {}),
              })),
            },
          ]}
          value={props.value}
          onSelect={props.onChange}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export const placeKey = (connectionId: string, placeId: string) => JSON.stringify([connectionId, placeId]);

export function usePlace(
  id: () => string,
  initial: { connectionId?: string | undefined; placeId?: string | undefined },
) {
  const board = useBoard();
  const first = untrack(() => board.catalogs().places[0]);
  const [connectionId] = useField(
    id,
    "connectionId",
    untrack(() => initial.connectionId ?? first?.connectionId ?? ""),
    asString,
  );
  const [placeId] = useField(
    id,
    "placeId",
    untrack(() => initial.placeId ?? first?.placeId ?? ""),
    asString,
  );
  return {
    connectionId,
    placeId,
    set: (place: WorkflowPlace) => board.setFields(id(), { connectionId: place.connectionId, placeId: place.placeId }),
  };
}
