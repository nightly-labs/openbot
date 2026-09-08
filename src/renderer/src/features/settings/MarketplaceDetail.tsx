import type { JSX } from "@solidjs/web";
import { createSignal, For } from "solid-js";
import { ArrowLeft, Button, IconButton } from "../../components/ui";
import { MarketplaceIdentity } from "./MarketplaceCatalog";

export function MarketplaceDetail(props: {
  name: string;
  description: string;
  creatorName: string;
  creatorAvatarUrl?: string | null;
  icon: JSX.Element;
  action: JSX.Element;
  onBack: () => void;
  backLabel: string;
  sections: Array<{ title: string; subtitle: string; content: () => JSX.Element }>;
}) {
  const [selected, setSelected] = createSignal(0);
  return (
    <section class="skills-marketplace-detail marketplace-detail-page" aria-label={`${props.name} details`}>
      <IconButton
        class="marketplace-detail-back"
        variant="ghost"
        label={props.backLabel}
        onClick={props.onBack}
        ref={(element) => queueMicrotask(() => element.focus())}
      >
        <ArrowLeft />
      </IconButton>
      <div class="marketplace-detail-heading">
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
        <div class="marketplace-detail-action">{props.action}</div>
        <div class="marketplace-detail-copy">
          <h1>{props.name}</h1>
          <p class="marketplace-detail-creator">By {props.creatorName}</p>
          <p>{props.description}</p>
        </div>
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
        <section class="marketplace-detail-section" aria-label={props.sections[selected()]?.title}>
          {props.sections[selected()]?.content()}
        </section>
      </div>
    </section>
  );
}
