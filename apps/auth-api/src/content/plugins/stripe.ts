import type { PluginGuide } from "./plugin-guide";

// Every statement about Stripe here is taken from docs.stripe.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const STRIPE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Investigate a failed payment",
      text: "The agent reads PaymentIntents, charges and payment methods with stripe_api_read. It can also list the disputes, refunds and events for the same payment. Then it tells you what happened to the payment, and when.",
    },
    {
      title: "Review a customer's billing",
      text: "The agent lists a customer's invoices, subscriptions, credit notes and balance transactions. With stripe_api_write, it can also create, finalize or void an invoice, and update or cancel a subscription, when your permissions allow it.",
    },
    {
      title: "Set up products and links",
      text: "The agent creates products, prices, coupons and promotion codes. Then it makes a payment link or a Checkout Session for them. Test the setup in a sandbox first, and then use it in live mode.",
    },
    {
      title: "Search the Stripe docs",
      text: "The agent searches Stripe's documentation and support articles with search_stripe_documentation. It finds API methods with stripe_api_search, and reads their parameters with stripe_api_details. This helps the agent use the correct parameters before it makes a call.",
    },
  ],
  faq: [
    {
      question: "Is the Stripe MCP server official?",
      answer:
        "Yes. Stripe documents and runs its own MCP server. Its tools read and write data through the Stripe API. They also search the Stripe knowledge base, which includes the documentation and support articles.",
    },
    {
      question: "Does the Stripe plugin need an API key?",
      answer:
        "No. Each user signs in to their own Stripe account through the browser. On Stripe's consent page, you choose the live mode accounts or sandboxes that the agent can use, and set permissions for each. OpenBot keeps the tokens in encrypted storage and adds the Authorization header itself.",
    },
    {
      question: "Can the agent refund a payment by itself?",
      answer:
        "No. Stripe asks a person to confirm some write actions, such as refunds and outbound payments. The agent gives you a URL. Open it, read the request and approve it. Then tell the agent to try again. If you do not approve in 24 hours, the request expires.",
    },
    {
      question: "How do I remove the agent's access to Stripe?",
      answer:
        "Open your Stripe user settings and find the client in the OAuth sessions list. Select Revoke access. A Stripe administrator can also turn MCP access off for the whole team, with one setting for live mode and one for sandboxes.",
    },
  ],
  sources: [{ label: "Stripe: Model Context Protocol (MCP)", url: "https://docs.stripe.com/mcp" }],
  checkedAt: "2026-10-23",
};
