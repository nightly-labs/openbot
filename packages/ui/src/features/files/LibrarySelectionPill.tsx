import { Button, Download, Trash2 } from "@openbot/ui";
import {
  EASE_OUT,
  ISLAND_CLOSE,
  ISLAND_CONTENT,
  ISLAND_OPEN,
  type Spring,
  springKeyframes,
} from "@openbot/ui/spring-motion";
import { useText } from "@openbot/ui/text";
import { clamp, mix, prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, flush, Match, onCleanup, Show, Switch, untrack } from "solid-js";

/** What the Library does with the selected files. `save` puts them in the Downloads folder. */
export type LibraryBatchAction = "delete" | "save";

/** The step that the pill shows. Each step has its own face, and the pill springs to its width. */
export type LibraryPillStep =
  | { kind: "actions" }
  | { kind: "confirm" }
  | { kind: "working"; action: LibraryBatchAction; done: number; total: number };

/** The small capsule under the bottom edge that the pill grows out of and goes back into. */
const BUD = { width: 64, height: 22 };

const px = (value: number) => `${value}px`;
const ms = (spring: Spring) => spring.response * 1000;

function contentIn(element: HTMLElement, delay = 0, motion = (rest: number) => `scale(${1 - 0.04 * rest})`) {
  element.animate(
    springKeyframes(ISLAND_CONTENT, (progress) => ({
      opacity: clamp(progress * 1.5, 0, 1),
      filter: `blur(${Math.max(0, 4 * (1 - progress))}px)`,
      transform: motion(1 - progress),
    })),
    { duration: ms(ISLAND_CONTENT), delay, easing: "linear", fill: "backwards" },
  );
}

/** A count that rolls in from below when it changes. */
function rollIn(element: HTMLElement) {
  if (prefersReducedMotion()) return;
  queueMicrotask(() => contentIn(element, 0, (rest) => `translateY(${60 * rest}%)`));
}

/**
 * The pill shell. It is in the page while it is open or closing: it grows out of a small capsule under
 * the bottom edge and goes back into it. `face` is a key: a new key brings the new content in with a
 * blur. The width follows the content on a spring.
 */
function MorphPill(props: {
  open: boolean;
  face: string;
  tone?: "danger" | undefined;
  label: string;
  progress?: number | undefined;
  children: JSX.Element;
}) {
  const [present, setPresent] = createSignal(false);
  let shell: HTMLElement | undefined;
  let face: HTMLElement | undefined;
  let sizing: Animation | undefined;
  let closing: Animation[] = [];
  let lastFace = untrack(() => props.face);
  const observer = new ResizeObserver(() => {
    if (shell?.isConnected) resizeTo(contentWidth());
  });
  onCleanup(() => observer.disconnect());

  // The face has its own width; 2 px are the border of the shell.
  const contentWidth = () => (face ? face.offsetWidth + 2 : 0);
  /** From the bottom of the pill to below the bottom edge of its frame, so the capsule starts out of view. */
  const drop = () => {
    if (!shell?.offsetParent) return 48;
    const parent = shell.offsetParent.getBoundingClientRect();
    return parent.bottom - shell.getBoundingClientRect().bottom + BUD.height;
  };

  function resizeTo(next: number) {
    if (!shell || closing.length > 0) return;
    const from = shell.getBoundingClientRect().width;
    sizing?.cancel();
    shell.style.width = px(next);
    if (prefersReducedMotion() || Math.abs(from - next) < 0.5) return;
    const spring = next >= from ? ISLAND_OPEN : ISLAND_CLOSE;
    sizing = shell.animate(
      springKeyframes(spring, (progress) => ({ width: px(mix(from, next, progress)) })),
      { duration: ms(spring), easing: "linear" },
    );
  }

  function bud() {
    if (!shell || !face) return;
    const width = contentWidth();
    const height = shell.offsetHeight;
    shell.style.width = px(width);
    if (prefersReducedMotion()) {
      shell.animate([{ opacity: 0 }, { opacity: 1 }], 150);
      return;
    }
    const down = drop();
    sizing?.cancel();
    sizing = shell.animate(
      springKeyframes(ISLAND_OPEN, (progress) => ({
        width: px(mix(BUD.width, width, progress)),
        height: px(mix(BUD.height, height, progress)),
        transform: `translateY(${mix(down, 0, progress)}px)`,
      })),
      { duration: ms(ISLAND_OPEN), easing: "linear" },
    );
    shell.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1 }], ms(ISLAND_OPEN));
    contentIn(face, ms(ISLAND_OPEN) * 0.3);
  }

  function sink() {
    if (!shell || !face) return setPresent(false);
    if (prefersReducedMotion()) {
      closing = [shell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" })];
    } else {
      const from = shell.getBoundingClientRect();
      const down = drop();
      sizing?.cancel();
      closing = [
        face.animate(
          [
            { opacity: 1, filter: "blur(0px)", transform: "none" },
            { opacity: 0, filter: "blur(4px)", transform: "scale(0.96)" },
          ],
          { duration: ms(ISLAND_CLOSE) * 0.35, easing: EASE_OUT, fill: "forwards" },
        ),
        shell.animate(
          springKeyframes(ISLAND_CLOSE, (progress) => ({
            width: px(mix(from.width, BUD.width, progress)),
            height: px(mix(from.height, BUD.height, progress)),
            transform: `translateY(${mix(0, down, progress)}px)`,
          })),
          { duration: ms(ISLAND_CLOSE), easing: "linear", fill: "forwards" },
        ),
        shell.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], {
          duration: ms(ISLAND_CLOSE),
          fill: "forwards",
        }),
      ];
    }
    const motion = closing.at(-1);
    motion?.addEventListener("finish", () => {
      if (!closing.includes(motion)) return;
      closing = [];
      setPresent(false);
    });
  }

  function reopen() {
    for (const animation of closing) animation.cancel();
    closing = [];
    resizeTo(contentWidth());
  }

  createEffect(
    () => props.open,
    (open) => {
      // The pill must be in the page before it can measure its face.
      queueMicrotask(() => {
        if (open && !untrack(present)) {
          setPresent(true);
          flush();
          bud();
        } else if (open && closing.length > 0) reopen();
        else if (!open && untrack(present) && closing.length === 0) sink();
      });
    },
  );

  createEffect(
    () => props.face,
    (key) => {
      if (key === lastFace) return;
      lastFace = key;
      if (face && closing.length === 0 && !prefersReducedMotion()) contentIn(face);
    },
  );

  return (
    <Show when={present()}>
      <section
        class="library-pill"
        aria-label={props.label}
        data-tone={props.tone}
        ref={(element) => {
          shell = element;
        }}
      >
        <Show when={props.progress !== undefined}>
          <span class="library-pill-progress" style={{ width: `${(props.progress ?? 0) * 100}%` }} aria-hidden="true" />
        </Show>
        <div
          class="library-pill-face"
          ref={(element) => {
            // The face is made again each time the pill opens; the observer must not keep the old one.
            if (face) observer.unobserve(face);
            face = element;
            observer.observe(element);
          }}
        >
          {props.children}
        </div>
      </section>
    </Show>
  );
}

