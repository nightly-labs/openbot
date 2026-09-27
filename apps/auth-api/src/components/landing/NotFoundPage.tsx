import { AppLogo } from "@openbot/brand";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { Link, useLocation } from "@tanstack/solid-router";
import { createSignal, For, onSettled } from "solid-js";
import { ButtonLink } from "../ui/button";
import { LandingFooter } from "./LandingFooter";
import { SiteHeader } from "./SiteHeader";

// After this long without a pointer move, the logo stops following the pointer and looks around again.
const IDLE_MS = 2400;

const SEARCH_STEPS = [
  { label: "Searching workspaces", result: "empty" },
  { label: "Checking threads", result: "empty" },
  { label: "Asking teammates", result: "no answer" },
] as const;

const SUGGESTIONS = [
  { to: "/guides", label: "Guides" },
  { to: "/news", label: "News" },
  { to: "/compare", label: "Compare" },
  { to: "/plugins", label: "Plugins" },
] as const;

export function NotFoundPage() {
  const location = useLocation();
  const [tracking, setTracking] = createSignal(false);
  let stage: HTMLDivElement | undefined;

  // The eyes follow the pointer anywhere on the page, not only over the logo.
  onSettled(() => {
    const element = stage;
    if (!element || prefersReducedMotion() || !window.matchMedia?.("(pointer: fine)").matches) return;

    let idleTimer: number | undefined;
    let frameId: number | undefined;

    const handlePointerMove = (event: PointerEvent) => {
      if (frameId !== undefined) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = undefined;
        const bounds = element.getBoundingClientRect();
        const x = (event.clientX - bounds.left - bounds.width / 2) / (window.innerWidth / 2);
        const y = (event.clientY - bounds.top - bounds.height / 2) / (window.innerHeight / 2);
        element.style.setProperty("--app-logo-eye-x", `${Math.max(-1, Math.min(1, x)) * 5}%`);
        element.style.setProperty("--app-logo-eye-y", `${Math.max(-1, Math.min(1, y)) * 4}%`);
      });
      setTracking(true);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        element.style.removeProperty("--app-logo-eye-x");
        element.style.removeProperty("--app-logo-eye-y");
        setTracking(false);
      }, IDLE_MS);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.clearTimeout(idleTimer);
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  });

  return (
    <div class="landing-page not-found-page">
      <SiteHeader page="content" />

      <main class="not-found-main">
        <div class="landing-hero-grid not-found-grid" aria-hidden="true" />
        <div class="not-found-searchlight" aria-hidden="true" />

        <div ref={stage} class="not-found-stage" data-tracking={tracking() ? "true" : "false"} aria-hidden="true">
          <span class="not-found-digit">
            <span class="not-found-digit-glyph">4</span>
          </span>
          <span class="not-found-bot">
            <AppLogo variant="production" animation={tracking() ? "none" : "look-around"} class="not-found-bot-logo" />
            <span class="not-found-bot-shadow" />
          </span>
          <span class="not-found-digit">
            <span class="not-found-digit-glyph">4</span>
          </span>
        </div>

        <section class="not-found-copy" aria-labelledby="not-found-title">
          <p class="not-found-eyebrow">Error 404</p>
          <h1 id="not-found-title" class="not-found-title">
            This page wandered off
          </h1>
          <p class="not-found-description">
            The link may be out of date, or the page moved. Check the address, or try one of these pages.
          </p>
          <div class="not-found-actions">
            <ButtonLink to="/" variant="primary" size="lg" icon="open">
              Back to home
            </ButtonLink>
            <ButtonLink to="/guides" variant="secondary" size="lg" icon="arrow-right">
              Read the guides
            </ButtonLink>
          </div>
        </section>

        <div class="not-found-terminal">
          <div class="not-found-terminal-bar" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <ol class="not-found-terminal-lines">
            <li class="not-found-line not-found-line-command" style={{ "--line": 0 }}>
              <span class="not-found-prompt">$</span> openbot open{" "}
              <span class="not-found-path">{location().pathname}</span>
            </li>
            <For each={SEARCH_STEPS}>
              {(step, index) => (
                <li class="not-found-line" style={{ "--line": index() + 1 }}>
                  <span class="not-found-arrow">→</span> {step.label}…{" "}
                  <span class="not-found-result">{step.result}</span>
                </li>
              )}
            </For>
            <li class="not-found-line not-found-line-error" style={{ "--line": SEARCH_STEPS.length + 1 }}>
              <span class="not-found-cross">✕</span> 404 · Nothing lives at this address.
              <span class="not-found-caret" aria-hidden="true" />
            </li>
          </ol>
        </div>

        <nav class="not-found-links" aria-label="Popular pages">
          <For each={SUGGESTIONS}>
            {(link, index) => (
              <Link to={link.to} class="not-found-link" style={{ "--link": index() }}>
                {link.label}
              </Link>
            )}
          </For>
        </nav>
      </main>

      <LandingFooter />
    </div>
  );
}
