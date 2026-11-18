import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { LandingPage } from "../components/landing/LandingPage";

// The home page at `/`, `/pl` and `/pt`. Each child route loads the text of its language, and this layout
// shows the page. A change of language then changes only the text: the page, its animations and the app
// preview stay.
export const Route = createFileRoute("/_home")({
  component: HomeLayout,
});

function HomeLayout() {
  const english = useMatch({ from: "/_home/", shouldThrow: false, select: (match) => match.loaderData });
  const polish = useMatch({ from: "/_home/pl", shouldThrow: false, select: (match) => match.loaderData });
  const portuguese = useMatch({ from: "/_home/pt", shouldThrow: false, select: (match) => match.loaderData });
  const page = () => english() ?? polish() ?? portuguese();
  return (
    <>
      <Show when={page()}>{(data) => <LandingPage text={data().text} />}</Show>
      <Outlet />
    </>
  );
}
