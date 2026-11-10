import type { PluginGuide } from "./plugin-guide";

// Every statement about Hindsight here is taken from hindsight.vectorize.io and
// docs.hindsight.vectorize.io. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

export const HINDSIGHT_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Retain what the agent learns",
      text: "The retain tool stores facts and events from a conversation in a memory bank, and sync_retain waits until they are stored. Hindsight keeps the time and the entities of each memory, so a later recall can find them by meaning, by time or by name.",
    },
    {
      title: "Recall before work starts",
      text: "The recall tool finds the memories that match a question. The list_memories and get_memory tools read stored memories one by one, and clear_memories deletes them.",
    },
    {
      title: "Reflect and keep mental models",
      text: "The reflect tool reasons over the memories of a bank to answer a question. The mental model tools, such as create_mental_model, get_mental_model and refresh_mental_model, make, read and update the mental models of a bank.",
    },
    {
      title: "Keep a bank for each project",
      text: "This listing connects to the multi-bank address, so the agent also gets list_banks, create_bank and get_bank_stats. Each tool takes an optional bank_id, and the agent can keep one bank for each project or person.",
    },
  ],
  faq: [
    {
      question: "Does the Hindsight plugin need an API key?",
      answer:
        "No. Select Connect and sign in to Hindsight Cloud in the browser. You choose the organization that OpenBot can use, and only an Owner or an Admin of the organization can approve. To use a key, select Use an API key instead, and type a key from the Connect page of Hindsight Cloud. Keys start with hsk_. OpenBot keeps the key in encrypted storage.",
    },
    {
      question: "Which memory bank does the agent use?",
      answer:
        'The agent names a bank on each call, and it can use list_banks to find one. When the agent names no bank, Hindsight uses the bank "default" and makes it on first use. Memories in "default" do not show in other banks, so tell the agent which bank to use, for example in its instructions.',
    },
    {
      question: "Does Hindsight Cloud cost anything?",
      answer:
        "Hindsight Cloud uses a prepaid credit balance. Retain and recall are charged by token. Reflect and the mental model and page tools are charged by call. Memories kept for more than 30 days have a storage charge. The Billing page of Hindsight Cloud shows the current rates.",
    },
    {
      question: "Can I run Hindsight on my own computer?",
      answer:
        "Yes, but not from this listing, which connects to Hindsight Cloud. Hindsight is open source and the self-hosted server has the same MCP tools at http://localhost:8888/mcp. It needs no key unless you turn on API keys. Add it in the MCP servers settings. Then the memories stay on your computer.",
    },
  ],
  sources: [
    { label: "Hindsight", url: "https://hindsight.vectorize.io/" },
    { label: "Hindsight on PyPI", url: "https://pypi.org/project/hindsight-api/" },
    { label: "Hindsight: MCP integration", url: "https://docs.hindsight.vectorize.io/mcp" },
    { label: "Hindsight: MCP server", url: "https://hindsight.vectorize.io/developer/mcp-server" },
    { label: "Hindsight Cloud", url: "https://hindsight.vectorize.io/cloud-enterprise/hindsight-cloud" },
    { label: "Hindsight: native MCP OAuth", url: "https://hindsight.vectorize.io/blog/2026/03/30/mcp-oauth-native" },
  ],
  checkedAt: "2026-11-10",
};
