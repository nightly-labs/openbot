import { ProviderLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import {
  LANDING_FEATURES,
  LANDING_KEPT_STATE,
  LANDING_LOCAL_DATA,
  LANDING_PROVIDERS,
  LANDING_TEAM,
  type LandingFeatureId,
} from "../../lib/landing-content";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

// Loaded after the page is in the browser, as on the agent template page: the
// avatar engine is too large for the first load of the home page.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

export function FeaturesSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  // The Worker renders an empty circle of each avatar's size, and the browser fills it in.
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });

  const visuals: Record<LandingFeatureId, () => JSX.Element> = {
    team: () => (
      <ul class="landing-team">
        <For each={LANDING_TEAM}>
          {(teammate) => (
            <li class="landing-team-message">
              <Show when={mounted()} fallback={<span class="landing-team-avatar" />}>
                <AgentAvatar
                  seed={teammate.avatarSeed}
                  hue={teammate.avatarHue}
                  motion="hover"
                  class="landing-team-avatar"
                />
              </Show>
              <span class="landing-team-copy">
                <span class="landing-team-name">{teammate.name}</span>
                <span class="landing-team-bubble">{teammate.message}</span>
              </span>
            </li>
          )}
        </For>
      </ul>
    ),
    providers: () => (
      <ul class="landing-provider-grid">
        <For each={LANDING_PROVIDERS}>
          {(entry) => (
            <li title={entry.name}>
              <ProviderLogo provider={entry.provider} class="landing-provider-grid-logo" />
            </li>
          )}
        </For>
        <li class="landing-provider-grid-more">+3</li>
      </ul>
    ),
    persist: () => (
      <div class="landing-persist">
        <div class="landing-persist-switch">
          <span class="landing-persist-provider">
            <ProviderLogo provider="codex" class="landing-persist-logo" />
            Codex
          </span>
          <LandingIcon name="arrow-right" class="landing-persist-arrow" />
          <span class="landing-persist-provider">
            <ProviderLogo provider="claude" class="landing-persist-logo" />
            Claude
          </span>
        </div>
        <ul class="landing-check-list">
          <For each={LANDING_KEPT_STATE}>
            {(item) => (
              <li>
                <LandingIcon name="check" class="landing-check-icon" />
                {item}
              </li>
            )}
          </For>
        </ul>
      </div>
    ),
    local: () => (
      <div class="landing-local">
        <span class="landing-local-device">
          <LandingIcon name="laptop" class="landing-local-laptop" />
          <span class="landing-local-lock">
            <LandingIcon name="lock" class="landing-local-lock-icon" />
          </span>
        </span>
        <ul class="landing-local-chips">
          <For each={LANDING_LOCAL_DATA}>{(item) => <li>{item}</li>}</For>
        </ul>
      </div>
    ),
  };

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
              <li
                class="landing-feature"
                data-feature={feature.id}
                data-avatar-hover={feature.id === "team" ? "" : undefined}
                style={{ "--landing-index": index() }}
              >
                <div class="landing-feature-visual" aria-hidden="true">
                  {visuals[feature.id]()}
                </div>
                <div class="landing-feature-copy">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}
