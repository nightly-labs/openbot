import { AppLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";
import { LANDING_COMPARISON_LINKS } from "../../lib/landing-content";
import { LANDING_FAQ } from "../../lib/landing-faq";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { RivalMark } from "../compare/RivalMark";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

export function FaqSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);

  return (
    <section
      ref={sectionRef}
      class="landing-section landing-faq"
      aria-labelledby="faq-title"
      data-revealed={revealed() ? "true" : "false"}
    >
      <div class="landing-section-inner">
        <div class="landing-faq-layout">
          <header class="landing-section-heading landing-faq-heading">
            <h2 id="faq-title">Questions</h2>
            <p>Short answers about price, providers and your data.</p>
            <a class="landing-faq-contact" href={OPENBOT_LINKS.contact} target="_blank" rel={EXTERNAL_LINK_REL}>
              Ask us something else
              <LandingIcon name="arrow-up-right" class="landing-faq-contact-icon" />
            </a>
          </header>
          <div class="landing-faq-body">
            <div class="compare-faq-list">
              <For each={LANDING_FAQ}>
                {(entry, index) => (
                  <details class="compare-faq-item" style={{ "--landing-index": index() }}>
                    <summary class="compare-faq-question">
                      {entry.question}
                      <LandingIcon name="chevron-down" class="compare-faq-chevron" />
                    </summary>
                    <p class="compare-faq-answer">{entry.answer}</p>
                  </details>
                )}
              </For>
            </div>
          </div>
        </div>
        <nav class="landing-compare-links" aria-labelledby="landing-compare-title">
          <h3 id="landing-compare-title">Compare OpenBot</h3>
          <ul>
            <For each={LANDING_COMPARISON_LINKS}>
              {(comparison, index) => (
                <li style={{ "--landing-index": index() }}>
                  <Link to="/compare/$slug" params={{ slug: comparison.slug }}>
                    <span class="landing-compare-marks" aria-hidden="true">
                      <AppLogo variant="production" class="landing-compare-mark" />
                      <RivalMark name={comparison.mark} class="landing-compare-mark landing-compare-mark-rival" />
                    </span>
                    <span class="landing-compare-label">{comparison.label}</span>
                    <LandingIcon name="arrow-right" class="landing-compare-arrow" />
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </div>
    </section>
  );
}
