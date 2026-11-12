import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { TeamsPage } from "../components/teams/TeamsPage";

// The Teams page at `/teams`, `/pl/teams` and `/pt/teams`. Each child route loads the text of its language,
// and this layout shows the page, so a change of language changes only the text.
export const Route = createFileRoute("/_teams")({
  component: TeamsLayout,
});

function TeamsLayout() {
  const english = useMatch({ from: "/_teams/teams", shouldThrow: false, select: (match) => match.loaderData });
  const polish = useMatch({ from: "/_teams/pl/teams", shouldThrow: false, select: (match) => match.loaderData });
  const portuguese = useMatch({ from: "/_teams/pt/teams", shouldThrow: false, select: (match) => match.loaderData });
  const page = () => english() ?? polish() ?? portuguese();
  return (
    <>
      <Show when={page()}>{(data) => <TeamsPage lang={data().lang} text={data().text} />}</Show>
      <Outlet />
    </>
  );
}
