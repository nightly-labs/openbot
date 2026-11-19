import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createSignal, createUniqueId, For, onSettled } from "solid-js";
import { SITE_NAVIGATION_LINKS, SITE_NAVIGATION_SECTIONS } from "../../lib/site-navigation";
import { LandingIcon } from "./LandingIcon";
import { SiteNavigationPanel } from "./SiteNavigationPanel";
import { useSiteChrome, useSitePath } from "./SiteText";

const MOBILE_HEADER_QUERY = "(max-width: 1100px)";

export interface SiteMobileMenuProps {
  actions: () => JSX.Element;
}

export function SiteMobileMenu(props: SiteMobileMenuProps) {
  const sheetId = createUniqueId();
  const chrome = useSiteChrome();
  const text = () => chrome().text;
  const path = useSitePath();
  const [open, setOpen] = createSignal(false);
  const [live, setLive] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  let sheet: HTMLDivElement | undefined;
  let covered: HTMLElement[] = [];

  function coverPage(): void {
    for (let node = sheet?.closest("header"); node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
        sibling.inert = true;
        covered.push(sibling);
      }
    }
  }

  function uncoverPage(): void {
    for (const element of covered) element.inert = false;
    covered = [];
  }

  function setSheet(next: boolean): void {
    setOpen(next);
    if (next) setLive(true);
    document.documentElement.toggleAttribute("data-site-sheet-open", next);
    if (next && covered.length === 0) coverPage();
    if (!next) uncoverPage();
  }

  onSettled(() => {
    const media = window.matchMedia?.(MOBILE_HEADER_QUERY);
    const handleMedia = () => {
      if (media?.matches) return;
      setSheet(false);
      setLive(false);
    };
    const handleSheetTransitionEnd = (event: TransitionEvent) => {
      if (event.target === sheet && event.propertyName === "opacity" && !open()) setLive(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open()) return;
      setSheet(false);
      button?.focus();
    };
    const handleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a") && sheet?.contains(event.target))
        setSheet(false);
    };
    media?.addEventListener("change", handleMedia);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleClick);
    sheet?.addEventListener("transitionend", handleSheetTransitionEnd);
    return () => {
      media?.removeEventListener("change", handleMedia);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClick);
      sheet?.removeEventListener("transitionend", handleSheetTransitionEnd);
      document.documentElement.removeAttribute("data-site-sheet-open");
      uncoverPage();
    };
  });

  return (
    <>
      <button
        ref={button}
        class="site-menu-button"
        type="button"
        aria-label={open() ? text().closeMenu : text().openMenu}
        aria-expanded={open() ? "true" : "false"}
        aria-controls={sheetId}
        onClick={() => setSheet(!open())}
      >
        <span class="site-menu-button-line" aria-hidden="true" />
        <span class="site-menu-button-line" aria-hidden="true" />
      </button>
      <div ref={sheet} id={sheetId} class="site-sheet" data-state={open() ? "open" : "closed"} inert={!open()}>
        <nav class="site-sheet-content" aria-label={text().siteMenu}>
          <For each={SITE_NAVIGATION_SECTIONS}>
            {(section, index) => (
              <section class="site-sheet-section" style={{ "--site-sheet-index": index() }}>
                <p class="site-sheet-heading">{text().sections[section.id].label}</p>
                <SiteNavigationPanel section={section} live={live()} />
              </section>
            )}
          </For>
          <For each={SITE_NAVIGATION_LINKS}>
            {(link, index) => (
              <div
                class="site-sheet-section"
                style={{ "--site-sheet-index": SITE_NAVIGATION_SECTIONS.length + index() }}
              >
                <Link class="site-sheet-link" to={path(link.to)}>
                  {text().links[link.id]}
                  <LandingIcon name="arrow-right" />
                </Link>
              </div>
            )}
          </For>
          <div
            class="site-sheet-actions"
            style={{ "--site-sheet-index": SITE_NAVIGATION_SECTIONS.length + SITE_NAVIGATION_LINKS.length }}
          >
            {props.actions()}
          </div>
        </nav>
      </div>
    </>
  );
}
