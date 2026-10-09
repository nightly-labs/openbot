import { PlatformLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, onSettled } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { DOWNLOAD_HUB, DOWNLOAD_PAGES, type DownloadPagePlatform, downloadPagePath } from "../../lib/download-pages";
import { DOWNLOAD_PLATFORM_ORDER } from "../../lib/download-platforms";
import { MOBILE_APP_ORDER } from "../../lib/mobile-apps";
import { HeroDownloadSelector } from "../landing/HeroDownloadSelector";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { InstallerButton } from "./DownloadPieces";
import { DownloadResources } from "./DownloadResources";

// The installer for this computer, as the landing hero offers it, then one card per system in the
// colours of the landing download cards, and a row of cards for the phone apps under them. Each
// card has every installer of its system, and a link to its page for the requirements and install steps.
export function DownloadHubPage() {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, downloadPagePath("hub")));

  return (
    <div class="landing-page download-page">
      <SiteHeader page="content" />

      <main class="download-main">
        <header class="download-hub-hero" data-enter="post-copy">
          <h1 class="download-hub-title">{DOWNLOAD_HUB.heading}</h1>
          <p class="download-hub-intro">{DOWNLOAD_HUB.intro}</p>
          <HeroDownloadSelector />
        </header>

        <ul class="download-hub-cards" aria-label="Systems">
          <For each={DOWNLOAD_PLATFORM_ORDER}>{(platform) => <DownloadHubCard platform={platform} />}</For>
        </ul>

        <ul class="download-hub-cards download-hub-cards-mobile" aria-label="Mobile apps">
          <For each={MOBILE_APP_ORDER}>{(platform) => <DownloadHubCard platform={platform} />}</For>
        </ul>

        <DownloadResources />
      </main>

      <LandingFooter />
    </div>
  );
}

function DownloadHubCard(props: { platform: DownloadPagePlatform }) {
  const page = () => DOWNLOAD_PAGES[props.platform];
  return (
    <li class="download-hub-card" data-download-platform={props.platform}>
      <PlatformLogo platform={props.platform} class="download-hub-card-logo" />
      <h2 class="download-hub-card-name">{page().name}</h2>
      <dl class="download-hub-card-specs">
        <For each={page().specs.slice(0, 3)}>
          {(spec) => (
            <div>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          )}
        </For>
      </dl>
      <div class="download-hub-card-installers">
        <For each={page().installers}>
          {(installer, index) => <InstallerButton installer={installer} primary={index() === 0} short />}
        </For>
      </div>
      <Link class="download-hub-card-link" to="/download/$platform" params={{ platform: props.platform }}>
        Requirements and install steps
        <LandingIcon name="arrow-right" class="download-hub-card-link-icon" />
      </Link>
    </li>
  );
}
