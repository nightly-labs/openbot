import type { PluginGuide } from "./plugin-guide";

// Every statement about Chatwork here is taken from developer.chatwork.com and from the
// chatwork-mcp-server repository. Each page used is in `sources`. Check the sources again, and
// move `checkedAt`, whenever this file changes.

export const CHATWORK_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read and post messages",
      text: "The agent lists the messages of a room, reads one message, and posts, edits or deletes a message. It can also mark the messages of a room as read or unread. Use it to catch up on a room or to post a status update that you checked first.",
    },
    {
      title: "Manage tasks",
      text: "The agent lists your tasks, lists the tasks of a room, creates a task in a room and changes the status of a task. Use it to turn the action items of a discussion into tasks.",
    },
    {
      title: "Work with rooms and members",
      text: "The agent lists your rooms, creates a room, updates or leaves a room, and lists the members of a room. It can also change the members of a room, and create, update or delete the invitation link of a room.",
    },
    {
      title: "Find files and contacts",
      text: "The agent lists the files of a room and reads the details of one file. It lists your contacts and the contact requests that other people sent you, and it can accept or reject a request.",
    },
  ],
  faq: [
    {
      question: "Is the Chatwork MCP server official?",
      answer:
        "Yes. The server is published on npm as @chatwork/mcp-server by kubell, the company that runs Chatwork. The code is open source under the MIT license. The OpenBot listing runs this package as a local server and names one version.",
    },
    {
      question: "How does the plugin sign in to Chatwork?",
      answer:
        "With an API token, not with a browser sign-in. Chatwork supports OAuth 2.0, but its official MCP server does not use it. Open the menu under your name in Chatwork, choose Service integration, then API token, and type the token in the OpenBot connect dialog. OpenBot gives the token to the local server as the CHATWORK_API_TOKEN environment variable. The plugin catalog holds no secret.",
    },
    {
      question: "Who can get an API token?",
      answer:
        "Chatwork says that, apart from the Personal plan, you need to apply to your organization administrator before you can use the Chatwork API. Chatwork also says that the API token has no expiry and gives full access to its features, so do not share it. The Chatwork API Terms of Use apply to every use of the API.",
    },
    {
      question: "Are there limits on how often the agent can call Chatwork?",
      answer:
        "Yes. Chatwork allows 300 API requests every 5 minutes. Posting messages and adding tasks have a second limit of 10 requests every 10 seconds for each room. Over a limit, Chatwork answers with status 429 and the agent has to wait.",
    },
    {
      question: "What data does Chatwork get?",
      answer:
        "Your workspaces, conversations and files in OpenBot stay on the computer that runs OpenBot. Chatwork gets the requests that the agent sends, for example the text of a message that it posts or the room that it reads. These requests use your Chatwork account and your API token, so the agent acts as you.",
    },
  ],
  sources: [
    {
      label: "Chatwork API: Welcome",
      url: "https://developer.chatwork.com/docs/getting-started",
    },
    {
      label: "Chatwork API: About endpoints",
      url: "https://developer.chatwork.com/docs/endpoints",
    },
    {
      label: "Chatwork API: About OAuth 2.0",
      url: "https://developer.chatwork.com/docs/oauth",
    },
    {
      label: "Chatwork: chatwork-mcp-server repository",
      url: "https://github.com/chatwork/chatwork-mcp-server",
    },
    {
      label: "npm: @chatwork/mcp-server",
      url: "https://www.npmjs.com/package/@chatwork/mcp-server",
    },
    { label: "Chatwork API Terms of Use", url: "https://go.chatwork.com/ja/terms/api.html" },
  ],
  checkedAt: "2026-11-08",
};
