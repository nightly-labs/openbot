/**
 * The HUD of the workflow canvas: the buttons of its bars, and the top bar with the workflow switcher,
 * the run status, the run history and the Run button.
 */

import type { WorkflowRunStatus } from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  CircleAlert,
  DropdownMenu,
  History,
  Input,
  LabelTooltipTrigger,
  LoaderCircle,
  Play,
  RadialProgress,
  Square,
  UserCheck,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { Hint, MOD_KEY } from "./workflow-board";
import { type CanvasColor, colorVar } from "./workflow-node-parts";

/** HUD menus align to the edge of their bar, not to the button inside it. */
export const hudBarRect = (anchor?: HTMLElement) => anchor?.closest(".wfn-hud")?.getBoundingClientRect();

/** A HUD button with a tooltip, for the tool bar and the zoom bar. A tool with art shows a picture. */
export function HudButton(props: {
  label: string;
  keys?: readonly string[] | undefined;
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
  art?: "draw" | "note" | "shape" | undefined;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Hint label={props.label} keys={props.keys ?? []}>
      <LabelTooltipTrigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        class="wfn-hud-tool"
        data-art={props.art}
        aria-label={props.label}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
        disabled={props.disabled ?? false}
        onClick={props.onClick}
      >
        {props.children}
      </LabelTooltipTrigger>
    </Hint>
  );
}

/** A row of colour buttons in a sub-bar of the tool bar. The picked colour has a ring. */
export function ColorButtons<T extends CanvasColor>(props: {
  options: readonly { value: T; label: string }[];
  value: T;
  name: (label: string) => string;
  onPick: (value: T) => void;
}) {
  return (
    <For each={props.options}>
      {(option) => (
        <Hint label={option.label}>
          <LabelTooltipTrigger
            as={Button}
            variant="ghost"
            size="icon-sm"
            class="wfn-hud-tool wfn-ink-swatch"
            aria-label={props.name(option.label)}
            aria-pressed={props.value === option.value ? "true" : "false"}
            onClick={() => props.onPick(option.value)}
          >
            <span class="wfn-ink-dot" style={{ "--wfn-ink": colorVar(option.value) }} />
          </LabelTooltipTrigger>
        </Hint>
      )}
    </For>
  );
}

