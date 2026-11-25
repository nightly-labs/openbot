import type { BrowserTabProfile } from "@openbot/contracts/ipc";
import { Button, buttonVariants, ChevronDown, ContextMenu, DropdownMenu, Tabs, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { clamp, motionDuration, prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createSignal, For, flush, onSettled, Show } from "solid-js";
import { createTabRow } from "../../components/createTabRow";
import { browserProfileColor } from "./BrowserProfileColor";
import { BrowserTabIcon, useBrowserTabTitle } from "./BrowserTabIcon";
import { BrowserTabMenu } from "./BrowserTabMenu";
import { type BrowserFullViewProps, browserTabProfileLabel } from "./browser-full-view-types";
import { useBrowserPageCover } from "./browser-page-cover";

const DRAG_START_PX = 6;
interface TabDrag {
  id: string;
  pointerId: number;
  startX: number;
  startScroll: number;
  x: number;
  active: boolean;
  slots: { el: HTMLElement; left: number; width: number }[];
  gap: number;
  from: number;
  to: number;
  frame: number;
}

function tabProfileColor(profile: BrowserTabProfile | undefined): string | undefined {
  return profile?.hue == null ? undefined : browserProfileColor(profile.hue);
}

function motionTiming(): KeyframeAnimationOptions {
  return {
    duration: motionDuration("--openbot-duration-normal", 160),
    easing: getComputedStyle(document.documentElement).getPropertyValue("--openbot-ease-out").trim() || "ease-out",
  };
}

function siblingsAfter(element: HTMLElement): HTMLElement[] {
  const siblings: HTMLElement[] = [];
  for (let next = element.nextElementSibling; next instanceof HTMLElement; next = next.nextElementSibling)
    siblings.push(next);
  return siblings;
}

function createChipMotion(chips: () => HTMLElement[]) {
  let places = new Map<string, number>();
  const read = () => new Map(chips().map((el) => [el.dataset.tabId ?? "", el.offsetLeft]));
  return {
    keep: (override?: Map<string, number>) => {
      places = override ?? read();
    },
    play: (): Animation[] => {
      const before = places;
      const elements = chips();
      places = read();
      if (before.size === 0 || prefersReducedMotion() || elements.some((el) => !el.isConnected)) return [];
      const started: Animation[] = [];
      const timing = motionTiming();
      for (const el of elements) {
        const id = el.dataset.tabId ?? "";
        const left = before.get(id);
        const now = places.get(id) ?? 0;
        if (left === undefined) {
          for (const animation of el.getAnimations()) animation.cancel();
          started.push(
            el.animate(
              [
                { opacity: 0, transform: "scale(0.94)" },
                { opacity: 1, transform: "none" },
              ],
              timing,
            ),
          );
          continue;
        }
        const dx = left - now;
        if (Math.abs(dx) < 0.5) continue;
        for (const animation of el.getAnimations()) animation.cancel();
        started.push(el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing));
      }
      return started;
    },
  };
}

export function BrowserTabStrip(props: {
  view: BrowserFullViewProps;
  onNewTab: (afterId?: string) => void;
  onClose: (tabIds: readonly string[]) => void;
}) {
  const { t } = useText();
  const tabTitle = useBrowserTabTitle();
  let strip: HTMLElement | undefined;
  let drag: TabDrag | undefined;
  let swallowClick = false;

  const activeId = () => props.view.activeTab?.id;
  const canClose = () => props.view.canCloseTabs !== false;
  const chips = () => (strip ? [...strip.querySelectorAll<HTMLElement>(":scope > [data-tab-id]")] : []);
  const motion = createChipMotion(chips);
  const tabRow = createTabRow({
    list: () => strip,
    tabs: () => chips(),
    key: (el) => el.dataset.tabId ?? "",
    measured: () => {
      if (!drag?.active) motion.keep();
    },
  });
  const row = tabRow.row;
  const frozenStyle = () =>
    row.frozen
      ? { "--browser-full-chip-frozen": `${row.frozen}px`, "--browser-full-chips-frozen": `${row.frozenRow}px` }
      : undefined;
  const [hiddenMenuOpen, setHiddenMenuOpen] = createSignal(false);
  createEffect(
    () => row.hidden.length > 0,
    (shown) => {
      if (!shown) setHiddenMenuOpen(false);
    },
  );
  useBrowserPageCover(() => hiddenMenuOpen() && row.hidden.length > 0);
  const hiddenTabs = () => props.view.tabs.filter((tab) => row.hidden.includes(tab.id));

  createEffect(
    () => activeId(),
    (id) => {
      if (id) tabRow.reveal(id);
    },
  );
  createEffect(
    () => props.view.tabs.map((tab) => tab.id).join(),
    () => {
      const animations = motion.play();
      tabRow.measure();
      if (animations.length > 0)
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(tabRow.measure);
    },
  );

  const close = (ids: readonly string[]) => {
    if (canClose()) props.onClose(ids);
  };
  const unfreeze = () => {
    const list = strip;
    if (!row.frozen || !list || prefersReducedMotion()) {
      tabRow.unfreeze();
      return;
    }
    const following = siblingsAfter(list);
    const before = following.map((element) => element.getBoundingClientRect().left);
    tabRow.unfreeze();
    flush();
    const timing = motionTiming();
    following.forEach((element, index) => {
      const dx = (before[index] ?? 0) - element.getBoundingClientRect().left;
      if (Math.abs(dx) >= 0.5) element.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing);
    });
  };
  const closeWithPointer = (id: string) => {
    if (!canClose()) return;
    tabRow.freeze(id);
    close([id]);
  };

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
    if (!current?.active) return;
    if (tabRow.scrollAtEdge(current.x)) layout(current);
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
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    });
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
    if (event.button === 1) event.preventDefault();
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
    const unbind = tabRow.bind(element);
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("click", onClick, true);
    return () => {
      finishDrag(false);
      unbind();
      element.removeEventListener("click", onClick, true);
    };
  });

  return (
    <>
      <Tabs.List
        ref={(element: HTMLDivElement) => {
          strip = element;
        }}
        class="side-panel-tabs browser-full-chips no-drag"
        aria-label={t("browser.tabs.label")}
        data-frozen={row.frozen ? "" : undefined}
        data-fade-start={row.fadeStart ? "" : undefined}
        data-fade-end={row.fadeEnd ? "" : undefined}
        style={frozenStyle()}
        onPointerLeave={unfreeze}
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
                      tabRow.reveal(tab().id);
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
