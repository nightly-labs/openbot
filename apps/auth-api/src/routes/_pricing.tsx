import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { PricingPage } from "../components/pricing/PricingPage";
import { readPricingOffer } from "../lib/pricing-offer";

export const Route = createFileRoute("/_pricing")({
  loader: () => readPricingOffer(),
  shouldReload: false,
  headers: () => ({ "Cache-Control": "no-store" }),
  component: PricingLayout,
});

function PricingLayout() {
  const offer = Route.useLoaderData();
  const english = useMatch({ from: "/_pricing/pricing", shouldThrow: false, select: (match) => match.loaderData });
  const polish = useMatch({ from: "/_pricing/pl/pricing", shouldThrow: false, select: (match) => match.loaderData });
  const portuguese = useMatch({
    from: "/_pricing/pt/pricing",
    shouldThrow: false,
    select: (match) => match.loaderData,
  });
  const page = () => english() ?? polish() ?? portuguese();
  return (
    <>
      <Show when={page()}>
        {(data) => <PricingPage lang={data().lang} locale={data().locale} text={data().text} offer={offer()} />}
      </Show>
      <Outlet />
    </>
  );
}
