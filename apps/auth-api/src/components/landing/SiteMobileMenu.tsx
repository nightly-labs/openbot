import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled } from "solid-js";
import { SITE_NAVIGATION_SECTIONS } from "../../lib/site-navigation";
import { SiteNavigationPanel } from "./SiteNavigationPanel";

/** The width under which the header folds into the menu button. Matches the stylesheet. */
const MOBILE_HEADER_QUERY = "(max-width: 900px)";

export interface SiteMobileMenuProps {
  /** Draws the header's own buttons again, at the foot of the sheet. A node can sit in one place only. */
  actions: () => JSX.Element;
}

// The header menu on a narrow screen: a button that turns into a close mark, and
// a sheet under the header with the same sections as the desktop panels. The
// sheet covers the page, so the page stops scrolling while it is open, and it
// closes on Escape, on a link, and when the window grows past the breakpoint.
export function SiteMobileMenu(props: SiteMobileMenuProps) {
  const sheetId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  // Open, or still fading out. The featured artwork animates only then.
  const [live, setLive] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  let sheet: HTMLDivElement | undefined;

  function setSheet(next: boolean): void {
    setOpen(next);
    if (next) setLive(true);
    document.documentElement.toggleAttribute("data-site-sheet-open", next);
  }

  onSettled(() => {
    const media = window.matchMedia?.(MOBILE_HEADER_QUERY);
    const handleMedia = () => {
      if (media?.matches) return;
      setSheet(false);
      // Past the breakpoint the sheet is not drawn, so no fade will end.
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
    };
  });

  return (
    <>
      <button
        ref={button}
        class="site-menu-button"
        type="button"
        aria-label={open() ? "Close menu" : "Open menu"}
        aria-expanded={open() ? "true" : "false"}
        aria-controls={sheetId}
        onClick={() => setSheet(!open())}
      >
        <span class="site-menu-button-line" aria-hidden="true" />
        <span class="site-menu-button-line" aria-hidden="true" />
      </button>
      <div ref={sheet} id={sheetId} class="site-sheet" data-state={open() ? "open" : "closed"} inert={!open()}>
        <nav class="site-sheet-content" aria-label="Site menu">
          <For each={SITE_NAVIGATION_SECTIONS}>
            {(section, index) => (
              <section class="site-sheet-section" style={{ "--site-sheet-index": index() }}>
                <h2 class="site-sheet-heading">{section.label}</h2>
                <SiteNavigationPanel section={section} live={live()} />
              </section>
            )}
          </For>
          <div class="site-sheet-actions" style={{ "--site-sheet-index": SITE_NAVIGATION_SECTIONS.length }}>
            {props.actions()}
          </div>
        </nav>
      </div>
    </>
  );
}
