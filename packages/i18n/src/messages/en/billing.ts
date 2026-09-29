import { defineMessages } from "../../message";

export const messages = defineMessages("billing", {
  // The Billing tab in Settings and the Billing dialog in the web client.
  "billing.title": "Billing",
  "billing.description": "Each server has its own plan. Stripe handles the payment.",
  "billing.loading": "Loading billing…",
  "billing.unavailable": "Billing is not available on this account server.",
  "billing.loadFailed": "Could not load billing.",
  "billing.portalFailed": "Could not open billing management.",
  "billing.servers.title": "Server plans",
  "billing.manage": "Payment method and invoices",
  "billing.opening": "Opening…",
  "billing.empty": "None of your servers has a plan.",
  "billing.paymentFailed": "A payment failed. Update the payment method to keep the plan.",
  "billing.interval.month": "Monthly",
  "billing.interval.year": "Yearly",
  "billing.plan.starter": "Starter",
  "billing.plan.standard": "Standard",
  "billing.plan.pro": "Pro",
  "billing.server.unnamed": "Unnamed server",
  // For example "Standard · 50 GB".
  "billing.server.summary": "{plan} · {size} GB",
  // {amount} is a formatted price, for example "€40".
  "billing.server.price.month": "{amount} / month",
  "billing.server.price.year": "{amount} / year",
  "billing.server.renews": "Renews on {date}",
  "billing.server.ends": "Ends on {date}",
  "billing.status.trialing": "Trial",
  "billing.status.paymentFailed": "Payment failed",
  "billing.status.paused": "Paused",
  "billing.action.menu": "Plan actions for {server}",
  "billing.action.change": "Change plan",
  "billing.action.cancel": "Cancel plan",
  "billing.action.renew": "Renew plan",
  "billing.action.updatePayment": "Update payment method",
});
