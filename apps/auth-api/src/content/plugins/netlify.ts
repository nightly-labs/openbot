import type { PluginGuide } from "./plugin-guide";

// Every statement about Netlify here is taken from docs.netlify.com and from Netlify's
// official MCP server repository on github.com. Each page used is in `sources`. Check the
// sources again, and move `checkedAt`, whenever this file changes.

export const NETLIFY_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Check projects and deploys",
      text: "The netlify-project-services-reader tool reads your projects and their forms. The netlify-deploy-services-reader tool reads a deploy, or the deploys of a project. The agent can tell you which deploy is live and which one failed.",
    },
    {
      title: "Deploy a project",
      text: "The netlify-deploy-services-updater tool deploys code to an existing Netlify project. It gives a command that the agent runs in the project folder. The command uploads the code and runs a build on Netlify. The netlify-project-services-updater tool can also create a new project.",
    },
    {
      title: "Find errors in request logs",
      text: "The netlify-observability-services-reader tool counts and ranks the edge requests of a project, and lists single request log entries. The agent can find which URLs returned server errors, and when an error burst started.",
    },
    {
      title: "Manage settings and extensions",
      text: "The netlify-project-services-updater tool reads and changes environment variables, turns Netlify Forms on or off, and sets visitor access with a password or team login. The netlify-extension-services-updater tool installs or removes extensions for a team.",
    },
  ],
  faq: [
    {
      question: "Is the Netlify MCP server official?",
      answer:
        "Yes. Netlify calls it its official MCP server and recommends the remote server at netlify-mcp.netlify.app. The source code is public on GitHub.",
    },
    {
      question: "Does the Netlify plugin need an API key?",
      answer:
        "No. You sign in with your own Netlify account in the browser. OpenBot signs in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What can the agent change in Netlify?",
      answer:
        "The agent has the same access as your Netlify account. It can create projects, deploy code, rename projects, and change environment variables, forms and visitor access. It can install or remove extensions. It can also delete form submissions and environment variables, and Netlify cannot undo these deletes. Netlify gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "How far back can the agent read request logs?",
      answer:
        "It depends on your Netlify team plan. The tool description gives typical limits: 24 hours on the free plan, 7 days on Pro and Business, and 30 days on Enterprise.",
    },
  ],
  sources: [
    {
      label: "Netlify: MCP server support",
      url: "https://docs.netlify.com/build/build-with-ai/agent-setup-guides/agent-setup-overview/#mcp-server-support",
    },
    {
      label: "Netlify: Use Netlify with ChatGPT",
      url: "https://docs.netlify.com/build/build-with-ai/agent-setup-guides/use-netlify-with-chatgpt/",
    },
    { label: "Netlify: netlify-mcp repository", url: "https://github.com/netlify/netlify-mcp" },
  ],
  checkedAt: "2026-10-26",
};
