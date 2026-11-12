import { AppLogo, PlatformLogo, ProviderLogo } from "@openbot/brand";
import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import type { HeroProviderPart, LandingPageText } from "../../lib/landing-page-text";
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
import { LandingTextProvider, useLandingText } from "./LandingText";
import { PricingSection } from "./PricingSection";
import { SiteHeader } from "./SiteHeader";
import { useSitePath } from "./SiteText";
import { TeamsSection } from "./TeamsSection";

/** A promise and the function that resolves it. */
function latch(): { open: () => void; opened: Promise<void> } {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

export function LandingPage(props: { text: LandingPageText }) {
  return (
    <LandingTextProvider text={props.text}>
      <LandingPageContent />
    </LandingTextProvider>
  );
}

// Named accessors, not conditionals in props: a conditional prop moves the SSR hydration keys.
/** Plain words of the hero sentence, or a provider name with its logo. */
function HeroDescriptionPart(props: { part: string | HeroProviderPart }) {
  const provider = () => (typeof props.part === "string" ? undefined : props.part);
  const words = () => (typeof props.part === "string" ? props.part : undefined);
  return (
    <Show when={provider()} fallback={words()}>
      {(part) => <HeroProvider part={part()} />}
    </Show>
  );
}

/** A provider name and its logo. The punctuation after it stays on the same line. */
function HeroProvider(props: { part: HeroProviderPart }) {
  const name = () => (
    <span class="landing-provider">
      <ProviderLogo provider={props.part.provider} class="landing-provider-logo" />
      {props.part.name}
    </span>
  );
  return (
    <Show when={props.part.suffix} fallback={name()}>
      <span class="landing-provider-item">
        {name()}
        {props.part.suffix}
      </span>
    </Show>
  );
}

function LandingPageContent() {
  const text = useLandingText();
  const path = useSitePath();
  const hero = () => text().hero;
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
              <span class="landing-availability-new">{hero().new}</span>
              <span class="landing-availability-copy">{hero().availableOn}</span>
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
              <Show when={hero().title.before}>
                {(before) => (
                  <>
                    <span>{before()}</span>{" "}
                  </>
                )}
              </Show>
              <AppLogo variant="production" animation="blink" interactive class="landing-hero-logo" />{" "}
              <span>OpenBot</span>
              <Show when={hero().title.after}>
                {(after) => (
                  <>
                    {" "}
                    <span>{after()}</span>
                  </>
                )}
              </Show>
            </h1>

            <p class="landing-description landing-hero-line" style={{ "--landing-hero-line": 2 }}>
              <For each={hero().description}>{(part) => <HeroDescriptionPart part={part} />}</For>
            </p>

            <div class="landing-actions landing-hero-line" style={{ "--landing-hero-line": 3 }}>
              <HeroDownloadSelector />
              <ButtonLink
                to={path("/contact")}
                variant="secondary"
                size="lg"
                icon="contact"
                class="landing-button-glass"
              >
                {hero().contact}
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
