import { ProviderLogo } from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import {
  ADA,
  LANDING_FEATURE_IDS,
  LANDING_MULTIPLAYER_AGENTS,
  LANDING_MULTIPLAYER_INVITED,
  LANDING_MULTIPLAYER_PEOPLE,
  LANDING_MULTIPLAYER_SENDERS,
  LANDING_PERSIST_SENDERS,
  LANDING_PROVIDERS,
  LANDING_TEAM,
  LANDING_TEAM_REPLY_SENDER,
  LANDING_TEAM_SENDERS,
  LANDING_WORKFLOW_AGENTS,
  type LandingFeatureId,
  type LandingMultiplayerSender,
  type LandingPersistSender,
  type LandingPerson,
  type LandingTeammate,
  type LandingTeamSender,
  type LandingWorkflowStepId,
} from "../../lib/landing-content";
import type { FeatureDescriptionPart } from "../../lib/landing-page-text";
import { LANDING_WORKFLOW_EDGE_MS, LANDING_WORKFLOW_PATHS, workflowTiming } from "../../lib/landing-workflow";
import { createLandingReveal } from "./createLandingReveal";
import { LandingFace } from "./LandingFace";
import { LandingIcon } from "./LandingIcon";
import { useLandingText } from "./LandingText";

// Loaded after the page is in the browser, as on the agent template page: the
// avatar engine is too large for the first load of the home page.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

/** The second marquee row runs the other way, so it starts from the other end of the list. */
const PROVIDER_ROWS = [LANDING_PROVIDERS, [...LANDING_PROVIDERS].reverse()];

/**
 * The second marquee row and the second copy in each track (the copy closes the loop) are hidden
 * from screen readers, so they read each provider once.
 */
function hiddenFromReaders(hidden: boolean) {
  return hidden ? "true" : undefined;
}

/** Tiles whose avatars move when the pointer is on the tile. */
const AVATAR_HOVER_FEATURES: ReadonlySet<LandingFeatureId> = new Set(["team", "multiplayer", "workflows", "persist"]);

