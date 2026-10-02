import { For } from "solid-js";
import { LANDING_STEPS } from "../../lib/landing-content";
import { createLandingReveal } from "./createLandingReveal";

export function StepsSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);

  return (
    <section
      ref={sectionRef}
      class="landing-section landing-steps"
      aria-labelledby="steps-title"
      data-revealed={revealed() ? "true" : "false"}
    >
      <div class="landing-section-inner">
        <header class="landing-section-heading">
          <h2 id="steps-title">How it works</h2>
          <p>From download to a working agent in a few minutes.</p>
        </header>
        <ol class="landing-steps-list">
          <For each={LANDING_STEPS}>
            {(step, index) => (
              <li class="landing-step" style={{ "--landing-index": index() }}>
                <span class="landing-step-number" aria-hidden="true">
                  {index() + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            )}
          </For>
        </ol>
      </div>
    </section>
  );
}
