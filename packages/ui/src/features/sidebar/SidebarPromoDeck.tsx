import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";

export interface SidebarPromoCard {
  id: string;
  label: string;
  content: () => JSX.Element;
}

export function SidebarPromoDeck(props: { cards: readonly SidebarPromoCard[] }) {
  const [chosenId, setChosenId] = createSignal<string | null>(null);
  const active = createMemo(() => props.cards.find((card) => card.id === chosenId()) ?? props.cards[0]);
  return (
    <Show when={active()}>
      {(card) => (
        <div class="sidebar-promo-deck">
          <Show when={card()} keyed>
            {(shown) => <div class="sidebar-promo-deck-card">{shown.content()}</div>}
          </Show>
          <Show when={props.cards.length > 1}>
            <div class="sidebar-promo-deck-dots">
              <For each={props.cards} keyed={(entry) => entry.id}>
                {(entry) => (
                  <Button
                    type="button"
                    variant="ghost"
                    class="sidebar-promo-deck-dot"
                    aria-label={entry().label}
                    aria-current={entry().id === card().id ? "true" : undefined}
                    data-cuelume-tap="navigate"
                    onClick={() => setChosenId(entry().id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