export function FeaturesSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  const landing = useLandingText();
  const text = () => landing().features;
  const picture = () => landing().picture;
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

  /** A person has a drawn face, so people and agents are easy to tell apart. */
  const personAvatar = (person: LandingPerson, size: "large" | "small") => (
    <LandingFace person={person} class={`landing-team-avatar landing-team-avatar-${size}`} />
  );

  const messageRow = (face: JSX.Element, name: string, time: string, words: string) => (
    <>
      {face}
      <span class="landing-team-copy">
        <span class="landing-team-meta">
          <span class="landing-team-name">{name}</span>
          <span class="landing-team-time">{time}</span>
        </span>
        <span class="landing-team-text">{words}</span>
      </span>
    </>
  );

  const message = (entry: LandingTeamSender, words: string) =>
    messageRow(avatar(entry.from, "large"), entry.from.name, entry.time, words);

  const multiplayerMessage = (entry: LandingMultiplayerSender, words: string) =>
    messageRow(
      entry.kind === "person" ? personAvatar(entry.from, "large") : avatar(entry.from, "large"),
      entry.from.name,
      entry.time,
      words,
    );

  /** Where a step of the workflow picture is, and when it runs on hover. */
  const workflowStep = (id: LandingWorkflowStepId, column: number) => {
    const timing = workflowTiming(id);
    return {
      "--landing-workflow-column": column + 1,
      "--landing-workflow-start": `${timing.startMs}ms`,
      "--landing-workflow-run": `${timing.runMs}ms`,
    };
  };

  /** A ring that turns while the step runs, and a check when it is done. */
  const workflowStatus = () => (
    <span class="landing-workflow-status">
      <span class="landing-workflow-spinner" />
      <LandingIcon name="check" class="landing-workflow-done" />
    </span>
  );

  const workflowEdges = (layout: "wide" | "tall") => (
    <svg
      class={`landing-workflow-edges landing-workflow-edges-${layout}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <For each={LANDING_WORKFLOW_PATHS}>
        {(edge) => (
          <g style={{ "--landing-workflow-start": `${edge.startMs}ms` }}>
            <path class="landing-workflow-edge" d={edge[layout]} />
            <path class="landing-workflow-edge-run" d={edge[layout]} />
          </g>
        )}
      </For>
    </svg>
  );

  const persistReply = (reply: LandingPersistSender, words: string) => (
    <>
      <span class="landing-persist-meta">
        <ProviderLogo provider={reply.from.provider} class="landing-persist-logo" />
        {reply.from.name}
        <span class="landing-team-time">{reply.time}</span>
      </span>
      <span class="landing-team-text">{words}</span>
    </>
  );

  const visuals: Record<LandingFeatureId, () => JSX.Element> = {
    team: () => (
      <div class="landing-window landing-team-window">
        <div class="landing-window-bar">
          <span class="landing-team-channel">
            <span class="landing-team-hash">#</span>
            {picture().channel}
          </span>
          <span class="landing-team-stack">
            <For each={LANDING_TEAM}>{(teammate) => avatar(teammate, "small")}</For>
          </span>
        </div>
        <ul class="landing-team">
          <For each={LANDING_TEAM_SENDERS}>
            {(entry, index) => (
              <>
                <li class="landing-team-message">{message(entry, picture().team.messages[index()] ?? "")}</li>
                <Show when={index() === 0}>
                  <li class="landing-team-system">{picture().team.handoff}</li>
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
            <span class="landing-team-message landing-team-reply">
              {message(LANDING_TEAM_REPLY_SENDER, picture().team.reply)}
            </span>
          </li>
        </ul>
      </div>
    ),
    providers: () => (
      <div class="landing-marquee">
        <For each={PROVIDER_ROWS}>
          {(row, rowIndex) => (
            <div class="landing-marquee-row" aria-hidden={hiddenFromReaders(rowIndex() > 0)}>
              <ul class="landing-marquee-track">
                <For each={[...row, ...row]}>
                  {(entry, index) => (
                    <li
                      class="landing-provider-pill"
                      data-provider={entry.provider}
                      aria-hidden={hiddenFromReaders(index() >= row.length)}
                    >
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
          <span class="landing-local-title">{picture().local.title}</span>
          <svg class="landing-lock" viewBox="0 0 24 24" aria-hidden="true">
            <path class="landing-lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
            <rect x="3" y="11" width="18" height="11" rx="2" />
          </svg>
        </div>
        <ul class="landing-local-files">
          <For each={picture().local.items}>
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
    multiplayer: () => (
      <div class="landing-window landing-team-window landing-multiplayer-window">
        <div class="landing-window-bar">
          <span class="landing-team-channel">
            <span class="landing-team-hash">#</span>
            {picture().channel}
          </span>
          <span class="landing-team-stack">
            <For each={LANDING_MULTIPLAYER_PEOPLE}>{(person) => personAvatar(person, "small")}</For>
            <span class="landing-multiplayer-joined">{personAvatar(LANDING_MULTIPLAYER_INVITED, "small")}</span>
            <For each={LANDING_MULTIPLAYER_AGENTS}>{(teammate) => avatar(teammate, "small")}</For>
          </span>
          <span class="landing-multiplayer-invite">
            <LandingIcon name="user-plus" class="landing-multiplayer-invite-icon" />
            {picture().multiplayer.invite}
          </span>
        </div>
        <ul class="landing-team">
          <For each={LANDING_MULTIPLAYER_SENDERS}>
            {(entry, index) => (
              <li class="landing-team-message">
                {multiplayerMessage(entry, picture().multiplayer.messages[index()] ?? "")}
              </li>
            )}
          </For>
        </ul>
      </div>
    ),
    workflows: () => (
      <div class="landing-workflow" style={{ "--landing-workflow-edge": `${LANDING_WORKFLOW_EDGE_MS}ms` }}>
        {workflowEdges("wide")}
        {workflowEdges("tall")}
        <ol class="landing-workflow-steps">
          <li class="landing-workflow-node" data-step="trigger" style={workflowStep("trigger", 0)}>
            <span class="landing-workflow-card">
              <span class="landing-workflow-head">
                <span class="landing-workflow-badge">
                  <LandingIcon name="zap" class="landing-workflow-icon" />
                </span>
                <span class="landing-workflow-title">{picture().workflows.trigger}</span>
                {workflowStatus()}
              </span>
              <span class="landing-workflow-text">{picture().workflows.schedule}</span>
            </span>
          </li>
          <For each={LANDING_WORKFLOW_AGENTS}>
            {(step) => (
              <li class="landing-workflow-node" data-lane={step.lane} style={workflowStep(step.id, step.column)}>
                <span class="landing-workflow-card">
                  <span class="landing-workflow-head">
                    {avatar(step.teammate, "small")}
                    <span class="landing-workflow-title">{step.teammate.name}</span>
                    <ProviderLogo provider={step.provider} class="landing-workflow-provider" />
                    {workflowStatus()}
                  </span>
                  <span class="landing-workflow-text">{picture().workflows[step.id]}</span>
                </span>
              </li>
            )}
          </For>
          <li class="landing-workflow-node" data-step="approval" style={workflowStep("approval", 3)}>
            <span class="landing-workflow-card">
              <span class="landing-workflow-head">
                <span class="landing-workflow-badge">
                  <LandingIcon name="user-check" class="landing-workflow-icon" />
                </span>
                <span class="landing-workflow-title">{picture().workflows.approval}</span>
                {workflowStatus()}
              </span>
              <span class="landing-workflow-text">{picture().workflows.question}</span>
              <span class="landing-workflow-decision">
                <span class="landing-workflow-approve">{picture().workflows.approve}</span>
                <span class="landing-workflow-approved">
                  <LandingIcon name="check" class="landing-workflow-icon" />
                  {picture().workflows.approved}
                </span>
              </span>
            </span>
          </li>
        </ol>
      </div>
    ),
    persist: () => (
      <div class="landing-window landing-persist-window">
        <div class="landing-window-bar">
          {avatar(ADA, "small")}
          <span class="landing-team-name">{ADA.name}</span>
          <span class="landing-persist-select">
            <span class="landing-persist-swap">
              <For each={[LANDING_PERSIST_SENDERS.before, LANDING_PERSIST_SENDERS.after]}>
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
          <li class="landing-persist-reply">
            {persistReply(LANDING_PERSIST_SENDERS.earlier, picture().persist.earlier)}
          </li>
          <li class="landing-persist-request">{picture().persist.request}</li>
          <li class="landing-persist-reply">
            {persistReply(LANDING_PERSIST_SENDERS.before, picture().persist.before)}
          </li>
          <li class="landing-persist-later">
            <ul>
              <li class="landing-team-system">{picture().persist.switch}</li>
              <li class="landing-persist-reply">
                {persistReply(LANDING_PERSIST_SENDERS.after, picture().persist.after)}
              </li>
            </ul>
          </li>
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
          <h2 id="features-title">{text().title}</h2>
          <p>{text().description}</p>
        </header>
        <ul class="landing-features-grid">
          <For each={LANDING_FEATURE_IDS}>
            {(feature, index) => (
              <li
                class="landing-feature"
                data-feature={feature}
                data-avatar-hover={AVATAR_HOVER_FEATURES.has(feature) ? "" : undefined}
                style={{ "--landing-index": index() }}
              >
                <div class="landing-feature-visual" aria-hidden="true">
                  {visuals[feature]()}
                </div>
                <div class="landing-feature-copy">
                  <h3>{text().items[feature].title}</h3>
                  <p>
                    <FeatureDescription parts={text().items[feature].description} />
                  </p>
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}

/** A tile's sentence. A part with a slug links to its provider page. */
function FeatureDescription(props: { parts: readonly FeatureDescriptionPart[] }) {
  return (
    <For each={props.parts}>
      {(part) =>
        typeof part === "string" ? (
          part
        ) : (
          <Link class="landing-feature-link" to="/providers/$slug" params={{ slug: part.slug }}>
            {part.text}
          </Link>
        )
      }
    </For>
  );
}
