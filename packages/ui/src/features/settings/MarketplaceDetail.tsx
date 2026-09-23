import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { MarketplaceIdentity } from "./MarketplaceCatalog";

export function MarketplaceDetail(props: {
  name: string;
  description: string;
  creatorName: string;
  creatorAvatarUrl?: string | null;
  icon: JSX.Element;
  action: JSX.Element;
  sections: Array<{ title: string; subtitle: string; content: () => JSX.Element }>;
}) {
  const [selected, setSelected] = createSignal(0);
  const [height, setHeight] = createSignal<string>();
  /*
   * Card resize (transitions.dev 01). The panel keeps its own box and tweens between the measured
   * heights of the two contents, so the switch resizes the box while only the content inside it
   * plays the swap. The observer follows the content the keyed block builds, and it also answers a
   * reflow, such as a window resize that rewraps the text.
   */
  const bodySize = new ResizeObserver(([entry]) => {
    setHeight(`${entry.target.getBoundingClientRect().height}px`);
  });
  onCleanup(() => bodySize.disconnect());
  const measureBody = (element: HTMLDivElement) => {
    bodySize.disconnect();
    bodySize.observe(element);
  };
  return (
    <section
      class="skills-marketplace-detail marketplace-detail-page"
      aria-label={`${props.name} details`}
      /* The way back is the header crumb, so the page itself takes the focus the row gave up. */
      tabindex="-1"
      ref={(element) => queueMicrotask(() => element.focus())}
    >
      <div class="marketplace-detail-heading">
        {/* The icon, the name with the creator under it, and the one action the page offers read as
            one line, as the page title of the item. */}
        <div class="marketplace-detail-main">
          <MarketplaceIdentity
            item={{
              id: "detail",
              name: props.name,
              description: props.description,
              creatorName: props.creatorName,
              creatorAvatarUrl: props.creatorAvatarUrl,
            }}
          >
            {props.icon}
          </MarketplaceIdentity>
          <div class="marketplace-detail-copy">
            <h1>{props.name}</h1>
            <p class="marketplace-detail-creator">By {props.creatorName}</p>
          </div>
          <div class="marketplace-detail-action">{props.action}</div>
        </div>
        <p class="marketplace-detail-lead">{props.description}</p>
      </div>
      <div class="marketplace-detail-sections">
        <nav aria-label="Detail sections">
          <For each={props.sections}>
            {(section, index) => (
              <Button
                variant="ghost"
                aria-pressed={selected() === index() ? "true" : "false"}
                data-active={selected() === index() ? "" : undefined}
                onClick={() => setSelected(index())}
              >
                <span>{section.title}</span>
                <small>{section.subtitle}</small>
              </Button>
            )}
          </For>
        </nav>
        <section
          class="marketplace-detail-section t-resize"
          aria-label={props.sections[selected()]?.title}
          style={{ height: height() }}
        >
          {/* Keyed on the chosen section, so picking another one builds the content again and its
              entering transition runs on every switch. The box around it stays. */}
          <Show when={props.sections[selected()]} keyed>
            {(section) => (
              <div class="marketplace-detail-section-body" ref={measureBody}>
                {section.content()}
              </div>
            )}
          </Show>
        </section>
      </div>
    </section>
  );
}