/** An ISO time as the canvas shows it: "Today, 09:14", or the day and the time on another day. */
export function timeLabel(t: AppTranslate, format: AppFormat, at: string): string {
  const date = new Date(at);
  const time = format.date(date, { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? t("workflow.canvas.time.today", { time })
    : t("workflow.canvas.time.day", { day: format.date(date, { day: "numeric", month: "short" }), time });
}

/** A run in the top bar. */
export interface HudRun {
  number: number;
  at: string;
  status: WorkflowRunStatus;
  /** How long the run took, in seconds. A run that has not ended has none. */
  seconds: number | null;
}

/** The step that the run is on, and how many other steps are in the same state. */
export interface HudStep {
  id: string;
  status: "running" | "approval" | "failed";
  name: string;
  more: number;
}

export function WorkflowCanvasHeader(props: {
  frame: "window" | undefined;
  name: string;
  renaming: boolean;
  menuRef: (element: HTMLButtonElement) => void;
  /** The content of the switcher menu. */
  switcher: JSX.Element;
  onName: (name: string) => void;
  onEndRename: (keep: boolean) => void;
  /** A version shows: the run controls hide. */
  previewing: boolean;
  /** The run whose results the steps show. */
  viewing: number | null;
  onView: (run: number | null) => void;
  /** The runs that ended, newest first. */
  pastRuns: readonly HudRun[];
  olderRuns: boolean;
  onLoadOlderRuns: () => void;
  step: HudStep | undefined;
  onShowStep: (id: string) => void;
  canRun: boolean;
  running: boolean;
  progress: { done: number; total: number };
  onRun: () => void;
  onStop: () => void;
}) {
  const { t, format } = useText();
  const duration = (seconds: number) => t("workflow.node.runTime", { seconds: format.number(Math.max(1, seconds)) });
  const outcome = (run: HudRun) => {
    if (run.seconds === null) return t("workflow.node.running");
    const time = duration(run.seconds);
    if (run.status === "failed") return t("workflow.canvas.run.failedAfter", { duration: time });
    if (run.status === "stopped") return t("workflow.canvas.run.stoppedAfter", { duration: time });
    return time;
  };
  const viewedRun = () => props.pastRuns.find((run) => run.number === props.viewing);
  const statusVerb = (status: HudStep["status"]) =>
    status === "approval"
      ? t("workflow.canvas.status.approval")
      : status === "failed"
        ? t("workflow.canvas.status.failed")
        : t("workflow.canvas.status.running");
  /** The step and status that the status region reads. A new name or count alone does not speak again. */
  const spoken = createMemo(() => {
    const step = props.previewing ? undefined : props.step;
    return step ? `${step.id}\u0000${step.status}` : "";
  });
  const announcement = createMemo(() => {
    if (!spoken()) return undefined;
    return untrack(() => {
      const step = props.step;
      return step && { verb: statusVerb(step.status), name: step.name };
    });
  });
  return (
    <header class={props.frame === "window" ? "wfn-hud-top window-drag" : "wfn-hud-top"}>
      <div class="wfn-hud wfn-hud-title">
        <DropdownMenu.Root placement="bottom-start" gutter={8} getAnchorRect={hudBarRect} modal={false}>
          <DropdownMenu.Trigger
            ref={props.menuRef}
            class={`${buttonVariants({ variant: "ghost", size: "sm" })} wfn-hud-button wfn-hud-switcher`}
            hidden={props.renaming}
          >
            <span class="wfn-hud-switcher-name">{props.name}</span>
            <ChevronDown class="wfn-hud-chevron" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>{props.switcher}</DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Show when={props.renaming}>
          <Input
            ref={(element: HTMLInputElement) => {
              queueMicrotask(() => {
                element.focus();
                element.select();
              });
            }}
            class="wfn-hud-name"
            aria-label={t("workflow.canvas.switcher.name")}
            spellcheck={false}
            value={props.name}
            onValueChange={props.onName}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== "Escape") return;
              event.preventDefault();
              props.onEndRename(event.key === "Enter");
            }}
            onBlur={() => props.onEndRename(true)}
          />
        </Show>
      </div>
      <div class="wfn-hud-group">
        <Show when={!props.previewing && viewedRun()}>
          {(entry) => (
            <div class="wfn-hud wfn-hud-viewing">
              <History aria-hidden="true" />
              <span class="wfn-hud-label">{t("workflow.canvas.run.number", { number: entry().number })}</span>
              <span class="wfn-hud-meta">{timeLabel(t, format, entry().at)}</span>
              <Hint label={t("workflow.canvas.run.showLatest")} placement="bottom">
                <LabelTooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("workflow.canvas.run.showLatest")}
                  onClick={() => props.onView(null)}
                >
                  <X />
                </LabelTooltipTrigger>
              </Hint>
            </div>
          )}
        </Show>
        <div class="sr-only" role="status">
          <Show when={announcement()}>
            {(said) => (
              <>
                <div>{said().verb}</div>
                <div>{said().name}</div>
              </>
            )}
          </Show>
        </div>
        <div class="wfn-hud-live">
          <Show when={!props.previewing && props.step}>
            {(step) => (
              <div class="wfn-hud wfn-hud-status" data-status={step().status}>
                <Button
                  variant="ghost"
                  size="sm"
                  class="wfn-hud-button wfn-hud-step"
                  onClick={() => props.onShowStep(step().id)}
                >
                  <Show
                    when={step().status === "running"}
                    fallback={
                      step().status === "failed" ? <CircleAlert aria-hidden="true" /> : <UserCheck aria-hidden="true" />
                    }
                  >
                    <LoaderCircle class="wfn-hud-spin" aria-hidden="true" />
                  </Show>
                  <span class="wfn-hud-meta">{statusVerb(step().status)}</span>
                  <span class="wfn-hud-step-name">{step().name}</span>
                  <Show when={step().more > 0}>
                    <span class="wfn-hud-count">{t("workflow.canvas.status.more", { count: step().more })}</span>
                  </Show>
                </Button>
              </div>
            )}
          </Show>
        </div>
        <Show when={!props.previewing && (props.pastRuns.length > 0 || props.canRun || props.running)}>
          <div class="wfn-hud">
            <Show when={props.pastRuns.length > 0}>
              <DropdownMenu.Root placement="bottom-end" gutter={8} getAnchorRect={hudBarRect} modal={false}>
                <DropdownMenu.Trigger class={`${buttonVariants({ variant: "ghost", size: "sm" })} wfn-hud-button`}>
                  <History aria-hidden="true" />
                  {t("workflow.canvas.run.history")}
                  <span class="wfn-hud-count">{format.number(props.pastRuns.length)}</span>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    class="wfn-menu wfn-results-menu"
                    data-wfn-portal=""
                    aria-label={t("workflow.canvas.run.list")}
                  >
                    <DropdownMenu.Item onSelect={() => props.onView(null)}>
                      <span class="wfn-menu-text">{t("workflow.canvas.run.latest")}</span>
                      <Check
                        class="wfn-menu-check"
                        data-off={props.viewing === null ? undefined : ""}
                        aria-hidden="true"
                      />
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <For each={props.pastRuns}>
                      {(entry) => (
                        <DropdownMenu.Item onSelect={() => props.onView(entry.number)}>
                          <span class="wfn-menu-text">{t("workflow.canvas.run.number", { number: entry.number })}</span>
                          <span class="wfn-menu-meta">
                            {t("workflow.canvas.run.meta", {
                              time: timeLabel(t, format, entry.at),
                              outcome: outcome(entry),
                            })}
                          </span>
                          <Check
                            class="wfn-menu-check"
                            data-off={props.viewing === entry.number ? undefined : ""}
                            aria-hidden="true"
                          />
                        </DropdownMenu.Item>
                      )}
                    </For>
                    <Show when={props.olderRuns}>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item closeOnSelect={false} onSelect={props.onLoadOlderRuns}>
                        <span class="wfn-menu-text">{t("workflow.canvas.run.older")}</span>
                      </DropdownMenu.Item>
                    </Show>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <Show when={props.canRun || props.running}>
                <span class="wfn-hud-separator" aria-hidden="true" />
              </Show>
            </Show>
            <Show
              when={props.running}
              fallback={
                <Show when={props.canRun}>
                  <Hint label={t("workflow.trigger.runWorkflow")} keys={[MOD_KEY, "↵"]} placement="bottom">
                    <LabelTooltipTrigger as={Button} size="sm" class="wfn-hud-button wfn-hud-run" onClick={props.onRun}>
                      <Play aria-hidden="true" />
                      {t("workflow.trigger.runWorkflow")}
                    </LabelTooltipTrigger>
                  </Hint>
                </Show>
              }
            >
              <span class="wfn-hud-progress">
                <RadialProgress
                  class="wfn-hud-ring"
                  aria-label={t("workflow.canvas.run.progress")}
                  value={props.progress.total ? (props.progress.done / props.progress.total) * 100 : 0}
                />
                {t("workflow.canvas.run.done", {
                  done: format.number(props.progress.done),
                  total: format.number(props.progress.total),
                })}
              </span>
              <Button variant="secondary" size="sm" class="wfn-hud-button wfn-hud-stop" onClick={props.onStop}>
                <Square aria-hidden="true" />
                {t("workflow.node.stop")}
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </header>
  );
}
