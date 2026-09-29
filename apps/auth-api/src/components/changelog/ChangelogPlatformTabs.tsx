import { Link } from "@tanstack/solid-router";
import { createEffect, For, onSettled } from "solid-js";
import { CHANGELOG_PLATFORMS, type ChangelogPlatform, type ChangelogSearch } from "../../lib/changelog";

export const PLATFORM_LABELS: Record<ChangelogPlatform, string> = {
  desktop: "Desktop & web",
  mobile: "Mobile",
};

const platformSearch = (platform: ChangelogPlatform): ChangelogSearch => (platform === "mobile" ? { platform } : {});

export interface ChangelogPlatformTabsProps {
  platform: ChangelogPlatform;
  /** Runs before the router changes the address, while the old list is still in place. */
  onSelect: () => void;
}

/**
 * Links rather than tabs: each list has its own address, so a link to the mobile notes opens
 * them, and the page renders the right list on the server. The pill slides behind the open one,
 * as it does in the header menu. Until the pill is measured, the open link carries its own.
 */
export function ChangelogPlatformTabs(props: ChangelogPlatformTabsProps) {
  let track: HTMLDivElement | undefined;
  const links = new Map<ChangelogPlatform, HTMLAnchorElement>();

  const place = (platform: ChangelogPlatform) => {
    const link = links.get(platform);
    if (!track || !link) return;
    track.style.setProperty("--changelog-pill-x", `${link.offsetLeft}px`);
    track.style.setProperty("--changelog-pill-width", `${link.offsetWidth}px`);
  };

  createEffect(() => props.platform, place);

  // Measured again when the web font arrives and changes the width of the labels.
  onSettled(() => {
    if (!track) return;
    const element = track;
    const observer = new ResizeObserver(() => place(props.platform));
    observer.observe(element);
    place(props.platform);
    element.dataset.ready = "";
    return () => observer.disconnect();
  });

  return (
    <nav class="changelog-platforms" aria-label="Apps">
      <div ref={track} class="changelog-platforms-track">
        <For each={CHANGELOG_PLATFORMS}>
          {(platform) => (
            <Link
              ref={(element: HTMLAnchorElement) => links.set(platform, element)}
              class="changelog-platform"
              to="/changelog"
              search={platformSearch(platform)}
              activeOptions={{ exact: true }}
              replace
              resetScroll={false}
              onClick={(event: MouseEvent) => {
                // A modified click opens a new tab, and this page stays as it is.
                const plain =
                  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
                if (plain && platform !== props.platform) props.onSelect();
              }}
            >
              {PLATFORM_LABELS[platform]}
            </Link>
          )}
        </For>
      </div>
    </nav>
  );
}
