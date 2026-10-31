import type { PluginGuide } from "./plugin-guide";

// Every statement about 9bot here is taken from 9bot.com.br and github.com/9-bot/mcp. Each page
// used is in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const NINEBOT_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Look up groups and channels",
      text: "The agent looks up the WhatsApp groups, announcement groups and channels connected to the 9bot account, with their members, administrators, settings and community information. It only sees the groups that the 9bot application is limited to.",
    },
    {
      title: "Write activity reports",
      text: "The reports tools give activity, engagement and behavior data. The agent can say which groups grew the most in the last 30 days, list the most active members, or write a weekly engagement report.",
    },
    {
      title: "Send and schedule messages",
      text: "With full access, the agent sends messages through authorized groups, announcement groups and channels, and schedules one time or recurring communications.",
    },
    {
      title: "Build Workflows and moderate",
      text: "The agent turns a request into a Workflow inside 9bot, such as a message every Friday at 6:00 PM. It can also work with existing automations and commands, and with strikes, penalties and allowlists.",
    },
  ],
  faq: [
    {
      question: "Is 9bot affiliated with WhatsApp or Meta?",
      answer:
        "No. 9bot is an independent company and is not affiliated with, endorsed by, or sponsored by Meta Platforms or WhatsApp. WhatsApp is a trademark of its owner.",
    },
    {
      question: "Does the 9bot plugin need an API key?",
      answer:
        "No. 9bot's server uses OAuth 2.1 with PKCE S256 and dynamic client registration. OpenBot signs in itself, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "What do I set up in 9bot first?",
      answer:
        "In the 9bot Dashboard, open Settings > MCP and enable MCP. Create an application, choose read-only or full access, and limit it to the groups the agent should see. The scopes are 9bot.read_only and 9bot.full_access.",
    },
    {
      question: "Does 9bot cost anything?",
      answer:
        "Yes. 9bot is a paid product and the MCP server needs an active 9bot subscription. New accounts can start a 7-day trial on the 9bot plans page.",
    },
  ],
  sources: [
    { label: "9bot MCP: README", url: "https://github.com/9-bot/mcp" },
    { label: "9bot: MCP guide", url: "https://9bot.com.br/en/mcp/" },
    { label: "9bot: plans", url: "https://9bot.com.br/en/start-now" },
  ],
  checkedAt: "2026-10-28",
};
