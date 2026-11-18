import { For, Show } from "solid-js";
import type { MobileStore, StoreAvailability } from "../../lib/changelog";

const STORE_LABELS: Record<MobileStore, string> = {
  ios: "iOS",
  android: "Android",
};

// Fixed to UTC for the reason `formatArticleDate` gives: the Worker renders in UTC.
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface ChangelogStoresProps {
  stores: readonly StoreAvailability[];
}

/**
 * The stores that have a mobile version. Each store reviews a build on its own, so a version can
 * reach one store days before the other, or never reach a store that a newer version replaced. A store's day shows only when both stores have the
 * version and the days differ: otherwise it is the release date.
 */
export function ChangelogStores(props: ChangelogStoresProps) {
  const showDays = () =>
    props.stores.every((entry) => entry.date) && new Set(props.stores.map((entry) => entry.date)).size > 1;

  return (
    <Show when={props.stores.length > 0}>
      <span class="changelog-stores">
        <For each={props.stores}>
          {(entry) => (
            <span class="changelog-store" data-state={entry.date ? "available" : entry.skipped ? "skipped" : "review"}>
              <span class="changelog-store-dot" aria-hidden="true" />
              {STORE_LABELS[entry.store]}
              <Show
                when={entry.date}
                fallback={<span class="changelog-store-detail">· {entry.skipped ? "Skipped" : "In review"}</span>}
              >
                {(date) => (
                  <Show when={showDays()}>
                    <time class="changelog-store-detail" datetime={date()}>
                      · {DAY_FORMAT.format(new Date(`${date()}T00:00:00Z`))}
                    </time>
                  </Show>
                )}
              </Show>
            </span>
          )}
        </For>
      </span>
    </Show>
  );
}