export interface LibrarySelectionPillProps {
  open: boolean;
  step: LibraryPillStep;
  /** The selected files. */
  count: number;
  /** The selected files that the viewer can download. */
  saveCount: number;
  /** The selected files that the viewer can delete. */
  deleteCount: number;
  /** The viewer can delete files. Off for a member of a remote server: the pill has no Delete. */
  canDelete: boolean;
  onSave: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/**
 * The pill at the bottom of the Library while files are selected. It shows the count and the actions,
 * asks before a delete, and shows the progress of a delete or download.
 */
export function LibrarySelectionPill(props: LibrarySelectionPillProps) {
  const { t } = useText();
  // The pill keeps the last count while it goes down, so it does not show 0 on its way out.
  const count = createMemo<number>((previous) => props.count || previous || 0);
  const face = () => {
    const step = props.step;
    return step.kind === "working" ? `working:${step.action}` : step.kind;
  };
  const working = () => (props.step.kind === "working" ? props.step : undefined);
  const tone = (): "danger" | undefined => (props.step.kind === "confirm" ? "danger" : undefined);
  const progress = () => {
    const step = props.step;
    return step.kind === "working" ? step.done / step.total : undefined;
  };

  return (
    <MorphPill open={props.open} face={face()} tone={tone()} label={t("files.library.selection")} progress={progress()}>
      <Switch>
        <Match when={props.step.kind === "actions"}>
          <output class="library-pill-count">
            <Show keyed when={count()}>
              {(value) => <span ref={rollIn}>{t("files.library.selected", { count: value })}</span>}
            </Show>
          </output>
          <span class="library-pill-rule" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="library-pill-button"
            disabled={props.saveCount === 0}
            onClick={() => props.onSave()}
          >
            <Download aria-hidden="true" />
            {t("common.download")}
          </Button>
          <Show when={props.canDelete}>
            <Button
              type="button"
              variant="destructive-ghost"
              size="sm"
              class="library-pill-button"
              disabled={props.deleteCount === 0}
              onClick={() => props.onAskDelete()}
            >
              <Trash2 aria-hidden="true" />
              {t("common.delete")}
            </Button>
          </Show>
        </Match>
        <Match when={props.step.kind === "confirm"}>
          <span class="library-pill-text">{t("files.delete.titleMany", { count: props.deleteCount })}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="library-pill-button"
            onClick={() => props.onCancelDelete()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            class="library-pill-button"
            // The question replaces the button that asked it, so focus moves to the answer.
            ref={(element) => queueMicrotask(() => element.focus())}
            onClick={() => props.onConfirmDelete()}
          >
            {t("common.delete")}
          </Button>
        </Match>
        <Match when={working()}>
          {(step) => (
            <output class="library-pill-text library-pill-status">
              {t(step().action === "delete" ? "files.library.deleting" : "files.library.saving", {
                done: Math.min(step().done + 1, step().total),
                total: step().total,
              })}
            </output>
          )}
        </Match>
      </Switch>
    </MorphPill>
  );
}
