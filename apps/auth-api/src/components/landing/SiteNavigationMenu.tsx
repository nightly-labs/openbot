import { createSignal, createUniqueId, For, flush, onSettled } from "solid-js";
import { SITE_NAVIGATION_SECTIONS, type SiteNavigationSection } from "../../lib/site-navigation";
import { LandingIcon } from "./LandingIcon";
import { SiteNavigationPanel } from "./SiteNavigationPanel";

// The header menu on a wide screen. A Solid port of the Kobra navigation menu
// (https://kobra.systems/components/navigation-menu), which is React on Base UI.
//
// It is a disclosure, not an ARIA menu: every trigger is a button that shows a
// panel of ordinary links, and each panel sits in the DOM right after its
// trigger, so Tab walks from a trigger into its open panel and on to the next
// trigger. A closed panel is inert.
//
// Two things move, and neither is the panel itself:
// - the pill, which slides behind the trigger under the pointer or focus;
// - the surface, one frosted card behind every panel, which takes the size and
//   position of the panel that is open. Changing section morphs the surface and
//   slides the contents in from the side of the section being opened.
//
// Geometry is written to the DOM in the event handler rather than through a
// signal. A setter here applies after a microtask, and the surface has to be at
// its new size in the same frame the panel starts to slide in.

type SectionId = SiteNavigationSection["id"];
type PanelMotion = "enter" | "exit" | "from-start" | "from-end" | "to-start" | "to-end";

interface MenuMotion {
  opened: PanelMotion;
  closed?: { id: SectionId; motion: PanelMotion };
}

/** Long enough that a pointer crossing the header on its way down does not open a panel. */
const OPEN_DELAY_MS = 90;
/** Long enough to cross from a trigger to its panel, or to slip off an edge and come back. */
const CLOSE_DELAY_MS = 180;
/** A second press within this time of a hover opening the panel keeps it open. */
const HOVER_CLICK_GRACE_MS = 400;
const VIEWPORT_GUTTER_PX = 16;

