import { createFileRoute, Outlet, useMatch } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { LandingPage } from "../components/landing/LandingPage";
import { ReferralPage } from "../components/landing/ReferralPage";
import { loadReferralLanding, referralSearch } from "../lib/referral-landing";

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
  validateSearch: referralSearch,
  loaderDeps: ({ search }) => ({ ref: search.ref }),
  loader: ({ deps }) => loadReferralLanding(deps.ref),
  component: HomeLayout,
});

function HomeLayout() {
  const pages = PAGE_ROUTES.map((from) => useMatch({ from, shouldThrow: false, select: (match) => match.loaderData }));
  const page = () => pages.map((match) => match()).find((data) => data !== undefined);
  const referral = Route.useLoaderData();
  return (
    <>
      <Show when={page()}>
        {(data) => (
          <Show when={referral()} keyed fallback={<LandingPage text={data().text} />}>
            {(landing) => (
              <ReferralPage
                text={data().text.referral}
                invite={landing.invite}
                offer={landing.offer}
                lang={data().lang}
                locale={data().locale}
              />
            )}
          </Show>
        )}
      </Show>
      <Outlet />
    </>
  );
}
