import { Show } from "solid-js";
import { PROVIDER_PAGES } from "../../content/providers";
import type { ContentCollection } from "../../lib/content-collection";
import { DataIndexPage } from "../content/DataIndexPage";
import { ProviderMarks } from "./ProviderMarks";

export interface ProvidersIndexPageProps {
  collection: ContentCollection<"providers">;
}

export function ProvidersIndexPage(props: ProvidersIndexPageProps) {
  return (
    <DataIndexPage
      collection={props.collection}
      title={props.collection.indexTitle}
      label="Providers"
      action="Set it up"
      marks={(article) => (
        <Show when={PROVIDER_PAGES[article.slug]}>{(page) => <ProviderMarks page={page()} small />}</Show>
      )}
    />
  );
}
