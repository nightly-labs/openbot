import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { LandingPage } from "../components/landing/LandingPage";

const PAGE_ROUTES = [
  "/_home/",
  "/_home/ar",
  "/_home/de",
  "/_home/es",
  "/_home/fr",
  "/_home/he",
  "/_home/it",
  "/_home/ja",
  "/_home/ko",
  "/_home/nl",
  "/_home/pl",
  "/_home/pt",
  "/_home/ru",
  "/_home/tr",
  "/_home/zh",
] as const;

export const Route = createFileRoute("/_home")({
  component: HomeLayout,
});

function HomeLayout() {
  const pages = PAGE_ROUTES.map((from) => useMatch({ from, shouldThrow: false, select: (match) => match.loaderData }));
  const page = () => pages.map((match) => match()).find((data) => data !== undefined);
  return (
    <>
      <Show when={page()}>{(data) => <LandingPage text={data().text} />}</Show>
      <Outlet />
    </>
  );
}
