import { AppLogo } from "@openbot/brand";
import type { MarketplaceAgentSummary } from "@openbot/contracts/ipc";
import { ShieldCheck } from "@openbot/ui/icons";
import type { JSX } from "@solidjs/web";
import { createSignal, Loading, lazy, onSettled, Show } from "solid-js";
import { isVerifiedAgent } from "./marketplace-prototype-fixtures";

const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

/*
 * Prototype of the image a shared `openbot.run/marketplace/agents/<id>` link shows: 1200 × 630, the
 * shape X, iMessage and Slack crop to. The background is flat, so the avatar's own colour is the only
 * colour on the card. The shield after the name marks a verified agent; the line under the role names
 * the creator, as the rows and pages do. The apps print the page title and the host beside the image,
 * so the card carries no description and no button: at the size a chat shows it, that text cannot be
 * read.
 *
 * The card is drawn in the DOM here and scales with its frame. A real card is a PNG that the Worker
 * serves; how it is drawn is a later step.
 */

export const SHARE_HOST = "openbot.run";

export function shareTitle(agent: MarketplaceAgentSummary): string {
  return `${agent.name} — OpenBot agent`;
}

export function ShareCard(props: { agent: MarketplaceAgentSummary }): JSX.Element {
  return (
    <div class="marketplace-share-card" aria-hidden="true">
      <CardAvatar agent={props.agent} />
      <span class="marketplace-share-brand">
        <AppLogo variant="production" class="marketplace-share-logo" />
        OpenBot
      </span>
      <span class="marketplace-share-copy">
        <span class="marketplace-share-name">
          {props.agent.name}
          <Show when={isVerifiedAgent(props.agent)}>
            <ShieldCheck class="marketplace-share-shield" />
          </Show>
        </span>
        <span class="marketplace-share-role">{props.agent.title}</span>
        <span class="marketplace-share-source">by {props.agent.creatorName}</span>
      </span>
    </div>
  );
}

/** The browser draws the avatar after hydration, as on the agent page. */
function CardAvatar(props: { agent: MarketplaceAgentSummary }): JSX.Element {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });
  return (
    <span class="marketplace-share-avatar">
      <Show when={mounted()}>
        <Loading>
          <AgentAvatar
            seed={props.agent.avatarSeed}
            hue={props.agent.avatarHue}
            url={props.agent.avatarUrl}
            motion="hover"
            class="marketplace-site-avatar-art"
          />
        </Loading>
      </Show>
    </span>
  );
}

/* The frames: close copies of how each app shows a link with a large image, not screenshots of them. */

export function XFrame(props: { agent: MarketplaceAgentSummary }): JSX.Element {
  return (
    <figure class="marketplace-share-x">
      <div class="marketplace-share-x-media">
        <ShareCard agent={props.agent} />
        <span class="marketplace-share-x-title">{shareTitle(props.agent)}</span>
      </div>
      <figcaption class="marketplace-share-x-source">From {SHARE_HOST}</figcaption>
    </figure>
  );
}

export function MessagesFrame(props: { agent: MarketplaceAgentSummary }): JSX.Element {
  return (
    <figure class="marketplace-share-messages">
      <ShareCard agent={props.agent} />
      <figcaption class="marketplace-share-messages-text">
        <span class="marketplace-share-messages-title">{shareTitle(props.agent)}</span>
        <span class="marketplace-share-messages-host">{SHARE_HOST}</span>
      </figcaption>
    </figure>
  );
}

export function SlackFrame(props: { agent: MarketplaceAgentSummary }): JSX.Element {
  return (
    <figure class="marketplace-share-slack">
      <span class="marketplace-share-slack-site">OpenBot</span>
      <span class="marketplace-share-slack-title">{shareTitle(props.agent)}</span>
      <span class="marketplace-share-slack-description">{props.agent.title}</span>
      <div class="marketplace-share-slack-media">
        <ShareCard agent={props.agent} />
      </div>
    </figure>
  );
}
