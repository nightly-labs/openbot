import { createSignal, For, onSettled } from "solid-js";
import { LANDING_TEAMS_OFFER_IDS, type LandingTeamsOfferId } from "../../lib/landing-content";
import { TEAMS_ROUTE } from "../../lib/teams-page";
import { ButtonLink } from "../ui/button";
import { LandingIcon, type LandingIconName } from "./LandingIcon";
import { useLandingText } from "./LandingText";
import { useSitePath } from "./SiteText";

const OFFER_ICONS: Record<LandingTeamsOfferId, LandingIconName> = {
  servers: "cloud",
  environments: "users",
  integrations: "puzzle",
  support: "heart",
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The heading and the button stay on the left; one colour card for each offer stacks as the page scrolls. */
export function TeamsSection() {
  // The card on top of the stack. The list on the left marks it.
  const [active, setActive] = createSignal(0);
  const landing = useLandingText();
  const path = useSitePath();
  const text = () => landing().teams;
  let stack: HTMLOListElement | undefined;

  onSettled(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!stack) return;
      const cards = Array.from(stack.querySelectorAll<HTMLElement>(":scope > li"));
      const style = getComputedStyle(stack);
      // The distance between two stuck cards, so the label row of each card stays visible.
      const step = Number.parseFloat(style.getPropertyValue("--landing-teams-step"));
      const gap = Number.parseFloat(style.rowGap);
      let top = 0;
      cards.forEach((card, index) => {
        const next = cards[index + 1];
        const box = card.getBoundingClientRect();
        // 0 while the next card is in its place in the list; 1 when it is stuck on top of this one.
        const distance = next ? next.getBoundingClientRect().top - box.top : 0;
        const covered = next ? Math.min(1, Math.max(0, 1 - (distance - step) / (box.height + gap - step))) : 0;
        card.style.setProperty("--landing-teams-covered", covered.toFixed(3));
        if (covered > 0.5) top = index + 1;
      });
      setActive(top);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  });

  return (
    <section id="teams" class="landing-section landing-teams" aria-labelledby="teams-title">
      <div class="landing-section-inner landing-teams-layout">
        <header class="landing-section-heading landing-teams-aside">
          <h2 id="teams-title" class="landing-teams-title">
            {text().title}
          </h2>
          <p class="landing-teams-statement">{text().statement}</p>
          <p class="landing-teams-description">{text().description}</p>
          <div class="landing-teams-actions">
            <ButtonLink to={path("/contact")} variant="primary" size="lg" icon="contact">
              {text().contact}
            </ButtonLink>
            <ButtonLink to={path(TEAMS_ROUTE)} variant="secondary" size="lg" icon="arrow-right">
              {text().learn}
            </ButtonLink>
          </div>
          <ol class="landing-teams-progress" aria-hidden="true">
            <For each={LANDING_TEAMS_OFFER_IDS}>
              {(offer, index) => (
                <li
                  class="landing-teams-progress-item"
                  data-offer={offer}
                  data-active={active() === index() ? "" : undefined}
                >
                  <span class="landing-teams-progress-number">{pad(index() + 1)}</span>
                  {text().offers[offer].label}
                </li>
              )}
            </For>
          </ol>
        </header>
        <ol ref={stack} class="landing-teams-stack">
          <For each={LANDING_TEAMS_OFFER_IDS}>
            {(offer, index) => (
              <li class="landing-teams-card" data-offer={offer} style={{ "--landing-teams-card": index() }}>
                <span class="landing-teams-card-top">
                  <span class="landing-download-status">{text().offers[offer].label}</span>
                  <span class="landing-teams-card-number" aria-hidden="true">
                    {pad(index() + 1)} / {pad(LANDING_TEAMS_OFFER_IDS.length)}
                  </span>
                </span>
                <LandingIcon name={OFFER_ICONS[offer]} class="landing-teams-card-icon" />
                <div class="landing-teams-card-copy">
                  <h3 class="landing-teams-card-title">{text().offers[offer].title}</h3>
                  <p class="landing-teams-card-description">{text().offers[offer].description}</p>
                </div>
              </li>
            )}
          </For>
        </ol>
      </div>
    </section>
  );
}
