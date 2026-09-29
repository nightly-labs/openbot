import { AppLogo } from "@openbot/brand";
import { createFileRoute } from "@tanstack/solid-router";

/** The page that the Stripe Customer Portal opens when a desktop user goes back. */
export const Route = createFileRoute("/billing/return")({
  head: () => ({
    meta: [{ title: "OpenBot billing" }, { name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: BillingReturn,
});

function BillingReturn() {
  return (
    <main class="join-page">
      <section class="join-card" aria-labelledby="billing-return-title">
        <AppLogo variant="production" class="join-card-logo" />
        <h1 id="billing-return-title">Billing updated</h1>
        <p class="join-card-copy">Go back to OpenBot. You can close this page.</p>
      </section>
    </main>
  );
}
