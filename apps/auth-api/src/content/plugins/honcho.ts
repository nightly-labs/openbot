import type { PluginGuide } from "./plugin-guide";

// Every statement about Honcho here is taken from honcho.dev and the Honcho repository. Each page
// used is in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const HONCHO_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Ask what Honcho knows about you",
      text: "The chat tool answers a question about one peer from what Honcho learned across that peer's conversations. The workspace_chat tool asks across all peers. Both take a reasoning_level from minimal to max; the default is low. Use minimal for fast lookups and high or max when depth matters.",
    },
    {
      title: "Record a conversation",
      text: "The create_session tool makes a session for a conversation, and create_peer makes a peer: any participant, human or AI. The add_peers_to_session tool adds peers and sets which ones Honcho observes. The add_messages_to_session tool records both sides of each exchange.",
    },
    {
      title: "Read stored memory quickly",
      text: "The search, get_representation, get_peer_context and list_conclusions tools read what Honcho already has, with no new reasoning. They are faster than chat when the agent needs only the stored facts.",
    },
    {
      title: "Keep the memory in order",
      text: "The set_peer_card tool sets the short biographical card of a peer by hand. The schedule_dream tool starts a memory consolidation in the background. The list_workspaces and create_workspace tools find or make the workspace that holds the memory.",
    },
  ],
  faq: [
    {
      question: "Does the Honcho plugin need an API key?",
      answer:
        "No. Select Connect and sign in with your Honcho account in the browser. To use a key, select Use an API key instead, and type a key from app.honcho.dev. Hosted keys start with hch-. OpenBot sends the key in the Authorization header and keeps it in encrypted storage.",
    },
    {
      question: "Which workspace does the agent use?",
      answer:
        "Each Honcho tool that works on a workspace takes a workspace_id. The agent names the workspace on each call, and it can use list_workspaces to find it. To keep one workspace, tell the agent its name, for example in its instructions.",
    },
    {
      question: "How is Honcho different from the memory of an OpenBot agent?",
      answer:
        "Each OpenBot agent has its own memory, which stays on the computer that runs OpenBot. Honcho is a memory that other AI tools you connect to the same account can share. Your OpenBot workspaces, conversations and files stay on the computer that runs OpenBot. Only the messages and questions that an agent sends to Honcho tools go to Honcho.",
    },
    {
      question: "Can I run Honcho on my own computer?",
      answer:
        "Yes, but not from this listing, which connects to the hosted server. Honcho can run locally with Docker. Its MCP server is the mcp package in the Honcho repository, pointed at your own instance with HONCHO_API_URL. Over HTTP it uses port 3000 and serves MCP at /mcp. Add it in the MCP servers settings.",
    },
  ],
  sources: [
    { label: "Honcho", url: "https://honcho.dev/" },
    { label: "Honcho: MCP integration", url: "https://honcho.dev/docs/v3/guides/integrations/mcp" },
    {
      label: "Honcho: MCP server instructions",
      url: "https://github.com/plastic-labs/honcho/blob/main/mcp/instructions.md",
    },
  ],
  checkedAt: "2026-11-10",
};
