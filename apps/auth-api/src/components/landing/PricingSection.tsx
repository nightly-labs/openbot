import { createLandingReveal } from "./createLandingReveal";

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
          OpenBot is free. No hidden fees. No locked features.
        </p>
      </div>
    </section>
  );
}
