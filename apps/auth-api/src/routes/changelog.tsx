import { createFileRoute } from "@tanstack/solid-router";
import { ChangelogPage } from "../components/changelog/ChangelogPage";
import { changelogHead, changelogSearch } from "../lib/changelog";

export const Route = createFileRoute("/changelog")({
  validateSearch: changelogSearch,
  head: ({ match }) => changelogHead(match.context.siteUrl, match.search.platform),
  component: ChangelogRoute,
});

function ChangelogRoute() {
  const search = Route.useSearch();
  return <ChangelogPage platform={search().platform ?? "desktop"} />;
}
