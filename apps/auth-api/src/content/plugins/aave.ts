import type { PluginGuide } from "./plugin-guide";

// Every statement about Aave here is taken from aave.com. Each page used is in `sources`.
// Check the sources again, and move `checkedAt`, whenever this file changes.

export const AAVE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Compare lending rates",
      text: "The get_markets tool lists the reserves on a chain, with rates, caps and the liquidity that is left. The get_apy_history tool gives the supply or borrow APY of a reserve over a time window. The agent can compare these numbers across Aave V3 and V4.",
    },
    {
      title: "Check a wallet's health",
      text: "The get_user_positions tool returns the supplies and borrows of a wallet. The get_user_summary tool gives the aggregate position and the health factor. The get_user_activity tool lists the transaction history, and get_user_rewards shows the claimable rewards on every supported chain.",
    },
    {
      title: "Simulate before you sign",
      text: "The preview_action tool simulates a supply, borrow, withdraw or repay against a wallet's position. It reports the resulting health factor and commits nothing. Then prepare_action builds the transaction. The transaction comes back unsigned, and you sign it in your own wallet.",
    },
    {
      title: "Follow DAO governance",
      text: "The search_governance_proposals tool lists Aave DAO proposals by state, or searches their text. The get_governance_proposal tool gives one proposal in full, with its quorum conditions. The get_proposal_votes tool lists the voters by voting power, and get_user_vote shows how one wallet voted.",
    },
  ],
  faq: [
    {
      question: "Is the Aave MCP server official?",
      answer:
        "Yes. Aave announced the official Aave MCP server on its blog. The server covers Aave V3 and V4 markets, positions, governance and transaction preparation. The OpenBot listing connects to this server.",
    },
    {
      question: "Does the Aave plugin need an API key?",
      answer:
        "No. Aave's docs say that the endpoint needs no key today. Aave calls the server a shared service. Thus, the agent must not poll it too often, and it can get rate-limit responses.",
    },
    {
      question: "Can an AI agent move my funds through Aave?",
      answer:
        "No. Aave says that the server holds no private keys and cannot move funds. Every transaction that the server builds comes back unsigned. You sign it in your own wallet, and your wallet is the last gate before anything reaches a chain.",
    },
    {
      question: "What data does Aave get?",
      answer:
        "Aave gets the requests that the agent sends, for example a wallet address or a proposal to look up. Your OpenBot workspaces, conversations and files stay on the computer that runs OpenBot. Installing the plugin is free.",
    },
  ],
  sources: [
    { label: "Aave: Introducing the Aave MCP server", url: "https://aave.com/blog/introducing-aave-mcp-server" },
    { label: "Aave MCP: Getting started", url: "https://aave.com/docs/mcp/getting-started" },
    { label: "Aave MCP: Safety", url: "https://aave.com/docs/mcp/safety" },
    { label: "Aave MCP: Tools", url: "https://aave.com/docs/mcp/tools" },
  ],
  checkedAt: "2026-10-23",
};
