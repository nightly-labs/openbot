import type { PluginGuide } from "./plugin-guide";

// Every statement about Coinbase here is taken from docs.cdp.coinbase.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const COINBASE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read prices and markets",
      text: "The products_list and products_get tools list the tradable products and give their prices. The products_book tool reads the order book, and products_candles gives the price history as OHLCV candles. The agent can compare assets or tell you how a price moved.",
    },
    {
      title: "Review balances and orders",
      text: "The balance, portfolios_list and portfolios_get tools read your balances and portfolios. The orders_list, orders_get and orders_fills tools read your orders and their fills, and fees reads your fee tier. The agent can summarize your holdings or explain an order.",
    },
    {
      title: "Preview and place orders",
      text: "The orders_preview tool estimates an order and places nothing. The orders_create, orders_edit and orders_cancel tools place, change and cancel orders. The convert_quote and convert_execute tools convert one asset to another. Ask the agent to preview first when you want to check an order before it uses funds.",
    },
    {
      title: "Move funds between portfolios",
      text: "The transfer tool moves funds between your own Coinbase portfolios. The agent can also create, edit and delete portfolios.",
    },
  ],
  faq: [
    {
      question: "Is the Coinbase MCP server official?",
      answer:
        "Yes. Coinbase hosts the MCP server at agents.coinbase.com and documents it as Coinbase for Agents on its developer site. Coinbase says that it approves MCP clients through an allow list. If Coinbase refuses the sign-in, the client is not on that list yet.",
    },
    {
      question: "Does the Coinbase plugin need an API key?",
      answer:
        "No. The MCP server uses OAuth. You sign in to your own Coinbase account in the browser. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "Can an agent spend my money on Coinbase?",
      answer:
        "Yes. The order, conversion and x402 payment tools use real funds. Coinbase says that you are responsible for reviewing and authorizing each trade, transfer and account change that an agent makes. Ask the agent to preview an order first. To stop the access, disconnect Coinbase.",
    },
    {
      question: "Which fees and rules apply to orders?",
      answer:
        "Coinbase says that the Advanced Trade fees and eligibility requirements apply to orders that an agent places. US Derivatives trade only in the default portfolio. x402 payments come from the USDC balance of your Coinbase account.",
    },
  ],
  sources: [
    {
      label: "Coinbase Developer Platform: Coinbase MCP",
      url: "https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/coinbase-mcp",
    },
  ],
  checkedAt: "2026-11-04",
};
