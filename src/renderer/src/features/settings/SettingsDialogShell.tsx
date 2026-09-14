import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { Dialog, IconButton, X } from "../../components/ui";
import { cx } from "../../components/ui/utils";

interface SettingsDialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: JSX.Element;
  description: JSX.Element;
  sidebar: JSX.Element;
  contentKey: string;
  children: JSX.Element;
  class?: string;
  footer?: JSX.Element;
  floatingContent?: JSX.Element;
  closeLabel?: string;
  onContentElement?: (element: HTMLElement) => void;
  restoreFocusTarget?: HTMLElement | null;
}

function durationToMilliseconds(value: string, fallback: number): number {
  const duration = value.trim();
  if (duration.endsWith("ms")) return Number.parseFloat(duration) || fallback;
  if (duration.endsWith("s")) return (Number.parseFloat(duration) || fallback / 1_000) * 1_000;
  return fallback;
}

function closeDuration(): number {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  return durationToMilliseconds(
    getComputedStyle(document.documentElement).getPropertyValue("--openbot-duration-fast"),
    120,
  );
}

/** The collapse clock when the stylesheet cannot answer, so a closing bar always leaves the tree. */
const SAVE_BAR_CLOSE_FALLBACK = 250;

function saveBarCloseDuration(element: HTMLElement | undefined): number {
  if (!element || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  return durationToMilliseconds(getComputedStyle(element).getPropertyValue("--acc-collapse"), SAVE_BAR_CLOSE_FALLBACK);
}

interface SaveBarDockProps<T> {
  /** What the bar reports, or `null` when there is nothing to save. The dock holds the last one it got. */
  value: T | null;
  /** The bar itself. It is called with the held value, so it keeps its content through the close. */
  children: (value: () => T) => JSX.Element;
}

/**
 * A dock for a dialog's save bar: the bar grows out of the bottom edge when there is something to
 * save and shrinks back into it when there is not. The dock is a grid track that opens from `0fr` to
 * `1fr`, so the bar's own height is what the transition tweens and no pixel value is measured.
 *
 * Any `SettingsDialogShell` footer can use it. The bar mounts closed, because an element that mounts
 * already open cannot transition, and it stays mounted through the close, because a bar that leaves
 * the tree at once has nothing left to shrink. It is `inert` while closed, so a bar on its way out
 * cannot take focus.
 *
 * ```tsx
 * footer={
 *   <SaveBarDock value={dirty() ? true : null}>
 *     {() => <section class="settings-modal-save-bar" aria-label="Unsaved changes">…</section>}
 *   </SaveBarDock>
 * }
 * ```
 */
export function SaveBarDock<T>(props: SaveBarDockProps<T>) {
  const [held, setHeld] = createSignal<T | null>(null);
  const [open, setOpen] = createSignal(false);
  let dock: HTMLDivElement | undefined;
  let closeTimer: number | undefined;

  createEffect(
    () => props.value,
    (next) => {
      window.clearTimeout(closeTimer);
      if (next !== null) {
        setHeld(() => next);
        // Reading a layout property settles the closed state before the open attribute lands.
        window.requestAnimationFrame(() => {
          void dock?.offsetHeight;
          setOpen(true);
        });
        return;
      }
      setOpen(false);
      closeTimer = window.setTimeout(() => setHeld(null), saveBarCloseDuration(dock));
    },
  );

  onCleanup(() => window.clearTimeout(closeTimer));

  return (
    <Show when={held()}>
      {(value) => (
        <div ref={dock} class="settings-modal-save-dock t-acc" data-open={open() ? "true" : "false"} inert={!open()}>
          <div class="t-acc-panel">
            <div class="t-acc-panel-inner">{props.children(value)}</div>
          </div>
        </div>
      )}
    </Show>
  );
}

export function SettingsDialogShell(props: SettingsDialogShellProps) {
  const [rendered, setRendered] = createSignal(untrack(() => props.open));
  const [closing, setClosing] = createSignal(false);
  const [canScrollUp, setCanScrollUp] = createSignal(false);
  const [canScrollDown, setCanScrollDown] = createSignal(false);
  let closeTimer: number | undefined;
  let restoreTarget: HTMLElement | null = untrack(() => props.restoreFocusTarget ?? null);
  let restoreFrame: number | undefined;
  let modalElement: HTMLElement | undefined;
  let scrollElement: HTMLDivElement | undefined;
  let scrollResizeObserver: ResizeObserver | undefined;

  function clearCloseTimer(): void {
    if (closeTimer === undefined) return;
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function restoreFocus(): void {
    if (!restoreTarget?.isConnected) return;
    const target = restoreTarget;
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => target.focus());
    });
  }

  function updateScrollFades(): void {
    if (!scrollElement) return;
    setCanScrollUp(scrollElement.scrollTop > 1);
    setCanScrollDown(scrollElement.scrollTop + scrollElement.clientHeight < scrollElement.scrollHeight - 1);
  }

  function registerScrollElement(element: HTMLDivElement): void {
    scrollResizeObserver?.disconnect();
    scrollElement = element;
    scrollResizeObserver = new ResizeObserver(updateScrollFades);
    scrollResizeObserver.observe(element);
    queueMicrotask(updateScrollFades);
  }

  createEffect(
    () => props.contentKey,
    () => {
      if (scrollElement) scrollElement.scrollTop = 0;
      queueMicrotask(updateScrollFades);
    },
  );

  createEffect(
    () => ({ open: props.open, restoreFocusTarget: props.restoreFocusTarget }),
    ({ open, restoreFocusTarget }) => {
      clearCloseTimer();
      const isRendered = untrack(rendered);

      if (open) {
        const explicitTarget = restoreFocusTarget;
        if (explicitTarget) restoreTarget = explicitTarget;
        if (!isRendered) {
          restoreTarget ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        setRendered(true);
        setClosing(false);
        return;
      }

      if (!isRendered) return;
      setClosing(true);
      closeTimer = window.setTimeout(() => {
        closeTimer = undefined;
        setRendered(false);
        setClosing(false);
        restoreFocus();
      }, closeDuration());
    },
  );

  onCleanup(() => {
    clearCloseTimer();
    scrollResizeObserver?.disconnect();
    if (restoreFrame !== undefined) window.cancelAnimationFrame(restoreFrame);
  });

  function requestOpenChange(open: boolean): void {
    if (!open && closing()) return;
    props.onOpenChange(open);
  }

  return (
    <Dialog.Root open={rendered()} onOpenChange={requestOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          class="settings-modal-backdrop"
          data-motion={closing() ? "closing" : "open"}
          data-testid="settings-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) requestOpenChange(false);
          }}
        >
          <Dialog.Content
            as="section"
            ref={(element) => {
              modalElement = element;
              props.onContentElement?.(element);
            }}
            class={cx("settings-modal", props.class)}
            data-motion={closing() ? "closing" : "open"}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              queueMicrotask(() => modalElement?.focus({ preventScroll: true }));
            }}
          >
            <aside class="settings-modal-sidebar">{props.sidebar}</aside>

            <div class="settings-modal-main">
              <header class="settings-modal-header">
                <div>
                  <Dialog.Title class="settings-modal-title">{props.title}</Dialog.Title>
                  <Dialog.Description class="settings-modal-description">{props.description}</Dialog.Description>
                </div>
                <IconButton
                  label={props.closeLabel ?? "Close settings"}
                  tooltip={props.closeLabel ?? "Close settings"}
                  variant="ghost"
                  onClick={() => requestOpenChange(false)}
                >
                  <X />
                </IconButton>
              </header>

              <div
                class="settings-modal-scroll-frame"
                data-scroll-up={canScrollUp() ? "" : undefined}
                data-scroll-down={canScrollDown() ? "" : undefined}
                data-testid="settings-modal-scroll-frame"
              >
                <div ref={registerScrollElement} class="settings-modal-content" onScroll={updateScrollFades}>
                  {props.children}
                </div>
              </div>
              <div class="settings-modal-footer">{props.footer}</div>
              {props.floatingContent}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
