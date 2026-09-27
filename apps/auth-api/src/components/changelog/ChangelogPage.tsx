import { prefersReducedMotion } from "@openbot/ui/utils";
import { createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CHANGELOG_ROUTE, type ChangelogRelease as Release } from "../../lib/changelog";
import { CHANGELOG_RELEASES } from "../../lib/changelog-releases";
import { formatArticleDate } from "../../lib/content-collection";
import { ArticleGradient } from "../content/ArticleGradient";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { ButtonLink } from "../ui/button";
import { ChangelogRelease } from "./ChangelogRelease";

/** The seed for the hero's colours: the Sunset family, the one the featured article on /news uses. */
const HERO_GRADIENT_SEED = "OpenBot releases";

/** A release becomes current once its heading passes this share of the window's height. */
const ACTIVE_LINE = 0.3;

// Fixed to UTC for the reason `formatArticleDate` gives: the Worker renders in UTC.
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);

interface ReleaseMonth {
  label: string;
  releases: Release[];
}

/** The index in months, so 57 rows read as a few short runs rather than one column of numbers. */
function releaseMonths(releases: readonly Release[]): ReleaseMonth[] {
  const months: ReleaseMonth[] = [];
  for (const release of releases) {
    const label = release.date ? MONTH_FORMAT.format(utcDate(release.date)) : "";
    const month = months.at(-1);
    if (month?.label === label) month.releases.push(release);
    else months.push({ label, releases: [release] });
  }
  return months;
}

/** Scroll the index, and only the index, so the current row is in sight. */
function keepInView(container: HTMLElement, link: HTMLElement): void {
  const box = container.getBoundingClientRect();
  const row = link.getBoundingClientRect();
  const behavior = prefersReducedMotion() ? "instant" : "smooth";
  if (container.scrollWidth > container.clientWidth) {
    if (row.left < box.left || row.right > box.right)
      container.scrollTo({ left: container.scrollLeft + row.left - box.left - (box.width - row.width) / 2, behavior });
    return;
  }
  if (row.top < box.top || row.bottom > box.bottom)
    container.scrollTo({ top: container.scrollTop + row.top - box.top - (box.height - row.height) / 2, behavior });
}

export function ChangelogPage() {
  const releases = CHANGELOG_RELEASES;
  const months = releaseMonths(releases);
  const latest = releases[0];
  const [active, setActive] = createSignal(latest?.anchor ?? "");
  let index: HTMLDivElement | undefined;

  onSettled(() => landingAnalytics.start(document, window.location.hostname, CHANGELOG_ROUTE));

  // The current release is the last one whose top has passed a line near the top of the window.
  // Measured on scroll rather than with an observer: a jump from the index crosses many releases
  // at once, and only the position after it matters.
  onSettled(() => {
    const articles = releases.flatMap((release) => {
      const element = document.getElementById(release.anchor);
      return element ? [{ anchor: release.anchor, element }] : [];
    });
    let frame = 0;
    let shown = "";

    const update = () => {
      frame = 0;
      const line = window.innerHeight * ACTIVE_LINE;
      let current = articles[0]?.anchor ?? "";
      for (const { anchor, element } of articles) {
        if (element.getBoundingClientRect().top > line) break;
        current = anchor;
      }
      if (current === shown) return;
      shown = current;
      setActive(current);
      const link = index?.querySelector<HTMLElement>(`a[href="#${current}"]`);
      if (index && link) keepInView(index, link);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  });

  return (
    <div class="landing-page changelog-page">
      <SiteHeader page="content" />

      <main class="post-main">
        <div class="post-container">
          <section class="changelog-hero" aria-labelledby="changelog-title">
            <div class="changelog-hero-art" data-enter="post-art" aria-hidden="true">
              <ArticleGradient title={HERO_GRADIENT_SEED} mode="live" />
            </div>
            <div class="changelog-hero-copy" data-enter="post-copy">
              <p class="changelog-eyebrow">Changelog</p>
              <h1 class="changelog-title" id="changelog-title">
                What's new in OpenBot
              </h1>
              <p class="changelog-lede">
                New providers, new ways to work as a team, and the fixes that make each release steadier. Every release
                is here, newest first, with what to do after you upgrade.
              </p>
            </div>
          </section>

          <Show when={latest}>
            {(release) => (
              <div class="changelog-latest" data-enter="post-prose">
                <p class="changelog-latest-text">
                  <span class="changelog-latest-dot" aria-hidden="true" />
                  Latest release
                  <a class="changelog-latest-version" href={`#${release().anchor}`}>
                    {release().version}
                  </a>
                  <Show when={release().date}>
                    {(date) => <span class="changelog-latest-date">· {formatArticleDate(date())}</span>}
                  </Show>
                </p>
                <ButtonLink to="/" hash="download" variant="secondary" size="sm" icon="download">
                  Download
                </ButtonLink>
              </div>
            )}
          </Show>

          <div class="changelog-layout">
            <nav class="changelog-index" aria-label="Releases">
              <p class="changelog-index-title">
                Releases <span class="changelog-index-count">{releases.length}</span>
              </p>
              <div ref={index} class="changelog-index-scroll">
                <For each={months}>
                  {(month) => (
                    <div class="changelog-index-month">
                      <Show when={month.label}>
                        <p class="changelog-index-month-label">{month.label}</p>
                      </Show>
                      <ul class="changelog-index-list">
                        <For each={month.releases}>
                          {(release) => (
                            <li class="changelog-index-item">
                              <a
                                class="changelog-index-link"
                                href={`#${release.anchor}`}
                                aria-current={active() === release.anchor ? "true" : undefined}
                                onClick={() => setActive(release.anchor)}
                              >
                                <span class="changelog-index-version">{release.version}</span>
                                <Show when={release.date}>
                                  <time class="changelog-index-date" datetime={release.date}>
                                    {DAY_FORMAT.format(utcDate(release.date))}
                                  </time>
                                </Show>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            </nav>

            <div class="changelog-releases">
              <For each={releases}>
                {(release, position) => <ChangelogRelease release={release} latest={position() === 0} />}
              </For>
            </div>
          </div>
        </div>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}
