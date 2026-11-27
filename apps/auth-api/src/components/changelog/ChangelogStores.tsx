import { For, Show } from "solid-js";
import type { MobileStore, StoreAvailability } from "../../lib/changelog";

const STORE_LABELS: Record<MobileStore, string> = {
  ios: "iOS",
  android: "Android",
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface ChangelogStoresProps {
  stores: readonly StoreAvailability[];
}

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
