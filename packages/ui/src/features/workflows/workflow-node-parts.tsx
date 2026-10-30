/**
 * The parts that the workflow nodes share: the ports, the label row, the toolbar of the selected node
 * with Lock and Delete, the fields that live on the board, the run time, the result field and the
 * results strip. The control blocks share their choice pills, the toolbar menus and the colours.
 */

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
  Hash,
  Image,
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
import { PickerMenu } from "./WorkflowPicker";
import {
  Hint,
  PORT_NAME,
  resizeCursor,
  resizeHandles,
  resultValue,
  useBoard,
  type WfnBoard,
  type WfnFieldValue,
  type WfnPortSide,
  type WfnPortType,
  type WfnResult,
} from "./workflow-board";
import type { WorkflowPlace } from "./workflow-model";

/* ------------------------------------------------------------ Providers */

export type WfProvider = AgentProfile["provider"];

/** The logo of a provider. A provider that this build does not know has the neutral mark. */
export function wfProviderLogo(provider: WfProvider): ProviderLogoVariant {
  return isKnownAgentProvider(provider) ? provider : "unknown";
}

/* ---------------------------------------------------------------- Kinds */

export type NoteTone = "yellow" | "orange" | "red" | "pink" | "blue" | "teal" | "green";
/** "ink" is the text colour, so it reads in the dark and the light theme. */
export type CanvasColor = "ink" | NoteTone;
export type ShapeKind = "rectangle" | "circle" | "diamond" | "triangle" | "inverted" | "oval" | "star";
type BlockKind = "trigger" | "condition" | "output" | "approval" | "note" | "shape";

/* --------------------------------------------------------------- Ports */

function PortIcon(props: { type: WfnPortType }) {
  return (
    <Show when={props.type === "text"} fallback={props.type === "image" ? <Image /> : <File />}>
      <Type />
    </Show>
  );
}

/**
 * A port of a node. A condition has two text outputs, so each one has a branch key and its own name.
 * A required input that has no line shows the warning colour.
 */
