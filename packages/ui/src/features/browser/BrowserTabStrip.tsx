import type { BrowserTabProfile } from "@openbot/contracts/ipc";
import { Button, buttonVariants, ChevronDown, ContextMenu, DropdownMenu, Tabs, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { clamp, motionDuration, prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createSignal, createStore, For, onSettled, Show } from "solid-js";
import { browserProfileColor } from "./BrowserProfileColor";
import { BrowserTabIcon, useBrowserTabTitle } from "./BrowserTabIcon";
import { BrowserTabMenu } from "./BrowserTabMenu";
import { type BrowserFullViewProps, browserTabProfileLabel } from "./browser-full-view-types";
import { useBrowserPageCover } from "./browser-page-cover";

/** A press that travels this far becomes a drag; a shorter one stays a click on the tab or its X. */
const DRAG_START_PX = 6;
/** A held tab this close to an edge of the row scrolls the row, at up to this many pixels a frame. */
const EDGE_ZONE_PX = 40;
const EDGE_SPEED_PX = 14;

/** What the row shows besides the tabs: the chips out of view, the faded edges, and a kept chip width. */
interface TabRow {
  hidden: string[];
  fadeStart: boolean;
  fadeEnd: boolean;
  frozen: number;
}

interface TabDrag {
  id: string;
  pointerId: number;
  startX: number;
  startScroll: number;
  /** The pointer now. */
  x: number;
  active: boolean;
  /** Where each chip was when the drag started, in row coordinates. */
  slots: { el: HTMLElement; left: number; width: number }[];
  gap: number;
  from: number;
  to: number;
  frame: number;
}

/**
 * Slides the chips from their last places to their new places (FLIP). The tabs change after an answer
 * from the host, so the row keeps the places of its last layout rather than measuring before a change.
 * A new chip fades in.
 */
/** A tab of a named profile has a line in the profile's color, as its toolbar label has a dot. */
function tabProfileColor(profile: BrowserTabProfile | undefined): string | undefined {
  return profile?.hue == null ? undefined : browserProfileColor(profile.hue);
}

function createChipMotion(chips: () => HTMLElement[]) {
  let places = new Map<string, number>();
  const read = () => new Map(chips().map((el) => [el.dataset.tabId ?? "", el.offsetLeft]));
  return {
    /** Keeps the places of the layout now, without a slide. */
    keep: (override?: Map<string, number>) => {
      places = override ?? read();
    },
    play: () => {
      const before = places;
      const elements = chips();
      places = read();
      if (before.size === 0 || prefersReducedMotion() || elements.some((el) => !el.isConnected)) return;
      const timing = {
        duration: motionDuration("--openbot-duration-normal", 160),
        easing: getComputedStyle(document.documentElement).getPropertyValue("--openbot-ease-out").trim() || "ease-out",
      };
      for (const el of elements) {
        const id = el.dataset.tabId ?? "";
        const left = before.get(id);
        const now = places.get(id) ?? 0;
        if (left === undefined) {
          for (const animation of el.getAnimations()) animation.cancel();
          el.animate(
            [
              { opacity: 0, transform: "scale(0.94)" },
              { opacity: 1, transform: "none" },
            ],
            timing,
          );
          continue;
        }
        const dx = left - now;
        if (Math.abs(dx) < 0.5) continue;
        for (const animation of el.getAnimations()) animation.cancel();
        el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing);
      }
    },
  };
}

/**
 * Every tab, as the chips of the top row.
 * - Drag a chip to move it: the other chips slide out of its way, and near an edge the row scrolls.
 *   Escape puts it back.
 * - A middle click, Delete or the X closes a tab. After a close with the pointer, the chips keep their
 *   width until the pointer leaves the row, so the next X is under the pointer.
 * - A right click (or Control-click) opens the tab menu.
 * - When the chips do not fit, the row scrolls (also with a vertical wheel), its edges fade, and a
 *   menu lists the tabs out of view.
 */
