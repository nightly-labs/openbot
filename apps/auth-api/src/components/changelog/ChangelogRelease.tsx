import { For, Show } from "solid-js";
import type { ChangelogGroup, ChangelogGroupType, ChangelogRelease as Release } from "../../lib/changelog";
import { formatArticleDate } from "../../lib/content-collection";
import { createLandingReveal } from "../landing/createLandingReveal";
import { ChangelogInline } from "./ChangelogInline";

/** The file's headings, in the words a reader of release notes expects. */
const GROUP_LABELS: Record<Exclude<ChangelogGroupType, "other">, string> = {
  added: "New",
  changed: "Improved",
  fixed: "Fixed",
  removed: "Removed",
  security: "Security",
  deprecated: "Deprecated",
};

function groupLabel(group: ChangelogGroup): string {
  return group.type === "other" ? group.heading : GROUP_LABELS[group.type];
}

export interface ChangelogReleaseProps {
  release: Release;
  latest: boolean;
}

export function ChangelogRelease(props: ChangelogReleaseProps) {
  let article: HTMLElement | undefined;
  const titleId = () => `${props.release.anchor}-title`;
  // A small inset, so a release arrives as it comes up the screen, and one reached from the
  // index is already in place when the scroll stops on it.
  const revealed = createLandingReveal(() => article, { rootMargin: "0px 0px -8% 0px" });

  return (
    <article
      ref={article}
      id={props.release.anchor}
      class="changelog-release"
      aria-labelledby={titleId()}
      data-revealed={revealed() ? "true" : "false"}
    >
      <header class="changelog-release-header">
        <div class="changelog-release-meta">
          <Show when={props.release.date}>
            {(date) => (
              <time class="changelog-release-date" datetime={date()}>
                {formatArticleDate(date())}
              </time>
            )}
          </Show>
          <Show when={props.latest}>
            <span class="changelog-release-badge">Latest</span>
          </Show>
        </div>
        <h2 class="changelog-release-title" id={titleId()}>
          <a class="changelog-release-anchor" href={`#${props.release.anchor}`}>
            OpenBot <span class="changelog-release-version">{props.release.version}</span>
          </a>
        </h2>
      </header>

      <For each={props.release.intro}>
        {(paragraph) => (
          <p class="changelog-release-intro">
            <ChangelogInline text={paragraph} />
          </p>
        )}
      </For>

      <Show when={props.release.notices.length > 0}>
        <div class="changelog-notice" role="note" aria-labelledby={`${props.release.anchor}-notice`}>
          <p class="changelog-notice-title" id={`${props.release.anchor}-notice`}>
            <span class="changelog-notice-mark" aria-hidden="true">
              !
            </span>
            Action needed after you upgrade
          </p>
          <ul class="changelog-notice-list">
            <For each={props.release.notices}>
              {(notice) => (
                <li class="changelog-notice-item">
                  <ChangelogInline text={notice} />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <For each={props.release.groups}>
        {(group) => (
          <section class="changelog-group" data-type={group.type}>
            <h3 class="changelog-group-title">
              <span class="changelog-group-dot" aria-hidden="true" />
              {groupLabel(group)}
              {/* Hidden from a screen reader, which announces the list's length itself. */}
              <span class="changelog-group-count" aria-hidden="true">
                {group.items.length}
              </span>
            </h3>
            <ul class="changelog-list">
              <For each={group.items}>
                {(item) => (
                  <li class="changelog-item">
                    <ChangelogInline text={item} />
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </article>
  );
}
