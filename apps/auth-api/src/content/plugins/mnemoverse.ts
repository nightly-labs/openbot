import type { PluginGuide } from "./plugin-guide";

export const MNEMOVERSE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Check what you decided before",
      text: "The memory_read tool searches the memory by meaning, so a question such as what was decided about a project or how you like reports written is enough. The memory_list_recent tool lists the newest entries first and needs no query; use it after a break or to catch up on a shared room.",
    },
    {
      title: "Save what should outlast the chat",
      text: "The memory_write tool stores one short statement that makes sense on its own: a preference, a decision, a fact about a project or a lesson. Concepts (keywords the agent attaches) link related memories, and a domain keeps one project's memory apart from another's.",
    },
    {
      title: "Tell it what helped",
      text: "The memory_feedback tool rates memories that memory_read returned, from -1 (misleading) to 1 (helpful). Later searches rank rated memories higher or lower; a low rating deletes nothing.",
    },
    {
      title: "Share a room with other people",
      text: "The memory_create_room tool makes a shared room, and memory_invite_to_room gives a code to send to someone. Their assistant joins with memory_join_room and can read the room, and write unless the invite is read-only. The memory_list_rooms tool finds rooms again in a new session.",
    },
    {
      title: "See what is stored",
      text: "The memory_stats tool shows how many memories there are and in which domains. The memory_graph tool shows which concepts the memory has linked. The vault_list tool lists stored secrets by alias only; no tool returns a secret value.",
    },
  ],
  faq: [
    {
      question: "Does the Mnemoverse plugin need an API key?",
      answer:
        "No. Select Connect and sign in with your Mnemoverse account in the browser. To use a key, select Use an API key instead, and paste a key from console.mnemoverse.com. Keys start with mk_live_. OpenBot sends the key in the Authorization header and keeps it in encrypted storage.",
    },
    {
      question: "How is Mnemoverse different from the memory of an OpenBot agent?",
      answer:
        "Each OpenBot agent keeps its own memory on the computer that runs OpenBot. Mnemoverse keeps memory in your account, so ChatGPT, Claude, Cursor, VS Code and other tools you connect can read and write it too. Mnemoverse receives only the agent's calls to its tools: text to save, questions and ratings.",
    },
    {
      question: "Which memory does the agent use?",
      answer:
        "Your account's own memory. A domain such as project:acme keeps one project apart. A shared room is read only when the agent passes the room's address as the domain; a search without it does not cover rooms.",
    },
    {
      question: "Can a team use the same memory?",
      answer:
        "Yes, through shared rooms. One person creates a room and invites the others; an invite admits one person unless it is made for more. Joining a room does not open anyone's private memory.",
    },
    {
      question: "What does it cost?",
      answer:
        "The free plan needs no credit card: 1,000 queries a day and 10,000 stored memories. Pro is $29 a month, Team is $149 a month, and Enterprise is priced on request (mnemoverse.com/pricing).",
    },
  ],
  sources: [
    { label: "Mnemoverse", url: "https://mnemoverse.com/" },
    { label: "Mnemoverse: remote MCP server", url: "https://mnemoverse.com/docs/api/remote-mcp-server" },
    { label: "Mnemoverse MCP server on GitHub", url: "https://github.com/mnemoverse/mcp-memory-server" },
  ],
  checkedAt: "2026-11-20",
};
