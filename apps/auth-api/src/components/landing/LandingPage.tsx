import { AppLogo, PlatformLogo, ProviderLogo } from "@openbot/brand";
import { onSettled } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import { Button } from "../ui/button";
import { DownloadSection } from "./DownloadSection";
import { HeroDownloadSelector } from "./HeroDownloadSelector";
import { LandingAppPreview } from "./LandingAppPreview";
import { LandingFooter } from "./LandingFooter";
import { LandingGlow } from "./LandingGlow";
import { PricingSection } from "./PricingSection";
import { ProductHuntPill } from "./ProductHuntLaunch";
import { SiteHeader } from "./SiteHeader";

export function LandingPage() {
  let hero: HTMLDivElement | undefined;

  onSettled(() => {
    const cleanup = landingAnalytics.start(document, window.location.hostname);
    if (hero) {
      hero.classList.remove("is-hiding");
      hero.classList.remove("is-shown");
      void hero.offsetHeight;
      hero.classList.add("is-shown");
    }
    return cleanup;
  });

  return (
    <div class="landing-page">
      <SiteHeader page="landing" />

      <main>
        <section class="landing-hero" aria-labelledby="landing-title">
          <div class="landing-hero-grid" data-slot="hero-grid" aria-hidden="true" />
          <div ref={hero} class="landing-hero-copy t-stagger">
            <div class="landing-hero-pills t-stagger-line t-stagger-line--1">
              <ProductHuntPill />
              <p class="landing-availability">
                <span class="landing-availability-new">NEW</span>
                <span class="landing-availability-copy">Available on</span>
                <span class="landing-availability-platform">
                  <PlatformLogo platform="macos" />
                  macOS
                </span>
                <span class="landing-availability-separator" aria-hidden="true">
                  ·
                </span>
                <span class="landing-availability-platform">
                  <PlatformLogo platform="windows" />
                  Windows
                </span>
                <span class="landing-availability-separator" aria-hidden="true">
                  ·
                </span>
                <span class="landing-availability-platform">
                  <PlatformLogo platform="linux" />
                  Linux
                </span>
              </p>
            </div>

            <h1 id="landing-title" class="landing-title t-stagger-line t-stagger-line--2">
              <span>Meet</span>
              <AppLogo variant="production" animation="blink" interactive class="landing-hero-logo" />
              <span>OpenBot</span>
            </h1>

            <p class="landing-description t-stagger-line t-stagger-line--3">
              Persistent AI teammates on your own computer. Run{" "}
              <span class="landing-provider-item">
                <span class="landing-provider">
                  <ProviderLogo provider="codex" class="landing-provider-logo" />
                  Codex
                </span>
                ,
              </span>{" "}
              <span class="landing-provider-item">
                <span class="landing-provider">
                  <ProviderLogo provider="claude" class="landing-provider-logo" />
                  Claude
                </span>
                ,
              </span>{" "}
              <span class="landing-provider">
                <ProviderLogo provider="antigravity" class="landing-provider-logo" />
                Gemini
              </span>{" "}
              and{" "}
              <span class="landing-provider">
                <ProviderLogo provider="grok" class="landing-provider-logo" />
                Grok
              </span>{" "}
              with the plans you already pay for, or your own model.
            </p>

            <div class="landing-actions t-stagger-line t-stagger-line--4">
              <HeroDownloadSelector />
              <Button
                href={OPENBOT_LINKS.contact}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                variant="secondary"
                size="lg"
                icon="contact"
                class="landing-button-glass"
              >
                Contact
              </Button>
            </div>
          </div>

          <LandingAppPreview />
        </section>
        <PricingSection />
        <DownloadSection />
      </main>
      <LandingFooter />
      <LandingGlow />
    </div>
  );
}
