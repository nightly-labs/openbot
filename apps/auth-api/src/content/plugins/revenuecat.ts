import type { PluginGuide } from "./plugin-guide";

// Every statement about RevenueCat here is taken from revenuecat.com/docs. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const REVENUECAT_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Set up products and offerings",
      text: "The agent reads and changes apps, products, entitlements, offerings and packages in your RevenueCat project. It can attach products to entitlements and packages, and inspect product prices, availability and review metadata in App Store Connect and Google Play Console.",
    },
    {
      title: "Look up customers",
      text: "The agent finds a customer by email, app user ID or transaction ID. It reads the customer's subscriptions, one-time purchases, entitlements and event history, so it can tell you why a customer has or does not have access.",
    },
    {
      title: "Read revenue and experiments",
      text: "The agent reads the overview metrics for the last 28 days, the revenue for a date range, time-series data for each chart, and benchmark comparisons. It also reads experiment results for each variant, and with a write key it can start, pause and stop experiments.",
    },
    {
      title: "Work on paywalls",
      text: "The agent lists your paywalls, reads their settings and renders a screenshot of a paywall. With a write key, it asks the RevenueCat AI editor to create or change a paywall, attaches offerings, and publishes or unpublishes paywalls.",
    },
  ],
  faq: [
    {
      question: "Is the RevenueCat MCP server official?",
      answer: "Yes. RevenueCat hosts the MCP server at mcp.revenuecat.ai and documents it as part of its AI Toolkit.",
    },
    {
      question: "Which key does the RevenueCat plugin need?",
      answer:
        "A secret API key for the REST API v2. The key starts with sk_ and reaches one project. Project Admins create secret keys under API keys in the RevenueCat dashboard. Type the key in the connect dialog in OpenBot. OpenBot sends it as a bearer token in the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent see and change in RevenueCat?",
      answer:
        "The MCP server shows only the tools that your key permits. With a read-only key, the agent can only read. With a write key, it can create apps and products, submit products to the App Store for review, publish paywalls, grant entitlements to customers, and delete packages and webhooks. To stop the access, revoke the key in the RevenueCat dashboard.",
    },
    {
      question: "Why does OpenBot not sign in to RevenueCat in the browser?",
      answer:
        "RevenueCat supports OAuth for its MCP server, but it does not let clients register themselves. Each OAuth client must be added to an allowlist by RevenueCat support. Until RevenueCat adds OpenBot, a browser sign-in stops with a message that the sign-in server does not accept OpenBot. Connect with a secret API key instead.",
    },
  ],
  sources: [
    {
      label: "RevenueCat: MCP server",
      url: "https://www.revenuecat.com/docs/tools/mcp",
    },
    {
      label: "RevenueCat: MCP tools reference",
      url: "https://www.revenuecat.com/docs/tools/mcp/tools-reference",
    },
    {
      label: "RevenueCat: MCP best practices and troubleshooting",
      url: "https://www.revenuecat.com/docs/tools/mcp/best-practices-and-troubleshooting",
    },
    {
      label: "RevenueCat: API keys",
      url: "https://www.revenuecat.com/docs/projects/authentication",
    },
  ],
  checkedAt: "2026-11-04",
};
