import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { PricingPage } from "../components/pricing/PricingPage";
import { readPricingOffer } from "../lib/pricing-offer";

const PAGE_ROUTES = [
  "/_pricing/pricing",
  "/_pricing/ar/pricing",
  "/_pricing/de/pricing",
  "/_pricing/es/pricing",
  "/_pricing/fr/pricing",
  "/_pricing/he/pricing",
  "/_pricing/it/pricing",
  "/_pricing/ja/pricing",
  "/_pricing/ko/pricing",
  "/_pricing/nl/pricing",
  "/_pricing/pl/pricing",
  "/_pricing/pt/pricing",
  "/_pricing/ru/pricing",
  "/_pricing/tr/pricing",
  "/_pricing/zh/pricing",
] as const;

export const Route = createFileRoute("/_pricing")({
  loader: () => readPricingOffer(),
  shouldReload: false,
  headers: () => ({ "Cache-Control": "no-store" }),
  component: PricingLayout,
});

function PricingLayout() {
  const offer = Route.useLoaderData();
  const pages = PAGE_ROUTES.map((from) => useMatch({ from, shouldThrow: false, select: (match) => match.loaderData }));
  const page = () => pages.map((match) => match()).find((data) => data !== undefined);
  return (
    <>
      <Show when={page()}>
        {(data) => <PricingPage lang={data().lang} locale={data().locale} text={data().text} offer={offer()} />}
      </Show>
      <Outlet />
    </>
  );
}
