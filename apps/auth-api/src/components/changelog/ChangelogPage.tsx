import { ANDROID_PLAY_STORE_URL } from "@openbot/ui/features/mobile-app/android-play-store";
import { IOS_TESTFLIGHT_URL } from "@openbot/ui/features/mobile-app/ios-testflight";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { CHANGELOG_ROUTE, type ChangelogPlatform, type ChangelogRelease as Release } from "../../lib/changelog";
import { CHANGELOG_RELEASES } from "../../lib/changelog-releases";
import { formatArticleDate } from "../../lib/content-collection";
import { EXTERNAL_LINK_REL } from "../../lib/landing-links";
import { ArticleGradient } from "../content/ArticleGradient";
import { ContentCallToAction } from "../content/ContentCallToAction";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";
import { Button, ButtonLink } from "../ui/button";
import { ChangelogPlatformTabs, PLATFORM_LABELS } from "./ChangelogPlatformTabs";
import { ChangelogRelease } from "./ChangelogRelease";
import { ChangelogSwap, createPlatformSwap } from "./ChangelogSwap";

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

/** The name of the app in each release title. */
const PRODUCT_NAMES: Record<ChangelogPlatform, string> = {
  desktop: "OpenBot",
  mobile: "OpenBot Mobile",
};

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

export interface ChangelogPageProps {
  platform: ChangelogPlatform;
}

export function ChangelogPage(props: ChangelogPageProps) {
  const [active, setActive] = createSignal(untrack(() => CHANGELOG_RELEASES[props.platform][0]?.anchor ?? ""));
  const swap = createPlatformSwap(() => props.platform);
  const indexes = new Map<ChangelogPlatform, HTMLDivElement>();
  let layout: HTMLDivElement | undefined;
  // Set once the page is on screen: finds the current release again after the list changes.
  let track = () => {};

  onSettled(() => landingAnalytics.start(document, window.location.hostname, CHANGELOG_ROUTE));

  // The current release is the last one whose top has passed a line near the top of the window.
  // Measured on scroll rather than with an observer: a jump from the index crosses many releases
  // at once, and only the position after it matters.
  onSettled(() => {
    let frame = 0;
    let shown = "";

    const update = () => {
      frame = 0;
      const line = window.innerHeight * ACTIVE_LINE;
      const list = CHANGELOG_RELEASES[swap.platform()];
      let current = list[0]?.anchor ?? "";
      for (const { anchor } of list) {
        const element = document.getElementById(anchor);
        if (!element) continue;
        if (element.getBoundingClientRect().top > line) break;
        current = anchor;
      }
      if (current === shown) return;
      shown = current;
      setActive(current);
      const index = indexes.get(swap.platform());
      const link = index?.querySelector<HTMLElement>(`a[href="#${current}"]`);
      if (index && link) keepInView(index, link);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    track = schedule;

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      track = () => {};
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  });

  createEffect(
    () => props.platform,
    (platform) => {
      setActive(CHANGELOG_RELEASES[platform][0]?.anchor ?? "");
      track();
    },
  );

  // The other list starts at its newest release, so a reader deep in one list is taken back to
  // the top of the lists. The tabs stay where they are: the index is held at the same place.
  const showListStart = () => {
    if (layout && layout.getBoundingClientRect().top < 0)
      layout.scrollIntoView({ block: "start", behavior: "instant" });
  };

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

          <div class="changelog-latest" data-enter="post-prose">
            <ChangelogSwap swap={swap} panelClass="changelog-latest-row">
              {(platform) => <LatestRelease platform={platform} />}
            </ChangelogSwap>
          </div>

          <div ref={layout} class="changelog-layout">
            <div class="changelog-index">
              <ChangelogPlatformTabs platform={props.platform} onSelect={showListStart} />
              <ChangelogSwap swap={swap}>
                {(platform) => (
                  <nav class="changelog-index-nav" aria-label={`${PLATFORM_LABELS[platform]} releases`}>
                    <p class="changelog-index-title">
                      Releases <span class="changelog-index-count">{CHANGELOG_RELEASES[platform].length}</span>
                    </p>
                    <div ref={(element) => indexes.set(platform, element)} class="changelog-index-scroll">
                      <For each={releaseMonths(CHANGELOG_RELEASES[platform])}>
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
                )}
              </ChangelogSwap>
            </div>

            <ChangelogSwap swap={swap} class="changelog-releases">
              {(platform) => (
                <For each={CHANGELOG_RELEASES[platform]}>
                  {(release, position) => (
                    <ChangelogRelease release={release} product={PRODUCT_NAMES[platform]} latest={position() === 0} />
                  )}
                </For>
              )}
            </ChangelogSwap>
          </div>
        </div>

        <ContentCallToAction />
      </main>

      <LandingFooter />
    </div>
  );
}

/** The newest release of one app, and where to get that app. */
function LatestRelease(props: { platform: ChangelogPlatform }) {
  return (
    <Show when={CHANGELOG_RELEASES[props.platform][0]}>
      {(release) => (
        <>
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
          <Show
            when={props.platform === "mobile"}
            fallback={
              <ButtonLink to="/" hash="download" variant="secondary" size="sm" icon="download">
                Download
              </ButtonLink>
            }
          >
            <div class="changelog-latest-actions">
              <Button
                href={IOS_TESTFLIGHT_URL}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                variant="secondary"
                size="sm"
                icon="open"
              >
                Join the TestFlight beta
              </Button>
              <Button
                href={ANDROID_PLAY_STORE_URL}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                variant="secondary"
                size="sm"
                icon="download"
              >
                Download for Android
              </Button>
            </div>
          </Show>
        </>
      )}
    </Show>
  );
}
