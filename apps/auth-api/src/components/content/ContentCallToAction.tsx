import { AgentHoneycomb, honeycombRows } from "../landing/AgentHoneycomb";
import { createLandingReveal } from "../landing/createLandingReveal";
import { ButtonLink } from "../ui/button";

// Covers a 1920 px screen and is taller than the block; the block clips the rest.
const COMB_ROWS = honeycombRows(12, 22, 5, "post-cta");

// The last block before the footer on a collection page, and after the download section
// on the landing page. A reader who reaches the end of an article has nowhere left to go,
// so this is the one clear way on to the app.
// It borrows the landing page's type scale and its reveal rather than inventing a
// second treatment, so the page ends in the voice the site opened in. A comb of agents
// fills the block, and a blur behind the text keeps it easy to read.
export function ContentCallToAction() {
  let section: HTMLElement | undefined;
  // No inset margin: the default holds a block back until it has climbed 40% of the
  // viewport, which reads as late here because the footer sits directly below and the
  // reader is on their way to it. Without the inset the block is already in place by
  // the time it is looked at.
  const revealed = createLandingReveal(() => section, { rootMargin: "0px" });

  return (
    <section
      ref={section}
      class="post-cta"
      aria-labelledby="post-cta-title"
      data-revealed={revealed() ? "true" : "false"}
    >
      <div class="post-cta-comb" aria-hidden="true">
        <AgentHoneycomb rows={COMB_ROWS} />
      </div>
      <div class="post-cta-veil" aria-hidden="true" />
      <div class="post-container post-cta-copy">
        <h2 class="post-cta-title" id="post-cta-title">
          Meet your first teammate
        </h2>
        <p class="post-cta-description">
          Run Codex, Claude, Gemini, Grok or your own model with the plans you already pay for, each with its own
          workspace and context. Your work stays on your computer.
        </p>
        <div class="post-cta-actions">
          <ButtonLink to="/download" variant="primary" size="lg" icon="download">
            Download OpenBot
          </ButtonLink>
          <ButtonLink to="/contact" variant="secondary" size="lg" icon="contact" class="landing-button-glass">
            Contact
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
