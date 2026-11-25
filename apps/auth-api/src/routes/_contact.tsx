import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { ContactPage } from "../components/contact/ContactPage";

const PAGE_ROUTES = [
  "/_contact/contact",
  "/_contact/ar/contact",
  "/_contact/de/contact",
  "/_contact/es/contact",
  "/_contact/fr/contact",
  "/_contact/he/contact",
  "/_contact/it/contact",
  "/_contact/ja/contact",
  "/_contact/ko/contact",
  "/_contact/nl/contact",
  "/_contact/pl/contact",
  "/_contact/pt/contact",
  "/_contact/ru/contact",
  "/_contact/tr/contact",
  "/_contact/zh/contact",
] as const;

export const Route = createFileRoute("/_contact")({
  component: ContactLayout,
});

function ContactLayout() {
  const pages = PAGE_ROUTES.map((from) => useMatch({ from, shouldThrow: false, select: (match) => match.loaderData }));
  const page = () => pages.map((match) => match()).find((data) => data !== undefined);
  return (
    <>
      <Show when={page()}>{(data) => <ContactPage lang={data().lang} text={data().text} />}</Show>
      <Outlet />
    </>
  );
}