export function SiteNavigationMenu() {
  const baseId = createUniqueId();
  const [active, setActive] = createSignal<SectionId | null>(null);
  const [motion, setMotion] = createSignal<MenuMotion>({ opened: "enter" });
  // The panels on screen: the open one, and the one still animating out. Their
  // featured artwork animates, and every other panel's stays still.
  const [shown, setShown] = createSignal<readonly SectionId[]>([]);

  let root: HTMLElement | undefined;
  let list: HTMLUListElement | undefined;
  let pill: HTMLSpanElement | undefined;
  let surface: HTMLDivElement | undefined;
  const triggers = new Map<SectionId, HTMLButtonElement>();
  const panels = new Map<SectionId, HTMLDivElement>();

  // The open section as of this handler. `active()` catches up a microtask later.
  let current: SectionId | null = null;
  let openedAt = 0;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let pillShown = false;

  const panelId = (id: SectionId) => `${baseId}-${id}`;
  const order = (id: SectionId) => SITE_NAVIGATION_SECTIONS.findIndex((section) => section.id === id);
  const triggerSection = (target: EventTarget | null) =>
    SITE_NAVIGATION_SECTIONS.find((section) => triggers.get(section.id) === target)?.id;

  function clearTimers(): void {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  }

  /** Apply a style change with transitions off, so the element jumps rather than slides. */
  function instantly(element: HTMLElement, change: () => void): void {
    element.dataset.instant = "";
    change();
    void element.offsetWidth;
    delete element.dataset.instant;
  }

  /** Centre the panel under its trigger, kept inside the window, and fit the surface to it. */
  function place(id: SectionId): void {
    const panel = panels.get(id);
    const trigger = triggers.get(id);
    if (!root || !panel || !trigger || !surface) return;
    const rootBox = root.getBoundingClientRect();
    const triggerBox = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const centred = triggerBox.left + triggerBox.width / 2 - width / 2;
    const fitted = Math.max(VIEWPORT_GUTTER_PX, Math.min(centred, window.innerWidth - VIEWPORT_GUTTER_PX - width));
    const left = fitted - rootBox.left;
    const origin = triggerBox.left + triggerBox.width / 2 - fitted;

    panel.style.left = `${left}px`;
    surface.style.setProperty("--site-nav-surface-x", `${left}px`);
    surface.style.setProperty("--site-nav-surface-width", `${width}px`);
    surface.style.setProperty("--site-nav-surface-height", `${height}px`);
    surface.style.setProperty("--site-nav-surface-origin", `${origin}px`);
  }

  function movePill(target: HTMLElement): void {
    if (!list || !pill) return;
    const listBox = list.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const element = pill;
    const apply = () => {
      element.style.setProperty("--site-nav-pill-x", `${box.left - listBox.left}px`);
      element.style.setProperty("--site-nav-pill-width", `${box.width}px`);
    };
    if (pillShown) {
      apply();
      return;
    }
    // The first time it appears it fades in where it is, instead of sliding in from the left edge.
    instantly(element, apply);
    element.dataset.shown = "";
    pillShown = true;
  }

  /** Back to the open trigger when the pointer leaves, or away when nothing is open. */
  function settlePill(): void {
    const trigger = current ? triggers.get(current) : undefined;
    if (trigger) {
      movePill(trigger);
      return;
    }
    if (pill) delete pill.dataset.shown;
    pillShown = false;
  }

  function open(id: SectionId): void {
    clearTimers();
    if (current === id) return;
    const previous = current;
    current = id;
    openedAt = performance.now();

    if (previous === null) {
      const element = surface;
      if (element) instantly(element, () => place(id));
      setMotion({ opened: "enter" });
      setShown([id]);
    } else {
      place(id);
      const forward = order(id) > order(previous);
      setMotion({
        opened: forward ? "from-end" : "from-start",
        closed: { id: previous, motion: forward ? "to-start" : "to-end" },
      });
      // A panel older than `previous` has lost its motion, and with it the
      // animation that kept it visible.
      setShown([previous, id]);
    }
    setActive(id);
    const trigger = triggers.get(id);
    if (trigger) movePill(trigger);
  }

  function close(): void {
    clearTimers();
    if (current === null) return;
    const previous = current;
    current = null;
    setMotion({ opened: "enter", closed: { id: previous, motion: "exit" } });
    // A panel still fading out of a switch loses its motion here, so its
    // animation is cancelled and no animationend will stop its artwork.
    setShown([previous]);
    setActive(null);
    settlePill();
  }

  function scheduleClose(): void {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, CLOSE_DELAY_MS);
  }

  function panelMotion(id: SectionId): PanelMotion | undefined {
    if (active() === id) return motion().opened;
    const closed = motion().closed;
    return closed?.id === id ? closed.motion : undefined;
  }

  function handleTriggerPointerEnter(event: PointerEvent, id: SectionId): void {
    if (event.pointerType !== "mouse") return;
    const trigger = triggers.get(id);
    if (trigger) movePill(trigger);
    clearTimeout(closeTimer);
    if (current !== null) {
      open(id);
      return;
    }
    clearTimeout(openTimer);
    openTimer = setTimeout(() => open(id), OPEN_DELAY_MS);
  }

  function handleTriggerClick(id: SectionId): void {
    if (current === id && performance.now() - openedAt > HOVER_CLICK_GRACE_MS) {
      close();
      return;
    }
    open(id);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && current !== null) {
      event.preventDefault();
      const trigger = triggers.get(current);
      close();
      trigger?.focus();
      return;
    }

    const id = triggerSection(event.target);
    if (event.key === "ArrowDown" && id) {
      event.preventDefault();
      open(id);
      // The panel stops being inert only once the signal has applied.
      flush();
      panels.get(id)?.querySelector<HTMLElement>("a")?.focus();
    }
  }

  function handleFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (triggerSection(target) && target instanceof HTMLElement && target.matches(":focus-visible")) movePill(target);
  }

  function handleFocusOut(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return;
    close();
  }

  /** A link in a panel leaves the page, or moves within it: either way the menu is done. */
  /** A panel that has finished animating out is off screen, so its artwork stops. */
  function handlePanelAnimationEnd(event: AnimationEvent, id: SectionId): void {
    if (event.target !== event.currentTarget || current === id) return;
    setShown((ids) => ids.filter((shownId) => shownId !== id));
  }

  function handleLinkClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("a")) close();
  }

  onSettled(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (current !== null && event.target instanceof Node && !root?.contains(event.target)) close();
    };
    const handleResize = () => {
      if (current !== null) {
        const element = surface;
        const id = current;
        if (element) instantly(element, () => place(id));
      }
      settlePill();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimers();
      document.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("resize", handleResize);
    };
  });

  return (
    <nav
      ref={root}
      class="site-nav"
      aria-label="Primary navigation"
      data-state={active() ? "open" : "closed"}
      onPointerEnter={() => clearTimeout(closeTimer)}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") scheduleClose();
      }}
      onKeyDown={handleKeyDown}
      onFocusIn={handleFocusIn}
      onFocusOut={handleFocusOut}
      onClick={handleLinkClick}
    >
      <div class="site-nav-track">
        <span ref={pill} class="site-nav-pill" aria-hidden="true" />
        <ul ref={list} class="site-nav-list" onPointerLeave={settlePill}>
          <For each={SITE_NAVIGATION_SECTIONS}>
            {(section) => (
              <li class="site-nav-item">
                <button
                  ref={(element) => triggers.set(section.id, element)}
                  class="site-nav-trigger"
                  type="button"
                  aria-expanded={active() === section.id ? "true" : "false"}
                  aria-controls={panelId(section.id)}
                  onPointerEnter={(event) => handleTriggerPointerEnter(event, section.id)}
                  onPointerLeave={() => clearTimeout(openTimer)}
                  onClick={() => handleTriggerClick(section.id)}
                >
                  {section.label}
                  <LandingIcon name="chevron-down" class="site-nav-chevron" />
                </button>
                <div
                  ref={(element) => panels.set(section.id, element)}
                  id={panelId(section.id)}
                  class="site-nav-panel"
                  data-state={active() === section.id ? "open" : "closed"}
                  data-motion={panelMotion(section.id)}
                  inert={active() !== section.id}
                  onAnimationEnd={(event) => handlePanelAnimationEnd(event, section.id)}
                >
                  <SiteNavigationPanel section={section} live={shown().includes(section.id)} />
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
      <div ref={surface} class="site-nav-surface" aria-hidden="true" />
    </nav>
  );
}
