import type { PluginGuide } from "./plugin-guide";

// Every statement about Context7 here is taken from context7.com and Upstash's context7
// repository. Each page used is in `sources`. Check the sources again, and move `checkedAt`,
// whenever this file changes.

export const CONTEXT7_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find a library's current API",
      text: "The resolve-library-id tool turns a library name into a Context7 ID, such as /vercel/next.js. Then the query-docs tool gets the documentation and code examples for that library that match the question.",
    },
    {
      title: "Check a version upgrade",
      text: "Context7 gives version-specific documentation from the source of each library. Before an agent changes code for a new major version, it can query the docs of that version and find the APIs that changed.",
    },
    {
      title: "Get examples in your language",
      text: "The query-docs tool has a language input. When the agent gives the programming language of the project, Context7 puts code examples in that language first. This helps with libraries that have SDKs for several languages.",
    },
  ],
  faq: [
    {
      question: "Does the Context7 MCP server need an API key?",
      answer:
        "No. The OpenBot listing uses Context7 with no account and no key. Context7 says that requests without a key get low rate limits. When an agent goes over the limit, Context7 returns an error and tells it when to try again.",
    },
    {
      question: "What data does Context7 get?",
      answer:
        "Context7 gets a search query, the library name or ID, the name and version of the MCP client, and the IP address for rate limits. Context7 says that your full prompt, source code and conversation history are never sent. It stores the queries anonymously to improve its results.",
    },
    {
      question: "Who makes the Context7 MCP server?",
      answer:
        "Upstash makes Context7. The source code of the MCP server is in Upstash's context7 repository on GitHub, under the MIT license. The API, the parser and the crawler that build the documentation index are private.",
    },
    {
      question: "Does Context7 cost anything?",
      answer:
        "Context7 has a free plan with 1,000 API calls each month. The Pro plan costs $10 per seat each month and adds private repositories. The OpenBot listing uses no key, so the limits for requests without a key apply.",
    },
  ],
  sources: [
    { label: "Context7", url: "https://context7.com/" },
    { label: "Context7: introduction", url: "https://context7.com/docs" },
    { label: "Context7: API guide", url: "https://context7.com/docs/api-guide" },
    { label: "Context7: data privacy", url: "https://context7.com/docs/security/data-privacy" },
    { label: "Context7: plans", url: "https://context7.com/plans" },
    { label: "Upstash: context7 repository", url: "https://github.com/upstash/context7" },
  ],
  checkedAt: "2026-10-23",
};
