import { AgentHoneycomb, honeycombRows } from "../landing/AgentHoneycomb";
import { createLandingReveal } from "../landing/createLandingReveal";
import { useSiteChrome, useSitePath } from "../landing/SiteText";
import { ButtonLink } from "../ui/button";

const COMB_ROWS = honeycombRows(12, 22, 5, "post-cta");

export function ContentCallToAction() {
  let section: HTMLElement | undefined;
  let veil: HTMLDivElement | undefined;
  const chrome = useSiteChrome();
  const path = useSitePath();
  const text = () => chrome().text.cta;
  const revealed = createLandingReveal(() => section, { rootMargin: "0px" });

  return (
    <section
      ref={section}
      class="post-cta"
      aria-labelledby="post-cta-title"
      lang={chrome().lang}
      data-revealed={revealed() ? "true" : "false"}
    >
      <div class="post-cta-comb" aria-hidden="true">
        <AgentHoneycomb rows={COMB_ROWS} stillUnder={() => veil} />
      </div>
      <div ref={veil} class="post-cta-veil" aria-hidden="true" />
      <div class="post-container post-cta-copy">
        <h2 class="post-cta-title" id="post-cta-title">
          {text().title}
        </h2>
        <p class="post-cta-description">{text().description}</p>
        <div class="post-cta-actions">
          <ButtonLink to="/download" variant="primary" size="lg" icon="download">
            {text().download}
          </ButtonLink>
          <ButtonLink to={path("/contact")} variant="secondary" size="lg" icon="contact" class="landing-button-glass">
            {text().contact}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
