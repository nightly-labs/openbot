import { Show } from "solid-js";
import { COMPARISONS } from "../../content/compare";
import type { ComparePage } from "../../content/compare/comparison";
import type { ContentCollection } from "../../lib/content-collection";
import { DataIndexPage } from "../content/DataIndexPage";
import { CompareMarkRow, CompareMarks } from "./CompareParts";

export interface CompareIndexPageProps {
  collection: ContentCollection<"compare">;
}

export function CompareIndexPage(props: CompareIndexPageProps) {
  return (
    <DataIndexPage
      collection={props.collection}
      title="Compare OpenBot"
      label="Comparisons"
      action="Read the comparison"
      marks={(article) => <Show when={COMPARISONS[article.slug]}>{(page) => <CompareCardMarks page={page()} />}</Show>}
    />
  );
}

function CompareCardMarks(props: { page: ComparePage }) {
  const page = props.page;
  switch (page.kind) {
    case "matchup":
      return (
        <CompareMarks
          small
          sides={[
            { side: "a", ...page.products[0] },
            { side: "b", ...page.products[1] },
          ]}
        />
      );
    case "roundup":
      return <CompareMarkRow apps={page.apps} small />;
    default:
      return (
        <CompareMarks
          small
          sides={[
            { side: "openbot", name: "OpenBot" },
            { side: "rival", name: page.rival.name, mark: page.rival.mark },
          ]}
        />
      );
  }
}
