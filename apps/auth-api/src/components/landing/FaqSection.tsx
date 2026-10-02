import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";
import { LANDING_COMPARISON_LINKS } from "../../lib/landing-content";
import { LANDING_FAQ } from "../../lib/landing-faq";
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
        <header class="landing-section-heading">
          <h2 id="faq-title">Questions</h2>
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
        <nav class="landing-compare-links" aria-labelledby="landing-compare-title">
          <h3 id="landing-compare-title">Compare OpenBot</h3>
          <ul>
            <For each={LANDING_COMPARISON_LINKS}>
              {(comparison) => (
                <li>
                  <Link to="/compare/$slug" params={{ slug: comparison.slug }}>
                    {comparison.label}
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
