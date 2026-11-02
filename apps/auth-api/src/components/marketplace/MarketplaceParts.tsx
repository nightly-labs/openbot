import type { MarketplaceAgentSummary, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { createMarketplaceShareUrl, type MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import type { TranslatedLocale } from "@openbot/i18n";
import { ShieldCheck } from "@openbot/ui/icons";
import { TextProvider, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { createSignal, Loading, lazy, Match, onSettled, Show, Switch } from "solid-js";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";

// Browser-only, as on the shared agent page: the Worker renders an empty box and the browser draws it.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

/** The page around every Marketplace screen: the site header and footer, and the catalog of the page's language. */
export function MarketplaceFrame(props: { lang: string; locale: TranslatedLocale; children: JSX.Element }) {
  return (
    <div class="landing-page plugin-index marketplace-site" lang={props.lang}>
      <SiteHeader page="content" />
      <main class="post-main">
        <TextProvider locale={props.locale}>{props.children}</TextProvider>
      </main>
      <LandingFooter />
    </div>
  );
}

/** The browser draws the avatar after hydration; until then the box keeps its place. It fills its box. */
export function AgentMark(props: { agent: MarketplaceAgentSummary }) {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });
  return (
    <span class="marketplace-site-avatar" aria-hidden="true">
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

/** A skill's own square icon, or the blocks glyph when the catalog has none. */
export function SkillIcon(props: { skill: Pick<MarketplaceSkillSummary, "iconUrl"> }) {
  const glyph = () => <LandingIcon name="blocks" class="marketplace-site-glyph" />;
  return (
    <Show when={props.skill.iconUrl} fallback={glyph()}>
      {(url) => <img class="marketplace-site-skill-icon" src={url()} alt="" loading="lazy" />}
    </Show>
  );
}

/** The shield after a verified name, as in the app. A screen reader reads ", verified by OpenBot" after the name. */
export function VerifiedMark(props: { verified: boolean }) {
  const { t } = useText();
  return (
    <Show when={props.verified}>
      <ShieldCheck class="marketplace-site-verified" aria-hidden="true" />
      <span class="landing-visually-hidden">{t("sitePage.marketplace.verifiedName")}</span>
    </Show>
  );
}

/** A link to one listing's page, with the site's router. */
export function ListingLink(props: { link: MarketplaceListingLink; class: string; children: JSX.Element }) {
  return (
    <Switch>
      <Match when={props.link.kind === "agent"}>
        <Link to="/marketplace/agents/$agentId" params={{ agentId: props.link.id }} class={props.class}>
          {props.children}
        </Link>
      </Match>
      <Match when={props.link.kind === "skill"}>
        <Link to="/marketplace/skills/$slug" params={{ slug: props.link.id }} class={props.class}>
          {props.children}
        </Link>
      </Match>
    </Switch>
  );
}

const COPIED_MS = 1600;

/**
 * The listing's `openbot.run` address. A developer's Worker on this computer gives its own loopback
 * address; any other origin, such as a preview deployment, gives the public one.
 */
function shareUrl(link: MarketplaceListingLink): string {
  try {
    return createMarketplaceShareUrl(link, window.location.origin);
  } catch {
    return createMarketplaceShareUrl(link);
  }
}

export function CopyLinkButton(props: { link: MarketplaceListingLink }) {
  const { t } = useText();
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(props.link));
    } catch {
      // The clipboard is not allowed. The address bar holds the same link.
      return;
    }
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), COPIED_MS);
  };
  onSettled(() => () => clearTimeout(timer));
  const icon = () => (copied() ? "check" : "copy");
  const label = () => (copied() ? t("sitePage.marketplace.copied") : t("sitePage.marketplace.copyLink"));
  return (
    <button
      type="button"
      class="landing-button landing-button-secondary landing-button-lg"
      data-icon={icon()}
      onClick={() => void copy()}
    >
      {label()}
    </button>
  );
}
