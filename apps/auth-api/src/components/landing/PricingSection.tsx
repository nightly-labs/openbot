import { For } from "solid-js";
import { ButtonLink } from "../ui/button";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

const FACTS = ["Every feature", "Runs on your own computer", "Uses the AI plans you already pay for"];

export function PricingSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  const revealState = () => (revealed() ? "true" : "false");

  return (
    <section ref={sectionRef} class="landing-pricing" aria-labelledby="pricing-title">
      <div class="landing-pricing-inner">
        <h2 id="pricing-title" class="landing-pricing-eyebrow" data-revealed={revealState()}>
          Free for personal use
        </h2>
        <p class="landing-pricing-amount" data-amount="$0" data-revealed={revealState()}>
          $0
        </p>
        <ul class="landing-pricing-facts" data-revealed={revealState()}>
          <For each={FACTS}>
            {(fact) => (
              <li>
                <LandingIcon name="check" class="landing-pricing-fact-icon" />
                {fact}
              </li>
            )}
          </For>
        </ul>
        <div class="landing-pricing-actions" data-revealed={revealState()}>
          <ButtonLink to="/download" variant="primary" size="md" icon="download">
            Download
          </ButtonLink>
          <ButtonLink to="/pricing" variant="secondary" size="md" icon="arrow-right">
            License for work
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
