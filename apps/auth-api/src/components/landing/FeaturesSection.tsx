import { For } from "solid-js";
import { LANDING_FEATURES } from "../../lib/landing-content";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

export function FeaturesSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);

  return (
    <section
      ref={sectionRef}
      class="landing-section landing-features"
      aria-labelledby="features-title"
      data-revealed={revealed() ? "true" : "false"}
    >
      <div class="landing-section-inner">
        <header class="landing-section-heading">
          <h2 id="features-title">What OpenBot does</h2>
          <p>One desktop app for a team of AI agents that work on your computer, with the AI plans you have.</p>
        </header>
        <ul class="landing-features-grid">
          <For each={LANDING_FEATURES}>
            {(feature, index) => (
              <li class="landing-feature" style={{ "--landing-index": index() }}>
                <LandingIcon name={feature.icon} class="landing-feature-icon" />
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}
