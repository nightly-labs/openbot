import type { PluginGuide } from "./plugin-guide";

// Every statement about Composio here is taken from docs.composio.dev. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const COMPOSIO_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find the right app action",
      text: "Composio does not list every app tool at once. The agent uses COMPOSIO_SEARCH_TOOLS to find the tools that match a task. Then it uses COMPOSIO_GET_TOOL_SCHEMAS to read the inputs that those tools need.",
    },
    {
      title: "Work across several apps",
      text: "The COMPOSIO_MULTI_EXECUTE_TOOL tool runs one or more tools across your connected apps in one call. For example, an agent can read new Gmail messages, check a GitHub repository and post a summary to Slack.",
    },
    {
      title: "Connect an app when needed",
      text: "The first time an agent needs an app, Composio makes an OAuth link that you approve in your browser. COMPOSIO_MANAGE_CONNECTIONS creates, lists, renames and removes connections. COMPOSIO_WAIT_FOR_CONNECTIONS waits until you finish the sign-in.",
    },
    {
      title: "Run code in a sandbox",
      text: "The COMPOSIO_REMOTE_WORKBENCH tool runs Python in a remote sandbox, and COMPOSIO_REMOTE_BASH_TOOL runs bash there. The agent can use them to sort, filter or convert the data that other Composio tools return.",
    },
  ],
  faq: [
    {
      question: "Does the Composio plugin need an API key?",
      answer:
        "Yes. Type the MCP URL and your consumer API key from your Composio account, in Settings > Sessions & API Key. OpenBot sends the key in the x-consumer-api-key header. If you regenerate the key, Composio stops the old key at once, so type the new key in OpenBot.",
    },
    {
      question: "Which apps can the Composio MCP server reach?",
      answer:
        "Composio says one connection gives access to more than 1,000 apps. Accounts that you connected in the developer dashboard are not available here. Connect them again through the consumer flow. A connected account belongs to the person who authorized it.",
    },
    {
      question: "Is the Composio MCP server official?",
      answer:
        "Yes. Composio runs this server for consumer MCP clients. It gives seven meta-tools that search, connect and run the tools of your apps, and does not list each app tool directly.",
    },
    {
      question: "What data does Composio get?",
      answer:
        "Composio gets the tool calls that the agent sends, with their inputs, and runs them on the apps that you connected. Your app connections stay in your Composio account. Your OpenBot workspaces, conversations and files stay on the computer that runs OpenBot. Composio's own plan limits apply.",
    },
  ],
  sources: [
    {
      label: "Composio: connect an MCP client",
      url: "https://docs.composio.dev/docs/composio-connect",
    },
    {
      label: "Composio: consumer project boundaries and auth selection",
      url: "https://docs.composio.dev/kb/guide/consumer-project-boundaries-and-auth-selection",
    },
    { label: "Composio: Platform or For You", url: "https://docs.composio.dev/docs" },
  ],
  checkedAt: "2026-10-23",
};
