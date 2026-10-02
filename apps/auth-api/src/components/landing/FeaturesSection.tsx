import { ProviderLogo } from "@openbot/brand";
import {
  BrowserBackIcon,
  BrowserControlIcon,
  BrowserForwardIcon,
  BrowserReloadIcon,
  CloseIcon,
  EditIcon,
  PlusIcon,
  QueueIcon,
  SteerIcon,
  TrashIcon,
} from "@openbot/ui/features/conversation/ConversationIcons";
import type { JSX } from "@solidjs/web";
import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import {
  LANDING_BROWSER_FIELD,
  LANDING_BROWSER_HEADING,
  LANDING_BROWSER_SUBMIT,
  LANDING_BROWSER_TABS,
  LANDING_BROWSER_TYPED,
  LANDING_BROWSER_URL,
  LANDING_FEATURES,
  LANDING_LOCAL_DATA,
  LANDING_LOCAL_TITLE,
  LANDING_PERSIST_AFTER,
  LANDING_PERSIST_AGENT,
  LANDING_PERSIST_BEFORE,
  LANDING_PERSIST_EARLIER,
  LANDING_PERSIST_REQUEST,
  LANDING_PERSIST_SWITCH,
  LANDING_PROVIDERS,
  LANDING_QUEUE,
  LANDING_QUEUE_DRAFT,
  LANDING_QUEUE_HOLD,
  LANDING_QUEUE_PLACEHOLDER,
  LANDING_QUEUE_STEER,
  LANDING_TEAM,
  LANDING_TEAM_CHANNEL,
  LANDING_TEAM_HANDOFF,
  LANDING_TEAM_MESSAGES,
  LANDING_TEAM_REPLY,
  type LandingFeatureId,
  type LandingPersistReply,
  type LandingTeamMessage,
  type LandingTeammate,
} from "../../lib/landing-content";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";

// Loaded after the page is in the browser, as on the agent template page: the
// avatar engine is too large for the first load of the home page.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

/** The second marquee row runs the other way, so it starts from the other end of the list. */
const PROVIDER_ROWS = [LANDING_PROVIDERS, [...LANDING_PROVIDERS].reverse()];

/** Tiles whose avatars move when the pointer is on the tile. */
const AVATAR_HOVER_FEATURES: ReadonlySet<LandingFeatureId> = new Set(["team", "persist"]);

