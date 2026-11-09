import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { PricingPage } from "../components/pricing/PricingPage";
import { readPricingOffer } from "../lib/pricing-offer";

// The pricing page at `/pricing`, `/pl/pricing` and `/pt/pricing`. Each child route loads the text of its
// language, and this layout shows the page, so a change of language changes only the text.
export const Route = createFileRoute("/_pricing")({
  // The offer depends on the visitor's country, not on the language, so a change of language keeps it.
  loader: () => readPricingOffer(),
  shouldReload: false,
  // The VAT line depends on the visitor's country, so a shared cache must not keep the page.
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
