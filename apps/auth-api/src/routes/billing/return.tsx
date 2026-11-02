import { AppLogo } from "@openbot/brand";
import { readFirstTouch } from "@openbot/contracts/first-touch";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { onSettled, Show } from "solid-js";
import { billingReturnText } from "../../components/transactional/page-text";
import { TransactionalPage } from "../../components/transactional/TransactionalPage";
import { BILLING_RETURN_KINDS, type BillingReturnKind, landingAnalytics } from "../../lib/analytics";
import { loadPageText } from "../../lib/page-text";

/** The page that Stripe Checkout and the Customer Portal open when a desktop user goes back. */
export const Route = createFileRoute("/billing/return")({
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  // A cancelled Checkout comes back with `cancelled=1`, and the router reads a number from the query.
  // The router also validates the search that it wrote, so `true` must stay true. A page that was
  // not cancelled keeps the key out of its URL. `kind` names the Stripe page that closed; an older
  // account service sends no `kind`, and an unknown value is dropped.
  validateSearch: (value): { cancelled?: true; kind?: BillingReturnKind } => {
    if (!isDynamicRecord(value)) return {};
    const cancelled = value.cancelled === 1 || value.cancelled === "1" || value.cancelled === true;
    return {
      ...(cancelled ? { cancelled: true } : {}),
      ...(isOneOf(BILLING_RETURN_KINDS, value.kind) ? { kind: value.kind } : {}),
    };
  },
  loader: ({ context }) => loadPageText(context.locale, billingReturnText),
  head: ({ loaderData }) => ({
    meta: [
      ...(loaderData ? [{ title: loaderData.text.pageTitle }] : []),
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: BillingReturn,
});

/**
 * After a desktop checkout, sends the Checkout Session ID with the first website visit of this
 * browser, so that reports can name the source of the account. The ID is then removed from the URL.
 */
function sendCheckoutAttribution(): void {
  const url = new URL(window.location.href);
  const sessionId = url.searchParams.get("checkout");
  if (!sessionId) return;
  url.searchParams.delete("checkout");
  window.history.replaceState(window.history.state, "", url);
  const firstTouch = readFirstTouch(() => window.localStorage, Date.now());
  if (!firstTouch) return;
  void fetch("/api/browser/checkout-attribution", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    // The page has no referrer; the account service still needs the Origin header of this site.
    referrerPolicy: "same-origin",
    headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
    body: JSON.stringify({ sessionId, firstTouch }),
  }).catch(() => undefined);
}

function BillingReturn() {
  const search = Route.useSearch();
  const page = Route.useLoaderData();
  const text = () => page().text;
  onSettled(() => {
    sendCheckoutAttribution();
    return landingAnalytics.startBillingReturn(document, window.location.hostname, {
      cancelled: search().cancelled === true,
      kind: search().kind,
    });
  });
  return (
    <TransactionalPage titleId="billing-return-title" lang={page().lang}>
      <AppLogo variant="production" class="join-card-logo" />
      <Show
        when={search().cancelled}
        fallback={
          <>
            <h1 id="billing-return-title">{text().updatedTitle}</h1>
            <p class="join-card-copy">{text().updatedBody}</p>
          </>
        }
      >
        <h1 id="billing-return-title">{text().cancelledTitle}</h1>
        <p class="join-card-copy">{text().cancelledBody}</p>
      </Show>
    </TransactionalPage>
  );
}
