import { createFileRoute } from "@tanstack/solid-router";
import { ChangelogPage } from "../components/changelog/ChangelogPage";
import { changelogHead } from "../lib/changelog";

export const Route = createFileRoute("/changelog")({
  head: ({ match }) => changelogHead(match.context.siteUrl),
  component: ChangelogRoute,
});

function ChangelogRoute() {
  return <ChangelogPage />;
}
