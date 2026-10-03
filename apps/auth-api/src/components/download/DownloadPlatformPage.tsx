import { PlatformLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import {
  DOWNLOAD_PAGES,
  type DownloadPageContent,
  type DownloadStep,
  downloadPagePath,
} from "../../lib/download-pages";
import { DOWNLOAD_PLATFORM_ORDER } from "../../lib/download-platforms";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { Button } from "../ui/button";
import { DownloadResources } from "./DownloadResources";

export interface DownloadPlatformPageProps {
  page: DownloadPageContent;
}

// One operating system: the installers first, then what the computer needs, how to install, and
// what differs on this system. Plain text and lists, so a crawler reads what a visitor reads.
export function DownloadPlatformPage(props: DownloadPlatformPageProps) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, downloadPagePath(props.page.platform)));

  const otherPlatforms = () => DOWNLOAD_PLATFORM_ORDER.filter((platform) => platform !== props.page.platform);

  return (
    <div class="landing-page download-page">
      <SiteHeader page="content" />

      <main class="post-main">
        <div class="post-container download-container">
          <header class="download-hero" data-enter="post-copy">
            <Link class="post-article-back" to="/download">
              All systems
            </Link>
            <PlatformLogo platform={props.page.platform} solid class="download-hero-logo" />
            <h1 class="compare-title">{props.page.heading}</h1>
            <p class="compare-standfirst">{props.page.intro}</p>
            <ul class="download-installers">
              <For each={props.page.installers}>
                {(installer, index) => (
                  <li>
                    <Button
                      href={installer.href}
                      variant={index() === 0 ? "primary" : "secondary"}
                      size="lg"
                      icon="download"
                    >
                      {installer.label}
                    </Button>
                    <span class="download-installer-detail">{installer.detail}</span>
                  </li>
                )}
              </For>
            </ul>
          </header>

          <section class="compare-section" aria-labelledby="download-requirements-title">
            <h2 class="compare-heading" id="download-requirements-title">
              System requirements
            </h2>
            <ul class="download-list">
              <For each={props.page.requirements}>{(requirement) => <li>{requirement}</li>}</For>
            </ul>
          </section>

          <section class="compare-section" aria-labelledby="download-install-title">
            <h2 class="compare-heading" id="download-install-title">
              Install OpenBot on {props.page.name}
            </h2>
            <DownloadSteps steps={props.page.installSteps} />
          </section>

          <For each={props.page.extraSections}>
            {(section, index) => (
              <section class="compare-section" aria-labelledby={`download-extra-${index()}`}>
                <h2 class="compare-heading" id={`download-extra-${index()}`}>
                  {section.title}
                </h2>
                <DownloadSteps steps={section.steps} />
              </section>
            )}
          </For>

          <section class="compare-section" aria-labelledby="download-notes-title">
            <h2 class="compare-heading" id="download-notes-title">
              Good to know
            </h2>
            <ul class="download-list">
              <For each={props.page.notes}>{(note) => <li>{note}</li>}</For>
            </ul>
          </section>

          <section class="compare-section" aria-labelledby="download-faq-title">
            <h2 class="compare-heading" id="download-faq-title">
              Questions
            </h2>
            <div class="compare-faq-list">
              <For each={props.page.faq}>
                {(entry) => (
                  <details class="compare-faq-item">
                    <summary class="compare-faq-question">
                      {entry.question}
                      <LandingIcon name="chevron-down" class="compare-faq-chevron" />
                    </summary>
                    <p class="compare-faq-answer">{entry.answer}</p>
                  </details>
                )}
              </For>
            </div>
          </section>

          <section class="compare-section" aria-labelledby="download-other-title">
            <h2 class="compare-heading" id="download-other-title">
              Other systems
            </h2>
            <ul class="download-other">
              <For each={otherPlatforms()}>
                {(platform) => (
                  <li>
                    <Link class="download-other-link" to="/download/$platform" params={{ platform }}>
                      <PlatformLogo platform={platform} solid class="download-other-logo" />
                      {DOWNLOAD_PAGES[platform].heading}
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

function DownloadSteps(props: { steps: readonly DownloadStep[] }) {
  return (
    <ol class="download-steps">
      <For each={props.steps}>
        {(step) => (
          <li>
            <p>{step.text}</p>
            <Show when={step.code}>
              {(code) => (
                <pre class="download-code">
                  <code>{code()}</code>
                </pre>
              )}
            </Show>
          </li>
        )}
      </For>
    </ol>
  );
}