export function FeaturesSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  // The Worker renders an empty circle of each avatar's size, and the browser fills it in.
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });

  const avatar = (teammate: LandingTeammate, size: "large" | "small") => (
    <Show when={mounted()} fallback={<span class={`landing-team-avatar landing-team-avatar-${size}`} />}>
      <AgentAvatar
        seed={teammate.avatarSeed}
        hue={teammate.avatarHue}
        motion="hover"
        class={`landing-team-avatar landing-team-avatar-${size}`}
      />
    </Show>
  );

  const message = (entry: LandingTeamMessage) => (
    <>
      {avatar(entry.from, "large")}
      <span class="landing-team-copy">
        <span class="landing-team-meta">
          <span class="landing-team-name">{entry.from.name}</span>
          <span class="landing-team-time">{entry.time}</span>
        </span>
        <span class="landing-team-text">{entry.text}</span>
      </span>
    </>
  );

  const persistReply = (reply: LandingPersistReply) => (
    <>
      <span class="landing-persist-meta">
        <ProviderLogo provider={reply.from.provider} class="landing-persist-logo" />
        {reply.from.name}
        <span class="landing-team-time">{reply.time}</span>
      </span>
      <span class="landing-team-text">{reply.text}</span>
    </>
  );

  const visuals: Record<LandingFeatureId, () => JSX.Element> = {
    team: () => (
      <div class="landing-window landing-team-window">
        <div class="landing-window-bar">
          <span class="landing-team-channel">
            <span class="landing-team-hash">#</span>
            {LANDING_TEAM_CHANNEL}
          </span>
          <span class="landing-team-stack">
            <For each={LANDING_TEAM}>{(teammate) => avatar(teammate, "small")}</For>
          </span>
        </div>
        <ul class="landing-team">
          <For each={LANDING_TEAM_MESSAGES}>
            {(entry, index) => (
              <>
                <li class="landing-team-message">{message(entry)}</li>
                <Show when={index() === 0}>
                  <li class="landing-team-system">{LANDING_TEAM_HANDOFF}</li>
                </Show>
              </>
            )}
          </For>
          <li class="landing-team-next">
            <span class="landing-team-typing">
              <span />
              <span />
              <span />
            </span>
            <span class="landing-team-message landing-team-reply">{message(LANDING_TEAM_REPLY)}</span>
          </li>
        </ul>
      </div>
    ),
    providers: () => (
      <div class="landing-marquee">
        <For each={PROVIDER_ROWS}>
          {(row) => (
            <div class="landing-marquee-row">
              <ul class="landing-marquee-track">
                <For each={[...row, ...row]}>
                  {(entry) => (
                    <li class="landing-provider-pill" data-provider={entry.provider}>
                      <ProviderLogo provider={entry.provider} class="landing-provider-pill-logo" />
                      {entry.name}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </div>
    ),
    local: () => (
      <div class="landing-window landing-local-window">
        <div class="landing-window-bar">
          <span class="landing-local-title">{LANDING_LOCAL_TITLE}</span>
          <svg class="landing-lock" viewBox="0 0 24 24" aria-hidden="true">
            <path class="landing-lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
            <rect x="3" y="11" width="18" height="11" rx="2" />
          </svg>
        </div>
        <ul class="landing-local-files">
          <For each={LANDING_LOCAL_DATA}>
            {(item) => (
              <li>
                <LandingIcon name="folder" class="landing-local-folder" />
                {item}
              </li>
            )}
          </For>
        </ul>
      </div>
    ),
    persist: () => (
      <div class="landing-window landing-persist-window">
        <div class="landing-window-bar">
          {avatar(LANDING_PERSIST_AGENT, "small")}
          <span class="landing-team-name">{LANDING_PERSIST_AGENT.name}</span>
          <span class="landing-persist-select">
            <span class="landing-persist-swap">
              <For each={[LANDING_PERSIST_BEFORE, LANDING_PERSIST_AFTER]}>
                {(reply) => (
                  <span class="landing-persist-provider">
                    <ProviderLogo provider={reply.from.provider} class="landing-persist-logo" />
                    {reply.from.name}
                  </span>
                )}
              </For>
            </span>
            <LandingIcon name="chevron-down" class="landing-persist-chevron" />
          </span>
        </div>
        <ul class="landing-persist-thread">
          <li class="landing-persist-reply">{persistReply(LANDING_PERSIST_EARLIER)}</li>
          <li class="landing-persist-request">{LANDING_PERSIST_REQUEST}</li>
          <li class="landing-persist-reply">{persistReply(LANDING_PERSIST_BEFORE)}</li>
          <li class="landing-persist-later">
            <ul>
              <li class="landing-team-system">{LANDING_PERSIST_SWITCH}</li>
              <li class="landing-persist-reply">{persistReply(LANDING_PERSIST_AFTER)}</li>
            </ul>
          </li>
        </ul>
      </div>
    ),
    browser: () => (
      <div class="landing-window landing-browser">
        <div class="landing-browser-tabs">
          <For each={LANDING_BROWSER_TABS}>
            {(title, index) => (
              <span class="landing-browser-tab" data-controlled={index() === 0 ? "" : undefined}>
                <Show when={index() === 0}>
                  <span class="landing-browser-control">
                    <BrowserControlIcon />
                  </span>
                </Show>
                <span class="landing-browser-tab-title">{title}</span>
                <CloseIcon />
              </span>
            )}
          </For>
          <span class="landing-browser-new">
            <PlusIcon />
          </span>
        </div>
        <div class="landing-browser-toolbar">
          <BrowserBackIcon />
          <BrowserForwardIcon />
          <BrowserReloadIcon />
          <span class="landing-browser-address">{LANDING_BROWSER_URL}</span>
        </div>
        <div class="landing-browser-page">
          <span class="landing-browser-heading">{LANDING_BROWSER_HEADING}</span>
          <span class="landing-browser-label">{LANDING_BROWSER_FIELD}</span>
          <span class="landing-browser-input">
            <span class="landing-browser-typed">{LANDING_BROWSER_TYPED}</span>
            <span class="landing-browser-caret" />
          </span>
          <span class="landing-browser-submit">{LANDING_BROWSER_SUBMIT}</span>
        </div>
      </div>
    ),
    queue: () => (
      <div class="landing-queue">
        <div class="landing-queue-panel">
          <span class="landing-queue-hold">{LANDING_QUEUE_HOLD}</span>
          <ul class="landing-queue-list">
            <For each={LANDING_QUEUE}>
              {(item) => (
                <li class="landing-queue-row">
                  <QueueIcon />
                  <span class="landing-queue-text">{item}</span>
                  <span class="landing-queue-actions">
                    <span class="landing-queue-steer">
                      <SteerIcon />
                      {LANDING_QUEUE_STEER}
                    </span>
                    <EditIcon />
                    <TrashIcon />
                  </span>
                </li>
              )}
            </For>
            <li class="landing-queue-added">
              <span class="landing-queue-row">
                <QueueIcon />
                <span class="landing-queue-text">{LANDING_QUEUE_DRAFT}</span>
              </span>
            </li>
          </ul>
        </div>
        <div class="landing-queue-composer">
          <span class="landing-queue-input">
            <span class="landing-queue-draft">{LANDING_QUEUE_DRAFT}</span>
            <span class="landing-queue-placeholder">{LANDING_QUEUE_PLACEHOLDER}</span>
          </span>
          <span class="landing-queue-send">
            <LandingIcon name="arrow-right" class="landing-queue-send-icon" />
          </span>
        </div>
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
      {/* The Gemini mark is a gradient, and CSS can fill a path with one only from an SVG paint server. */}
      <svg class="landing-paint-servers" aria-hidden="true">
        <linearGradient id="landing-gemini-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#439ddf" />
          <stop offset="0.52" stop-color="#4f87ed" />
          <stop offset="0.78" stop-color="#9476c5" />
          <stop offset="0.89" stop-color="#bc688e" />
          <stop offset="1" stop-color="#d6645d" />
        </linearGradient>
      </svg>
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
                data-avatar-hover={AVATAR_HOVER_FEATURES.has(feature.id) ? "" : undefined}
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
