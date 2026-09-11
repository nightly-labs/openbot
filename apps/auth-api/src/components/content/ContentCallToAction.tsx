import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { createLandingReveal } from "../landing/createLandingReveal";
import { Button, ButtonLink } from "../ui/button";

// The last block before the footer on a collection page. A reader who reaches the end of
// an article has nowhere left to go, so this is the one clear way on to the app.
// It borrows the landing page's type scale and its reveal rather than inventing a
// second treatment, so the page ends in the voice the site opened in.
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
      class="post-container post-cta"
      aria-labelledby="post-cta-title"
      data-revealed={revealed() ? "true" : "false"}
    >
      <h2 class="post-cta-title" id="post-cta-title">
        Meet your first teammate
      </h2>
      <p class="post-cta-description">
        Run Codex, Claude, and Grok side by side, each with its own workspace and context. Your work stays on your
        computer.
      </p>
      <div class="post-cta-actions">
        <ButtonLink to="/" hash="download" variant="primary" size="lg" icon="download">
          Download OpenBot
        </ButtonLink>
        <Button
          href={OPENBOT_LINKS.contact}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          variant="secondary"
          size="lg"
          icon="contact"
          class="landing-button-glass"
        >
          Contact
        </Button>
      </div>
    </section>
  );
}
