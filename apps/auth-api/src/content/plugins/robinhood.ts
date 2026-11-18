import type { PluginGuide } from "./plugin-guide";

// Every statement about Robinhood here is taken from robinhood.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const ROBINHOOD_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Review your accounts",
      text: "The agent has read access to all your Robinhood accounts, positions, balances and transaction history. It can summarize your holdings, explain a change in value, or find a past transaction.",
    },
    {
      title: "Follow the market",
      text: "The market data and watchlist tools let the agent read prices and your watchlists. It can tell you how the stocks on a watchlist moved, or compare two companies.",
    },
    {
      title: "Trade in the Agentic account",
      text: "The agent can place long equities, options and crypto orders in your Robinhood Agentic account: market orders by shares or by dollars, limit, stop limit and stop market orders. It cannot place multi-leg options orders, and it cannot transfer, stake or lend crypto.",
    },
  ],
  faq: [
    {
      question: "Is the Robinhood MCP server official?",
      answer:
        "Yes. Robinhood hosts the trading MCP server at agent.robinhood.com and names it in its support articles about agentic trading. Robinhood calls Agentic Trading a beta.",
    },
    {
      question: "Which account can the agent trade in?",
      answer:
        "Only in a separate Robinhood Agentic account. You need an open primary Robinhood individual investing account first. When you sign in for the first time, Robinhood asks you to open the Agentic account. The agent cannot trade in your other Robinhood accounts.",
    },
    {
      question: "Does the agent ask before it places an order?",
      answer:
        "Not by default. For external agents, Robinhood turns trade approvals off by default, so the agent can place eligible orders without your confirmation of each one. Turn on trade approvals in the Agent settings of the Robinhood app: the agent then proposes orders, and you place them yourself in the app.",
    },
    {
      question: "Does the Robinhood plugin need an API key?",
      answer:
        "No. You sign in to your own Robinhood account in the browser. OpenBot does the sign-in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret. To stop the access, disconnect Robinhood in OpenBot or in the Robinhood app.",
    },
  ],
  sources: [
    {
      label: "Robinhood: Onboarding an external agent",
      url: "https://robinhood.com/us/en/support/articles/onboarding-an-external-agent/",
    },
    {
      label: "Robinhood: Setting up an agent",
      url: "https://robinhood.com/us/en/support/articles/setting-up-an-agent/",
    },
    {
      label: "Robinhood: Trading with your agent",
      url: "https://robinhood.com/us/en/support/articles/trading-with-your-agent/",
    },
  ],
  checkedAt: "2026-11-04",
};
