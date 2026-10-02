import { PlatformLogo, ProviderLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import {
  LANDING_EXAMPLE_PROMPT,
  LANDING_PROVIDERS,
  LANDING_STEPS,
  type LandingStepId,
} from "../../lib/landing-content";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

/** How many provider logos the second step stacks. */
const STEP_PROVIDER_COUNT = 4;

const STEP_VISUALS: Record<LandingStepId, () => JSX.Element> = {
  download: () => (
    <span class="landing-step-platforms">
      <PlatformLogo platform="macos" class="landing-step-platform" />
      <PlatformLogo platform="windows" class="landing-step-platform" />
      <PlatformLogo platform="linux" class="landing-step-platform" />
    </span>
  ),
  connect: () => (
    <span class="landing-step-providers">
      <For each={LANDING_PROVIDERS.slice(0, STEP_PROVIDER_COUNT)}>
        {(entry) => (
          <span class="landing-step-provider">
            <ProviderLogo provider={entry.provider} class="landing-step-provider-logo" />
          </span>
        )}
      </For>
      <span class="landing-step-provider landing-step-provider-more">
        +{LANDING_PROVIDERS.length - STEP_PROVIDER_COUNT}
      </span>
    </span>
  ),
  create: () => (
    <span class="landing-step-prompt">
      <span class="landing-step-prompt-text">{LANDING_EXAMPLE_PROMPT}</span>
      <span class="landing-step-prompt-send">
        <LandingIcon name="arrow-right" class="landing-step-prompt-icon" />
      </span>
    </span>
  ),
};

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
                  {String(index() + 1).padStart(2, "0")}
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <div class="landing-step-visual" aria-hidden="true">
                  {STEP_VISUALS[step.id]()}
                </div>
              </li>
            )}
          </For>
        </ol>
      </div>
    </section>
  );
}
