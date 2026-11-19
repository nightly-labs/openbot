import { Link } from "@tanstack/solid-router";
import { createSignal, createUniqueId, For, flush, Match, onSettled, Switch } from "solid-js";
import { SITE_NAVIGATION_LINKS, SITE_NAVIGATION_SECTIONS, type SiteNavigationSection } from "../../lib/site-navigation";
import { LandingIcon } from "./LandingIcon";
import { SiteNavigationPanel } from "./SiteNavigationPanel";
import { useSiteChrome, useSitePath } from "./SiteText";

type SectionId = SiteNavigationSection["id"];
type PanelMotion = "enter" | "exit" | "from-start" | "from-end" | "to-start" | "to-end";

interface MenuMotion {
  opened: PanelMotion;
  closed?: { id: SectionId; motion: PanelMotion };
}

const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 180;
const VIEWPORT_GUTTER_PX = 16;

export function SiteNavigationMenu() {
  const chrome = useSiteChrome();
  const text = () => chrome().text;
  const path = useSitePath();
  const baseId = createUniqueId();
  const [active, setActive] = createSignal<SectionId | null>(null);
  const [motion, setMotion] = createSignal<MenuMotion>({ opened: "enter" });
  const [shown, setShown] = createSignal<readonly SectionId[]>([]);

  let root: HTMLElement | undefined;
  let list: HTMLUListElement | undefined;
  let pill: HTMLSpanElement | undefined;
  let surface: HTMLDivElement | undefined;
  const triggers = new Map<SectionId, HTMLElement>();
  const panels = new Map<SectionId, HTMLDivElement>();

  let current: SectionId | null = null;
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

  function instantly(element: HTMLElement, change: () => void): void {
    element.dataset.instant = "";
    change();
    void element.offsetWidth;
    delete element.dataset.instant;
  }

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
    instantly(element, apply);
    element.dataset.shown = "";
    pillShown = true;
  }

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

  let pressPointer = "mouse";

  function handleButtonTriggerClick(event: MouseEvent, id: SectionId): void {
    if (current === id && (event.detail === 0 || pressPointer !== "mouse")) {
      close();
      return;
    }
    open(id);
  }

  function reachLink(link: HTMLElement): void {
    clearTimeout(openTimer);
    if (current !== null) close();
    movePill(link);
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
      flush();
      panels.get(id)?.querySelector<HTMLElement>("a")?.focus();
    }
  }

  function handleFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(":focus-visible")) return;
    if (triggerSection(target)) movePill(target);
    else if (target.matches(".site-nav-link")) reachLink(target);
  }

  function handleFocusOut(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return;
    close();
  }

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
      aria-label={text().primaryNavigation}
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
                <Switch>
                  <Match when={section.kind !== "resources" && section}>
                    {(linked) => (
                      <Link
                        ref={(element: HTMLAnchorElement) => triggers.set(section.id, element)}
                        class="site-nav-trigger"
                        to={linked().indexRoute}
                        aria-expanded={active() === section.id ? "true" : "false"}
                        aria-controls={panelId(section.id)}
                        onPointerEnter={(event) => handleTriggerPointerEnter(event, section.id)}
                        onPointerLeave={() => clearTimeout(openTimer)}
                      >
                        {text().sections[section.id].label}
                        <LandingIcon name="chevron-down" class="site-nav-chevron" />
                      </Link>
                    )}
                  </Match>
                  <Match when={section.kind === "resources"}>
                    <button
                      ref={(element) => triggers.set(section.id, element)}
                      type="button"
                      class="site-nav-trigger"
                      aria-expanded={active() === section.id ? "true" : "false"}
                      aria-controls={panelId(section.id)}
                      onPointerEnter={(event) => handleTriggerPointerEnter(event, section.id)}
                      onPointerLeave={() => clearTimeout(openTimer)}
                      onPointerDown={(event) => (pressPointer = event.pointerType)}
                      onClick={(event) => handleButtonTriggerClick(event, section.id)}
                    >
                      {text().sections[section.id].label}
                      <LandingIcon name="chevron-down" class="site-nav-chevron" />
                    </button>
                  </Match>
                </Switch>
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
          <For each={SITE_NAVIGATION_LINKS}>
            {(link) => (
              <li class="site-nav-item">
                <Link
                  class="site-nav-trigger site-nav-link"
                  to={path(link.to)}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") reachLink(event.currentTarget);
                  }}
                >
                  {text().links[link.id]}
                </Link>
              </li>
            )}
          </For>
        </ul>
      </div>
      <div ref={surface} class="site-nav-surface" aria-hidden="true" />
    </nav>
  );
}
