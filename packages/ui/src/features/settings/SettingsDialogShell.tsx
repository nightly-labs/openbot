import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import { type JSX, Portal } from "@solidjs/web";
import { createEffect, createSignal, createUniqueId, onCleanup, Show, untrack } from "solid-js";

/** Where a settings page puts its parts, when the settings show as a page of the window. */
export interface SettingsPagePlacement {
  /** The element that holds the section list. */
  nav: HTMLElement;
  /** The element that holds the panel. */
  content: HTMLElement;
}

interface SettingsDialogShellProps {
  open: boolean;
  title: JSX.Element;
  description: JSX.Element;
  sidebar: JSX.Element;
  contentKey: string;
  children: JSX.Element;
  class?: string;
  footer?: JSX.Element;
  /**
   * Content the shell places over the end of the panel, such as an error toast. It is the caller's
   * to position, and the caller sets `--settings-modal-floating-space` on the modal element with its
   * height, so the panel keeps its last control above it.
   */
  floatingContent?: JSX.Element;
  onContentElement?: (element: HTMLElement) => void;
  restoreFocusTarget?: HTMLElement | null | undefined;
  /** Where the settings show, or nothing while their page is not on screen. The page has no close button. */
  page: SettingsPagePlacement | undefined;
}

function durationToMilliseconds(value: string, fallback: number): number {
  const duration = value.trim();
  if (duration.endsWith("ms")) return Number.parseFloat(duration) || fallback;
  if (duration.endsWith("s")) return (Number.parseFloat(duration) || fallback / 1_000) * 1_000;
  return fallback;
}

/** The collapse clock when the stylesheet cannot answer, so a closing bar always leaves the tree. */
const SAVE_BAR_CLOSE_FALLBACK = 250;

function saveBarCloseDuration(element: HTMLElement | undefined): number {
  if (!element || prefersReducedMotion()) return 0;
  return durationToMilliseconds(getComputedStyle(element).getPropertyValue("--acc-collapse"), SAVE_BAR_CLOSE_FALLBACK);
}

interface SaveBarDockProps<T> {
  /** What the bar reports, or `null` when there is nothing to save. The dock holds the last one it got. */
  value: T | null;
  /** The bar itself. It is called with the held value, so it keeps its content through the close. */
  children: (value: () => T) => JSX.Element;
}

/**
 * A dock for a settings save bar: the bar grows out of the bottom edge when there is something to
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
  const titleId = createUniqueId();
  const [canScrollUp, setCanScrollUp] = createSignal(false);
  const [canScrollDown, setCanScrollDown] = createSignal(false);
  let shown = untrack(() => props.open);
  let restoreTarget: HTMLElement | null = untrack(() => props.restoreFocusTarget ?? null);
  let restoreFrame: number | undefined;
  let scrollElement: HTMLDivElement | undefined;
  let scrollResizeObserver: ResizeObserver | undefined;

  /** Puts the focus back on the opener, unless the page that replaced this one took the focus. */
  function restoreFocus(): void {
    if (!restoreTarget?.isConnected) return;
    const target = restoreTarget;
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        target.focus();
      });
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
      if (open) {
        if (restoreFocusTarget) restoreTarget = restoreFocusTarget;
        if (!shown) restoreTarget ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
        shown = true;
        return;
      }
      if (!shown) return;
      shown = false;
      restoreFocus();
    },
  );

  onCleanup(() => {
    scrollResizeObserver?.disconnect();
    if (restoreFrame !== undefined) window.cancelAnimationFrame(restoreFrame);
  });

  return (
    <Show when={props.open && props.page}>
      {(page) => (
        <>
          <Portal mount={page().nav}>
            <div class="settings-page-nav-group">{props.sidebar}</div>
          </Portal>
          <Portal mount={page().content}>
            <section
              ref={(element) => props.onContentElement?.(element)}
              class={cx("settings-modal settings-modal-page", props.class)}
              aria-labelledby={titleId}
            >
              <div class="settings-modal-main">
                <header class="settings-modal-header">
                  <div>
                    <h2 id={titleId} class="settings-modal-title">
                      {props.title}
                    </h2>
                    <p class="settings-modal-description">{props.description}</p>
                  </div>
                </header>
                <div
                  class="settings-modal-scroll-frame"
                  data-scroll-up={canScrollUp() ? "" : undefined}
                  data-scroll-down={canScrollDown() ? "" : undefined}
                >
                  <div ref={registerScrollElement} class="settings-modal-content" onScroll={updateScrollFades}>
                    {props.children}
                  </div>
                </div>
                <div class="settings-modal-footer">{props.footer}</div>
                {props.floatingContent}
              </div>
            </section>
          </Portal>
        </>
      )}
    </Show>
  );
}
