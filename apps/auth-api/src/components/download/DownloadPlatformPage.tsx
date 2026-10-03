import { PlatformLogo } from "@openbot/brand";
import { Link } from "@tanstack/solid-router";
import { For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { type DownloadPageContent, type DownloadStep, downloadPagePath } from "../../lib/download-pages";
import { DOWNLOAD_PLATFORM_ORDER } from "../../lib/download-platforms";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingIcon } from "../landing/LandingIcon";
import { SiteHeader } from "../landing/SiteHeader";
import { CommandBlock, InstallerButton, SystemCard } from "./DownloadPieces";
import { DownloadResources } from "./DownloadResources";

export interface DownloadPlatformPageProps {
  page: DownloadPageContent;
}

// One operating system. The landing card of the system opens into a panel in its colour, with the
// installers and the spec sheet. Under it, each topic is one row: the heading on the left and the
// text on the right, as plain lists, so a crawler reads what a visitor reads.
export function DownloadPlatformPage(props: DownloadPlatformPageProps) {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, downloadPagePath(props.page.platform)));

  const otherPlatforms = () => DOWNLOAD_PLATFORM_ORDER.filter((platform) => platform !== props.page.platform);

  return (
    <div class="landing-page download-page">
      <SiteHeader page="content" />

      <main class="download-main" data-download-platform={props.page.platform}>
        <section class="download-panel" data-enter="post-copy" aria-labelledby="download-title">
          <div class="download-panel-body">
            <div class="download-panel-copy">
              <Link class="download-panel-back" to="/download">
                <LandingIcon name="arrow-right" class="download-panel-back-icon" />
                All systems
              </Link>
              <h1 class="download-panel-title" id="download-title">
                {props.page.heading}
              </h1>
              <p class="download-panel-intro">{props.page.intro}</p>
              <ul class="download-panel-installers">
                <For each={props.page.installers}>
                  {(installer, index) => (
                    <li>
                      <InstallerButton installer={installer} primary={index() === 0} />
                      <span class="download-panel-installer-detail">{installer.detail}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
            <PlatformLogo platform={props.page.platform} class="download-panel-logo" />
          </div>
          <dl class="download-panel-specs">
            <For each={props.page.specs}>
              {(spec) => (
                <div>
                  <dt>{spec.label}</dt>
                  <dd>{spec.value}</dd>
                </div>
              )}
            </For>
          </dl>
        </section>

        <div class="download-rows">
          <section class="download-row" aria-labelledby="download-install-title">
            <h2 class="download-row-title" id="download-install-title">
              Install on {props.page.name}
            </h2>
            <DownloadSteps steps={props.page.installSteps} />
          </section>

          <For each={props.page.extraSections}>
            {(section, index) => (
              <section class="download-row" aria-labelledby={`download-extra-${index()}`}>
                <h2 class="download-row-title" id={`download-extra-${index()}`}>
                  {section.title}
                </h2>
                <DownloadSteps steps={section.steps} />
              </section>
            )}
          </For>

          <section class="download-row" aria-labelledby="download-notes-title">
            <h2 class="download-row-title" id="download-notes-title">
              Good to know
            </h2>
            <ul class="download-notes">
              <For each={props.page.notes}>{(note) => <li>{note}</li>}</For>
            </ul>
          </section>

          <section class="download-row" aria-labelledby="download-faq-title">
            <h2 class="download-row-title" id="download-faq-title">
              Questions
            </h2>
            <div class="compare-faq-list download-faq">
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

          <section class="download-row" aria-labelledby="download-other-title">
            <h2 class="download-row-title" id="download-other-title">
              Other systems
            </h2>
            <div>
              <ul class="download-system-cards">
                <For each={otherPlatforms()}>
                  {(platform) => (
                    <li>
                      <SystemCard platform={platform} />
                    </li>
                  )}
                </For>
              </ul>
              <DownloadResources />
            </div>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}

// The steps are a sequence, so the numbers carry meaning: they come from the list itself.
function DownloadSteps(props: { steps: readonly DownloadStep[] }) {
  return (
    <ol class="download-steps">
      <For each={props.steps}>
        {(step) => (
          <li>
            <p>{step.text}</p>
            <Show when={step.code}>{(code) => <CommandBlock code={code()} />}</Show>
          </li>
        )}
      </For>
    </ol>
  );
}
