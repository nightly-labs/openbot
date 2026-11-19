import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { TeamsPage } from "../components/teams/TeamsPage";

const PAGE_ROUTES = [
  "/_teams/teams",
  "/_teams/ar/teams",
  "/_teams/de/teams",
  "/_teams/es/teams",
  "/_teams/fr/teams",
  "/_teams/he/teams",
  "/_teams/it/teams",
  "/_teams/ja/teams",
  "/_teams/ko/teams",
  "/_teams/nl/teams",
  "/_teams/pl/teams",
  "/_teams/pt/teams",
  "/_teams/ru/teams",
  "/_teams/tr/teams",
  "/_teams/zh/teams",
] as const;

export const Route = createFileRoute("/_teams")({
  component: TeamsLayout,
});

function TeamsLayout() {
  const pages = PAGE_ROUTES.map((from) => useMatch({ from, shouldThrow: false, select: (match) => match.loaderData }));
  const page = () => pages.map((match) => match()).find((data) => data !== undefined);
  return (
    <>
      <Show when={page()}>{(data) => <TeamsPage lang={data().lang} text={data().text} />}</Show>
      <Outlet />
    </>
  );
}
