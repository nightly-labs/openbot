import { AppLogo, PlatformLogo, ProviderLogo } from "@openbot/brand";
import { onSettled } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { ButtonLink } from "../ui/button";
import { AgentNetworkSection } from "./AgentNetworkSection";
import { DownloadSection } from "./DownloadSection";
import { FaqSection } from "./FaqSection";
import { FeaturesSection } from "./FeaturesSection";
import { HeroDownloadSelector } from "./HeroDownloadSelector";
import { LandingAppPreview } from "./LandingAppPreview";
import { LandingBeam } from "./LandingBeam";
import { LandingFooter } from "./LandingFooter";
import { LandingGlow } from "./LandingGlow";
import { PricingSection } from "./PricingSection";
import { SiteHeader } from "./SiteHeader";
import { TeamsSection } from "./TeamsSection";

/** A promise and the function that resolves it. */
function latch(): { open: () => void; opened: Promise<void> } {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

export function LandingPage() {
  // The beam falls in when the app preview has loaded, and the preview appears as the beam hits it.
  const previewReady = latch();
  const beamImpact = latch();
  let copy: HTMLDivElement | undefined;
  let preview: HTMLElement | undefined;
  let download: HTMLElement | undefined;
  onSettled(() => landingAnalytics.start(document, window.location.hostname));

  return (
    <div class="landing-page">
      <SiteHeader
        page="landing"
        downloadRef={(element) => {
          download = element;
        }}
      />

      <main>
        <section class="landing-hero" aria-labelledby="landing-title">
          <LandingBeam
            surface={() => preview}
            source={() => download}
            avoid={() => (copy ? [...copy.children] : [])}
            beamPosition={0.78}
            color="#a46cf5"
            start={previewReady.opened}
            onImpact={beamImpact.open}
          />
          <div ref={copy} class="landing-hero-copy">
            <p class="landing-availability landing-hero-line" style={{ "--landing-hero-line": 0 }}>
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
                <PlatformLogo platform="linux" solid />
                Linux
              </span>
              <span class="landing-availability-divider" aria-hidden="true" />
              <span class="landing-availability-platform">
                <PlatformLogo platform="ios" />
                iOS
              </span>
              <span class="landing-availability-separator" aria-hidden="true">
                ·
              </span>
              <span class="landing-availability-platform">
                <PlatformLogo platform="android" />
                Android
              </span>
            </p>

            <h1 id="landing-title" class="landing-title landing-hero-line" style={{ "--landing-hero-line": 1 }}>
              {/* The spaces do not render in the flex row. They keep the words apart in
                  the text that search engines read, which was "MeetOpenBot". */}
              <span>Meet</span> <AppLogo variant="production" animation="blink" interactive class="landing-hero-logo" />{" "}
              <span>OpenBot</span>
            </h1>

            <p class="landing-description landing-hero-line" style={{ "--landing-hero-line": 2 }}>
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

            <div class="landing-actions landing-hero-line" style={{ "--landing-hero-line": 3 }}>
              <HeroDownloadSelector />
              <ButtonLink to="/contact" variant="secondary" size="lg" icon="contact" class="landing-button-glass">
                Contact
              </ButtonLink>
            </div>
          </div>

          <LandingAppPreview
            ref={(element) => (preview = element)}
            onReady={previewReady.open}
            revealAfter={beamImpact.opened}
          />
        </section>
        <AgentNetworkSection />
        <FeaturesSection />
        <PricingSection />
        <TeamsSection />
        <FaqSection />
        <DownloadSection />
        <ContentCallToAction />
      </main>
      <LandingFooter />
      <LandingGlow />
    </div>
  );
}
