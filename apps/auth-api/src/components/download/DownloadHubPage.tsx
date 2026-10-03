import { PlatformLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, onSettled } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { DOWNLOAD_HUB, DOWNLOAD_PAGES, downloadPagePath } from "../../lib/download-pages";
import { DOWNLOAD_PLATFORM_ORDER } from "../../lib/download-platforms";
import { HeroDownloadSelector } from "../landing/HeroDownloadSelector";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { DownloadResources } from "./DownloadResources";

// The installer for this computer, as the landing hero offers it, then one card per system that
// opens its page. The cards use the landing download cards' look.
export function DownloadHubPage() {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, downloadPagePath("hub")));

  return (
    <div class="landing-page download-page">
      <SiteHeader page="content" />

      <main class="post-main">
        <div class="post-container download-container">
          <header class="download-hero" data-enter="post-copy">
            <h1 class="compare-title">{DOWNLOAD_HUB.heading}</h1>
            <p class="compare-standfirst">{DOWNLOAD_HUB.intro}</p>
            <div class="download-hub-selector">
              <HeroDownloadSelector />
            </div>
          </header>

          <section class="compare-section" aria-labelledby="download-systems-title">
            <h2 class="compare-heading" id="download-systems-title">
              Requirements and install steps
            </h2>
            <ul class="landing-download-grid download-hub-grid">
              <For each={DOWNLOAD_PLATFORM_ORDER}>
                {(platform) => (
                  <li>
                    <Link
                      class="landing-download-card"
                      to="/download/$platform"
                      params={{ platform }}
                      data-download-platform={platform}
                      data-state="available"
                    >
                      <div class="landing-download-card-top">
                        <PlatformLogo platform={platform} class="landing-download-platform-logo" />
                      </div>
                      <div class="landing-download-card-copy">
                        <h3>{DOWNLOAD_PAGES[platform].name}</h3>
                        <p>{DOWNLOAD_HUB.summaries[platform]}</p>
                        <span class="landing-download-action">
                          {DOWNLOAD_PAGES[platform].heading}
                          <LandingIcon name="arrow-right" class="landing-download-arrow" />
                        </span>
                      </div>
                    </Link>
                  </li>
                )}
              </For>
            </ul>
            <DownloadResources />
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
