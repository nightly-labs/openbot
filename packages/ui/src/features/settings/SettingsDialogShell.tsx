import { PageHeader, type PageHeaderParent } from "@openbot/ui/features/window/PageHeader";
import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import { type JSX, Portal } from "@solidjs/web";
import { createEffect, createSignal, createUniqueId, onCleanup, Show, untrack } from "solid-js";

export interface SettingsPagePlacement {
  nav: HTMLElement;
  content: HTMLElement;
  path: HTMLElement;
  onBack?: (back: SettingsPageBack | null) => void;
}

export interface SettingsCrumb {
  title: string;
  back: () => void;
}

export interface SettingsPageBack {
  name: string;
  back: () => void;
}

interface SettingsDialogShellProps {
  open: boolean;
  title: string;
  description: JSX.Element;
  crumb?: SettingsCrumb | null | undefined;
  sidebar: JSX.Element;
  contentKey: string;
  children: JSX.Element;
  class?: string;
  footer?: JSX.Element;
  floatingContent?: JSX.Element;
  onContentElement?: (element: HTMLElement) => void;
  restoreFocusTarget?: HTMLElement | null | undefined;
  page: SettingsPagePlacement | undefined;
}

function durationToMilliseconds(value: string, fallback: number): number {
  const duration = value.trim();
  if (duration.endsWith("ms")) return Number.parseFloat(duration) || fallback;
  if (duration.endsWith("s")) return (Number.parseFloat(duration) || fallback / 1_000) * 1_000;
  return fallback;
}

const SAVE_BAR_CLOSE_FALLBACK = 250;

function saveBarCloseDuration(element: HTMLElement | undefined): number {
  if (!element || prefersReducedMotion()) return 0;
  return durationToMilliseconds(getComputedStyle(element).getPropertyValue("--acc-collapse"), SAVE_BAR_CLOSE_FALLBACK);
}

interface SaveBarDockProps<T> {
  value: T | null;
  children: (value: () => T) => JSX.Element;
}

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

export function SettingsNavGroupLabel(props: { label: string }) {
  return (
    <div class="settings-modal-nav-heading" aria-hidden="true">
      {props.label}
    </div>
  );
}

export function SettingsDialogShell(props: SettingsDialogShellProps) {
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const pathTitle = () => props.crumb?.title ?? props.title;
  const pathParents = (): PageHeaderParent[] => {
    const crumb = props.crumb;
    return crumb ? [{ title: props.title, onSelect: crumb.back }] : [];
  };
  const [canScrollUp, setCanScrollUp] = createSignal(false);
  const [canScrollDown, setCanScrollDown] = createSignal(false);
  let shown = untrack(() => props.open);
  let restoreTarget: HTMLElement | null = untrack(() => props.restoreFocusTarget ?? null);
  let restoreFrame: number | undefined;
  let scrollElement: HTMLDivElement | undefined;
  let scrollResizeObserver: ResizeObserver | undefined;

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

  createEffect(
    () => {
      const page = props.open ? props.page : undefined;
      const crumb = props.crumb;
      return page ? { page, back: crumb ? { name: props.title, back: crumb.back } : null } : undefined;
    },
    (shown) => {
      if (!shown) return;
      shown.page.onBack?.(shown.back);
      return () => shown.page.onBack?.(null);
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
              aria-describedby={descriptionId}
            >
              <div class="settings-modal-main">
                <Show when={props.crumb}>
                  <Portal mount={page().path}>
                    <PageHeader
                      class="settings-page-path"
                      title={pathTitle()}
                      headingId={titleId}
                      path={pathParents()}
                    />
                  </Portal>
                </Show>
                <p id={descriptionId} class="settings-page-description">
                  {props.description}
                </p>
                <div
                  class="settings-modal-scroll-frame"
                  data-scroll-up={canScrollUp() ? "" : undefined}
                  data-scroll-down={canScrollDown() ? "" : undefined}
                >
                  <div ref={registerScrollElement} class="settings-modal-content" onScroll={updateScrollFades}>
                    <Show when={!props.crumb}>
                      <h2 id={titleId} class="settings-page-heading">
                        {props.title}
                      </h2>
                    </Show>
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
