import { Link } from "@tanstack/solid-router";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

export function PricingSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  const revealState = () => (revealed() ? "true" : "false");

  return (
    <section ref={sectionRef} class="landing-pricing" aria-labelledby="pricing-title">
      <div class="landing-pricing-inner">
        <h2 id="pricing-title" class="landing-pricing-eyebrow" data-revealed={revealState()}>
          What it costs
        </h2>
        <p class="landing-pricing-amount" data-amount="$0" data-revealed={revealState()}>
          $0
        </p>
        <p class="landing-pricing-note" data-revealed={revealState()}>
          OpenBot is free. No hidden fees. No locked features. Your agents use the AI plans you already pay for.
        </p>
        <p class="landing-pricing-compare" data-revealed={revealState()}>
          <Link to="/compare/$slug" params={{ slug: "grok-bot" }}>
            See how OpenBot compares with Grok Bot
            <LandingIcon name="arrow-right" class="landing-pricing-compare-arrow" />
          </Link>
        </p>
      </div>
    </section>
  );
}