export function Port(props: {
  node: string;
  type: WfnPortType;
  side: WfnPortSide;
  branch?: string;
  label?: string;
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
  /** A port is a toggle only while a connection is open: then a press on the armed port closes it. */
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
        data-connected={board.connected(props.node, props.side, props.type, props.branch) ? "" : undefined}
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

/* --------------------------------------------------------------- Shell */

/**
 * The toolbar of the selected node, above it. When there it covers another node, the canvas puts it
 * under the node, and under the results strip when the node shows one.
 */
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

/**
 * A toolbar action: a round icon button in the round toolbar, grey until the pointer or the focus is
 * on it, and red for a delete. Its name and its keys show in a tooltip. An action that cannot run is
 * not shown, so the toolbar has no disabled buttons.
 */
export function ToolAction(props: {
  text: string;
  /** The accessible name when the text alone is not enough, such as the name of the node after Delete. */
  label?: string;
  keys?: readonly string[];
  tone?: "danger";
  pressed?: boolean;
  icon: JSX.Element;
  onClick: () => void;
  /** Runs with true while the pointer or the focus is on the action, and with false when it leaves. */
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

/** Saves a file that the browser can reach, under its own name. */
export function download(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

/**
 * The toolbar of a node, in groups as in the Higgsfield node toolbar: the actions of the kind, then
 * Duplicate, then Lock and Delete.
 */
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

/** The lock of a node lives on the board, so the canvas can stop a drag and unlock every node. */
export function useLocked(id: () => string): [() => boolean, (locked: boolean) => void] {
  const board = useBoard();
  return [() => board.isLocked(id()), (locked) => board.lock(id(), locked)];
}

/**
 * A text or style of a node that lives on the board, so copy, paste and undo keep it. `read` takes back
 * a stored value, and gives undefined for a value of the wrong kind. A typed field joins each key stroke
 * of one burst into one undo step.
 */
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

/** A field that the user types in. */
export function useTextField(id: () => string, key: string, initial: string): [() => string, (value: string) => void] {
  return useField(id, key, initial, asString, true);
}

export const asString = (value: WfnFieldValue): string | undefined => (typeof value === "string" ? value : undefined);
export const asBoolean = (value: WfnFieldValue): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** Takes back a stored value only when it is one of `values`. */
export function oneOf<T extends WfnFieldValue>(values: readonly T[]): (value: WfnFieldValue) => T | undefined {
  return (value) => values.find((item) => item === value);
}

export const asProvider = (value: WfnFieldValue): WfProvider | undefined =>
  isAgentProviderRef(value) ? value : undefined;

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
  /** The node has no label above its card, as a shape. The lock badge still shows. */
  bare?: boolean;
  inputs?: readonly WfnPortType[];
  /** The step cannot run until a line comes into one of its inputs. */
  requires?: boolean;
  output?: WfnPortType | undefined;
  toolbar: JSX.Element;
  media?: boolean;
  /** The image of a result in the results strip. A text step has none. */
  thumb?: (result: WfnResult) => string | undefined;
  style?: JSX.CSSProperties;
  children: JSX.Element;
  /** The run button of the step. It comes after the result and the alerts of the step. */
  action?: JSX.Element;
}

/**
 * The resize handles: one on each corner, and a band on each side that can change size. Only the
 * bottom-right corner shows an arc, concentric with the card. The arc shows on hover and on the
 * selected node, and not on a locked node. The
 * canvas handles the drag, and a double click restores the default size. The handles are
 * pointer-only, so they are hidden from assistive technology.
 */
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
  /** A failed step that can run again shows Retry in place of its run button, and a step that runs alone Stop. */
  const action = children(() => props.action);
  const stop = () => stopOf(board, props.id);
  const missing = () => props.requires === true && !props.inputs?.some((type) => board.connected(props.id, "in", type));
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
        aria-label={props.label}
        style={style()}
      >
        <Show when={selected()}>
          <Toolbar id={props.id}>{props.toolbar}</Toolbar>
        </Show>
        <span class="wfn-label" data-bare={props.bare ? "" : undefined}>
          <Show when={!props.bare}>
            {props.icon}
            {props.label}
          </Show>
          <Show when={board.isLocked(props.id)}>
            <span class="wfn-lock-badge" role="img" aria-label={t("workflow.node.locked")}>
              <Lock />
            </span>
          </Show>
          <RunTime id={props.id} />
        </span>
        <div class="wfn-card-frame">
          <div class="wfn-card" data-media={props.media ? "" : undefined}>
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
        <Show when={props.inputs?.length}>
          <span class="wfn-ports" data-side="in">
            <For each={props.inputs}>
              {(type) => <Port node={props.id} type={type} side="in" missing={missing()} />}
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

/**
 * The time of a step's run, at the end of its label row. It counts while the step runs. When the run
 * ends, it shows the time with a check for a moment. A failed step shows Failed until it runs again.
 */
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

/**
 * The result field of a step. While the step runs, lines that pulse stand for the new result. They
 * cover the last result, which keeps its space, so the card does not change size. A failed run shows
 * why it stopped in place of a result.
 */
export function ResultField(props: { id: string; running: boolean }) {
  const board = useBoard();
  const { t } = useText();
  const value = () => resultValue(board.shown(props.id)) ?? "";
  const failure = () => resultFailure(board, props.id);
  return (
    <Show when={value() || failure() || props.running}>
      <Field class="wfn-field-result">
        <div class="wfn-field-head">
          <span>{t("workflow.node.result.title")}</span>
          <CopyButton
            value={value()}
            iconOnly
            label={t("workflow.node.result.copy")}
            disabled={props.running || !value()}
          />
        </div>
        <div class="wfn-result-body" data-running={props.running ? "" : undefined}>
          <Show when={value() || failure()}>
            <p data-failed={value() ? undefined : ""}>{value() || failure()}</p>
          </Show>
          <Show when={props.running}>
            <ResultPending />
          </Show>
        </div>
      </Field>
    </Show>
  );
}

/** Why the shown result failed: its error, or the error of a newest step that failed with no result. */
function resultFailure(board: WfnBoard, id: string): string | undefined {
  const shown = board.shown(id);
  if (shown?.failed) return shown.value;
  return shown === undefined && board.status(id) === "failed" ? board.error(id) : undefined;
}

/** Why a step failed, for a card that has no result field. */
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

/** The name of a result in a list: its workflow run, or a run of the step alone, and a failure. */
function resultName(t: AppTranslate, result: WfnResult): string {
  if (result.run === undefined)
    return result.failed ? t("workflow.node.result.stepFailed") : t("workflow.node.result.step");
  return result.failed
    ? t("workflow.node.result.runFailed", { run: result.run })
    : t("workflow.node.result.run", { run: result.run });
}

/** When a result was made: the time for a result of today, else the day and the time. */
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

/**
 * The results of a step, oldest first, under the selected node, as on the Higgsfield canvas. An
 * image step shows each image; a text step shows the number of each result. The arrows move to the
 * result before or after the one on view. A step with one result shows nothing.
 */
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
        <span class="wfn-strip-list">
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

/**
 * The run of one step: the board runs the step alone, and the host records its result. A workflow
 * run sets the same states.
 */
export function useStepRun(id: string) {
  const board = useBoard();
  return {
    running: () => board.status(id) === "running",
    start: () => board.runStep(id),
    stop: () => stopOf(board, id),
  };
}

/** How to stop a step that runs alone. A workflow run stops from the bar, so its steps have no Stop. */
export function stopOf(board: WfnBoard, id: string) {
  return board.status(id) === "running" && !board.running() ? board.stopStep : undefined;
}

interface Range {
  min: number;
  max: number;
}

/** The widths a user can give each block, and the height where the block has a free height. */
export const BLOCK_RESIZE: Record<BlockKind, { width: Range; height?: Range }> = {
  trigger: { width: { min: 240, max: 480 } },
  condition: { width: { min: 260, max: 560 } },
  output: { width: { min: 240, max: 480 } },
  approval: { width: { min: 260, max: 560 } },
  note: { width: { min: 160, max: 480 }, height: { min: 120, max: 480 } },
  shape: { width: { min: 48, max: 960 }, height: { min: 48, max: 960 } },
};

/* --------------------------------------------------------------- Pill */

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon: () => JSX.Element;
}

/** A pill that opens a list of choices, as the agent pill of an agent step. */
export function ChoicePill<T extends string>(props: {
  name: string;
  value: T;
  choices: readonly Choice<T>[];
  /** The text of the pill when no choice has the value. */
  placeholder?: string;
  disabled?: boolean | undefined;
  onChange: (value: T) => void;
}) {
  const { t } = useText();
  const current = () => props.choices.find((choice) => choice.value === props.value);
  const shown = () => current()?.label ?? props.placeholder ?? props.value;
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "xs" })} wfn-pill`}
        aria-label={t("workflow.node.choice", { name: props.name, value: shown() })}
        disabled={props.disabled}
      >
        {current()?.icon()}
        <span>{shown()}</span>
        <ChevronDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={props.name}
          groups={[
            {
              options: props.choices.map((choice) => ({ value: choice.value, label: choice.label, tile: choice.icon })),
            },
          ]}
          value={props.value}
          onSelect={props.onChange}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ------------------------------------------------------------- Colours */

/** A choice whose name is a catalog key. */
export interface KeyedChoice<T extends string> {
  value: T;
  label: AppTextKey;
}

/** The colours of a note, from the file colours of the palette. */
export const TONES: readonly KeyedChoice<NoteTone>[] = [
  { value: "yellow", label: "workflow.color.yellow" },
  { value: "orange", label: "workflow.color.orange" },
  { value: "red", label: "workflow.color.red" },
  { value: "pink", label: "workflow.color.pink" },
  { value: "blue", label: "workflow.color.blue" },
  { value: "teal", label: "workflow.color.teal" },
  { value: "green", label: "workflow.color.green" },
];

/** The colours of a line or a shape: the text colour, then the note colours. */
export const COLORS: readonly KeyedChoice<CanvasColor>[] = [{ value: "ink", label: "workflow.color.ink" }, ...TONES];

/** The choices with their names in the interface language. */
export const translated = <T extends string>(t: AppTranslate, choices: readonly KeyedChoice<T>[]) =>
  choices.map((choice) => ({ value: choice.value, label: t(choice.label) }));

export const colorVar = (color: CanvasColor) =>
  color === "ink" ? "var(--openbot-text-primary)" : `var(--openbot-file-${color})`;

/** A round colour sample, for a toolbar button or a menu item. */
export function Swatch(props: { color: CanvasColor }) {
  return <span class="wfn-swatch" style={{ "--wfn-swatch": colorVar(props.color) }} />;
}

/* --------------------------------------------------------------- Note */

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

/**
 * A menu in the toolbar of a note or a shape: the trigger shows the value as its icon, or else as its
 * measure, and the menu lists the choices.
 */
export function ToolbarChoice<T extends string>(props: {
  name: string;
  value: T;
  choices: readonly { value: T; label: string; meta?: string }[];
  icon?: (value: T) => JSX.Element;
  /** The mark of a choice in the list, when it is not the trigger icon. */
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

/* --------------------------------------------------------------- Places */

/** The key of a place in a choice list. */
const placeKey = (connectionId: string, placeId: string) => JSON.stringify([connectionId, placeId]);

/**
 * The place of a node, such as the channel that an output posts to. A new node takes the first place
 * of the catalog. The connection and the place change as one change.
 */
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

/** A pill with the places of the catalog, such as the channels. */
export function PlacePill(props: {
  name: string;
  connectionId: string;
  placeId: string;
  disabled?: boolean;
  onChange: (place: WorkflowPlace) => void;
}) {
  const board = useBoard();
  const { t } = useText();
  const choices = () =>
    board.catalogs().places.map((place) => ({
      value: placeKey(place.connectionId, place.placeId),
      label: place.label,
      icon: () => <Hash aria-hidden="true" />,
    }));
  return (
    <ChoicePill
      name={props.name}
      value={placeKey(props.connectionId, props.placeId)}
      choices={choices()}
      placeholder={t("workflow.node.place.choose")}
      disabled={props.disabled}
      onChange={(key) => {
        const place = board.catalogs().places.find((entry) => placeKey(entry.connectionId, entry.placeId) === key);
        if (place) props.onChange(place);
      }}
    />
  );
}