export function BrowserTabStrip(props: {
  view: BrowserFullViewProps;
  onNewTab: (afterId?: string) => void;
  onClose: (tabIds: readonly string[]) => void;
}) {
  const { t } = useText();
  const tabTitle = useBrowserTabTitle();
  const [row, setRow] = createStore<TabRow>({ hidden: [], fadeStart: false, fadeEnd: false, frozen: 0 });
  const [hiddenMenuOpen, setHiddenMenuOpen] = createSignal(false);
  // The menu goes away with its button when every tab fits again, without a close, and a new button
  // starts closed.
  createEffect(
    () => row.hidden.length > 0,
    (shown) => {
      if (!shown) setHiddenMenuOpen(false);
    },
  );
  useBrowserPageCover(() => hiddenMenuOpen() && row.hidden.length > 0);
  let strip: HTMLElement | undefined;
  let drag: TabDrag | undefined;
  let swallowClick = false;
  let measureFrame = 0;

  const activeId = () => props.view.activeTab?.id;
  const canClose = () => props.view.canCloseTabs !== false;
  const chips = () => (strip ? [...strip.querySelectorAll<HTMLElement>(":scope > [data-tab-id]")] : []);
  const chip = (id: string) => chips().find((el) => el.dataset.tabId === id);
  const motion = createChipMotion(chips);
  const hiddenTabs = () => props.view.tabs.filter((tab) => row.hidden.includes(tab.id));

  /** Scrolls only the row, not the window, until the chip of the tab shows whole. */
  const reveal = (id: string) => {
    const el = chip(id);
    if (!strip || !el) return;
    const inset = Number.parseFloat(getComputedStyle(strip).paddingInlineStart) || 0;
    const left = el.offsetLeft - inset;
    const right = el.offsetLeft + el.offsetWidth + inset;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (left < strip.scrollLeft) strip.scrollTo({ left, behavior });
    else if (right > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: right - strip.clientWidth, behavior });
  };

  /** Finds the chips out of view. Offsets ignore the slides, so a moving chip counts at its new place. */
  const measureRow = () => {
    measureFrame = 0;
    if (!strip) return;
    const start = strip.scrollLeft;
    const end = start + strip.clientWidth;
    const width = strip.scrollWidth;
    const hidden = chips()
      .filter((el) => el.offsetLeft < start - 1 || el.offsetLeft + el.offsetWidth > end + 1)
      .map((el) => el.dataset.tabId ?? "");
    setRow((state) => {
      if (state.hidden.join() !== hidden.join()) state.hidden = hidden;
      state.fadeStart = start > 1;
      state.fadeEnd = end < width - 1;
    });
    if (!drag?.active) motion.keep();
  };
  const scheduleMeasure = () => {
    if (!measureFrame) measureFrame = requestAnimationFrame(measureRow);
  };

  createEffect(
    () => activeId(),
    (id) => {
      if (id) reveal(id);
    },
  );
  createEffect(
    () => props.view.tabs.map((tab) => tab.id).join(),
    () => {
      motion.play();
      scheduleMeasure();
    },
  );
  createEffect(
    () => row.frozen,
    () => scheduleMeasure(),
  );

  const close = (ids: readonly string[]) => {
    if (canClose()) props.onClose(ids);
  };
  const closeWithPointer = (id: string) => {
    if (!canClose()) return;
    const width = chip(id)?.offsetWidth;
    if (width)
      setRow((state) => {
        state.frozen = width;
      });
    close([id]);
  };

  /** Puts the held chip under the pointer and moves the chips between its old and new place by one slot. */
  const layout = (current: TabDrag) => {
    const held = current.slots[current.from];
    const first = current.slots[0];
    const last = current.slots.at(-1);
    if (!strip || !held || !first || !last) return;
    const offset = clamp(
      current.x - current.startX + strip.scrollLeft - current.startScroll,
      first.left - held.left,
      last.left + last.width - held.left - held.width,
    );
    const center = held.left + offset + held.width / 2;
    current.to = current.slots.filter(
      (slot, index) => index !== current.from && slot.left + slot.width / 2 < center,
    ).length;
    const step = held.width + current.gap;
    current.slots.forEach((slot, index) => {
      const shift =
        index === current.from
          ? offset
          : index > current.from && index <= current.to
            ? -step
            : index < current.from && index >= current.to
              ? step
              : 0;
      slot.el.style.transform = shift ? `translateX(${shift}px)` : "";
    });
  };

  const edgeScroll = () => {
    const current = drag;
    if (!current?.active || !strip) return;
    const rect = strip.getBoundingClientRect();
    const speed =
      current.x < rect.left + EDGE_ZONE_PX
        ? -(1 - Math.max(0, current.x - rect.left) / EDGE_ZONE_PX)
        : current.x > rect.right - EDGE_ZONE_PX
          ? 1 - Math.max(0, rect.right - current.x) / EDGE_ZONE_PX
          : 0;
    if (speed) {
      strip.scrollLeft += speed * EDGE_SPEED_PX;
      layout(current);
    }
    current.frame = requestAnimationFrame(edgeScroll);
  };

  const finishDrag = (drop: boolean) => {
    const current = drag;
    drag = undefined;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onDragKey, true);
    if (!current?.active || !strip) return;
    cancelAnimationFrame(current.frame);
    // The release also clicks the chip or its X; that click is part of the drag.
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    });
    // The chips settle from where they are drawn now.
    const origin = strip.getBoundingClientRect().left - strip.scrollLeft + strip.clientLeft;
    motion.keep(
      new Map(
        current.slots.map((slot) => [slot.el.dataset.tabId ?? "", slot.el.getBoundingClientRect().left - origin]),
      ),
    );
    for (const slot of current.slots) {
      slot.el.style.transform = "";
      slot.el.removeAttribute("data-dragging");
    }
    strip.removeAttribute("data-dragging");
    if (drop && current.to !== current.from) props.view.onMoveTab(current.id, current.to);
    // A drop in place changes no tab, so the held chip slides back here.
    else motion.play();
  };

  function onPointerMove(event: PointerEvent) {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId || !strip) return;
    current.x = event.clientX;
    if (!current.active) {
      if (Math.abs(current.x - current.startX) < DRAG_START_PX) return;
      current.slots = chips().map((el) => ({ el, left: el.offsetLeft, width: el.offsetWidth }));
      current.from = current.slots.findIndex((slot) => slot.el.dataset.tabId === current.id);
      if (current.from < 0) return finishDrag(false);
      current.active = true;
      current.to = current.from;
      current.startScroll = strip.scrollLeft;
      current.gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
      for (const slot of current.slots) for (const animation of slot.el.getAnimations()) animation.cancel();
      current.slots[current.from]?.el.setAttribute("data-dragging", "");
      strip.setAttribute("data-dragging", "");
      if (activeId() !== current.id) props.view.onActivateTab(current.id);
      current.frame = requestAnimationFrame(edgeScroll);
    }
    event.preventDefault();
    layout(current);
  }
  function onPointerUp(event: PointerEvent) {
    if (event.pointerId === drag?.pointerId) finishDrag(true);
  }
  function onPointerCancel(event: PointerEvent) {
    if (event.pointerId === drag?.pointerId) finishDrag(false);
  }
  function onDragKey(event: KeyboardEvent) {
    if (event.key !== "Escape" || !drag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag(false);
  }

  const onChipPointerDown = (event: PointerEvent, id: string) => {
    // The middle button closes on release (auxclick); here it only stops the scroll cursor.
    if (event.button === 1) event.preventDefault();
    // Control-click is the right click of macOS: its menu takes the release, so no drag starts.
    // A touch scrolls the row; a long press opens the menu.
    if (event.button !== 0 || event.pointerType === "touch" || event.ctrlKey || drag) return;
    drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: 0,
      x: event.clientX,
      active: false,
      slots: [],
      gap: 0,
      from: -1,
      to: -1,
      frame: 0,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onDragKey, true);
  };

  onSettled(() => {
    const element = strip;
    if (!element) return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    // A vertical wheel scrolls the row, as in other browsers.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    element.addEventListener("click", onClick, true);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    element.addEventListener("transitionend", scheduleMeasure);
    return () => {
      finishDrag(false);
      observer.disconnect();
      cancelAnimationFrame(measureFrame);
      element.removeEventListener("click", onClick, true);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("scroll", scheduleMeasure);
      element.removeEventListener("transitionend", scheduleMeasure);
    };
  });

  return (
    <>
      {/* The tab list moves the focus with the arrow keys, Home and End; the focus selects the tab. */}
      <Tabs.List
        ref={(element: HTMLDivElement) => {
          strip = element;
        }}
        class="side-panel-tabs browser-full-chips no-drag"
        aria-label={t("browser.tabs.label")}
        data-frozen={row.frozen ? "" : undefined}
        data-fade-start={row.fadeStart ? "" : undefined}
        data-fade-end={row.fadeEnd ? "" : undefined}
        style={row.frozen ? { "--browser-full-chip-frozen": `${row.frozen}px` } : undefined}
        onPointerLeave={() => {
          if (row.frozen)
            setRow((state) => {
              state.frozen = 0;
            });
        }}
      >
        <For each={props.view.tabs} keyed={(tab) => tab.id}>
          {(tab) => {
            const title = () => tabTitle(tab());
            const profile = () => props.view.profileForTab?.(tab());
            const titleWithProfile = () => {
              const current = profile();
              return current ? `${title()}\n${browserTabProfileLabel(t, current)}` : title();
            };
            const selected = () => activeId() === tab().id;
            const acting = () => props.view.controlForTab(tab())?.phase === "acting";
            const [menuOpen, setMenuOpen] = createSignal(false);
            useBrowserPageCover(menuOpen);
            return (
              <ContextMenu.Root modal={false} onOpenChange={setMenuOpen}>
                <ContextMenu.Trigger
                  role="presentation"
                  class="side-panel-tab browser-full-chip"
                  data-tab-id={tab().id}
                  data-selected={selected() ? "true" : undefined}
                  data-profile-color={tabProfileColor(profile()) ? "" : undefined}
                  style={{ "--browser-profile-color": tabProfileColor(profile()) }}
                  onPointerDown={(event: PointerEvent) => onChipPointerDown(event, tab().id)}
                  onAuxClick={(event: MouseEvent) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    closeWithPointer(tab().id);
                  }}
                  onDragStart={(event: DragEvent) => event.preventDefault()}
                >
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    disabled={!canClose()}
                    title={
                      tab().title ? t("browser.tab.closeNamed", { name: tab().title }) : t("browser.tab.closeUnnamed")
                    }
                    data-cuelume-close=""
                    data-cuelume-emphasis="subtle"
                    onClick={() => closeWithPointer(tab().id)}
                  >
                    <span class="side-panel-tab-icon">
                      <BrowserTabIcon view={props.view} tab={tab()} />
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
                  <Tabs.Trigger
                    as="button"
                    value={tab().id}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    onClick={() => props.view.onActivateTab(tab().id)}
                    // Focus that comes back from the page or another window has no related target.
                    // It lands on the tab the user chose before, not on a new choice.
                    onFocus={(event: FocusEvent) => {
                      if (event.relatedTarget !== null && !selected()) props.view.onActivateTab(tab().id);
                    }}
                    aria-label={
                      acting()
                        ? t("browser.tab.controlledBy", {
                            title: title(),
                            name: props.view.controllerForTab(tab())?.name ?? t("browser.tab.controllerFallback"),
                          })
                        : titleWithProfile()
                    }
                    aria-description={canClose() ? t("browser.tab.closeHint") : undefined}
                    aria-busy={tab().loading ? "true" : undefined}
                    title={titleWithProfile()}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key !== "Delete" || !canClose()) return;
                      event.preventDefault();
                      close([tab().id]);
                    }}
                  >
                    <span class="side-panel-tab-label">{title()}</span>
                  </Tabs.Trigger>
                </ContextMenu.Trigger>
                <BrowserTabMenu view={props.view} tab={tab()} onNewTab={props.onNewTab} onClose={close} />
              </ContextMenu.Root>
            );
          }}
        </For>
      </Tabs.List>
      <Show when={row.hidden.length > 0}>
        <DropdownMenu.Root modal={false} placement="bottom-end" gutter={4} onOpenChange={setHiddenMenuOpen}>
          <DropdownMenu.Trigger
            class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} no-drag`}
            aria-label={t("browser.tabs.more", { count: row.hidden.length })}
            title={t("browser.tabs.showHidden")}
          >
            <ChevronDown aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="browser-full-hidden-tabs">
              <For each={hiddenTabs()} keyed={(tab) => tab.id}>
                {(tab) => (
                  <DropdownMenu.Item
                    aria-current={activeId() === tab().id ? "true" : undefined}
                    onSelect={() => {
                      props.view.onActivateTab(tab().id);
                      reveal(tab().id);
                    }}
                  >
                    <BrowserTabIcon view={props.view} tab={tab()} />
                    <span>{tabTitle(tab())}</span>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Show>
    </>
  );
}
