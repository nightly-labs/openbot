import { Button, Download, Trash2 } from "@openbot/ui";
import { contentIn, MorphPill } from "@openbot/ui/morph-pill";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createMemo, Match, Show, Switch } from "solid-js";

export type LibraryBatchAction = "delete" | "save";

export type LibraryPillStep =
  | { kind: "actions" }
  | { kind: "confirm" }
  | { kind: "working"; action: LibraryBatchAction; done: number; total: number };

function rollIn(element: HTMLElement) {
  if (prefersReducedMotion()) return;
  queueMicrotask(() => contentIn(element, 0, (rest) => `translateY(${60 * rest}%)`));
}

export interface LibrarySelectionPillProps {
  open: boolean;
  step: LibraryPillStep;
  count: number;
  saveCount: number;
  deleteCount: number;
  canDelete: boolean;
  move?: JSX.Element;
  onSave: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export function LibrarySelectionPill(props: LibrarySelectionPillProps) {
  const { t } = useText();
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
    <MorphPill
      open={props.open}
      class="library-pill"
      faceClass="library-pill-face"
      face={face()}
      aria-label={t("files.library.selection")}
      data-tone={tone()}
      backdrop={
        <Show when={progress() !== undefined}>
          <span class="library-pill-progress" style={{ width: `${(progress() ?? 0) * 100}%` }} aria-hidden="true" />
        </Show>
      }
    >
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
          {props.move}
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
