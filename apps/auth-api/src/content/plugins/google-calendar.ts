import type { PluginGuide } from "./plugin-guide";

// Every statement about Google Calendar here is taken from Google's documentation of the Google Workspace
// MCP servers. Each page used is in `sources`. The statements about the sign-in describe OpenBot's
// own Google sign-in app. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GOOGLE_CALENDAR_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See your day",
      text: "The agent lists your calendars and reads the events on them, with the times, the guests and the details.",
    },
    {
      title: "Find events",
      text: "The agent finds events by text or by date, for example the next meeting with a person.",
    },
    {
      title: "Schedule meetings",
      text: "The agent suggests times when you and the other guests are free and adds the event to your calendar. It can also change and delete events and answer invitations.",
    },
    {
      title: "Prepare for meetings",
      text: "The agent summarizes the meetings of a day or a week, so you know what to prepare.",
    },
  ],
  faq: [
    {
      question: "Is the Calendar MCP server official?",
      answer:
        "Yes. Google hosts the Calendar MCP server at calendarmcp.googleapis.com and documents it on Google for Developers. It is one of the Google Workspace MCP servers, and it has the same permissions and data controls as your Google account.",
    },
    {
      question: "Does the Google Calendar plugin need an API key or Google Cloud setup?",
      answer:
        "No. You click Sign in, choose your Google account, and approve the access on Google's consent page. OpenBot uses its own Google sign-in app, so you do not need a Google Cloud project, an API key or a client ID. OpenBot keeps the tokens in encrypted storage on the computer that runs it and adds the Authorization header itself, so agents never get a token. The exchange of the sign-in code and each token refresh go through OpenBot's Signal service, which adds the sign-in app's secret and stores nothing. Your events do not go through OpenBot's servers: they go directly between your computer and Google.",
    },
    {
      question: "What can the agent see and change in Google Calendar?",
      answer:
        "The agent can read the list of your calendars (calendar.calendarlist.readonly), read your events (calendar.events.readonly), and see when people are free or busy (calendar.events.freebusy). It can also create, change and delete events and answer invitations (calendar.events). A change goes into your real calendar. To remove the access, disconnect Google Calendar in OpenBot.",
    },
    {
      question: "Is the Calendar MCP server finished?",
      answer:
        "Google lists the Calendar MCP server as a Developer Preview, so its tools and limits can change. Google also warns about indirect prompt injection: an event from another person can contain instructions that try to make the agent act for someone else. Check what the agent does after it reads content that you do not trust.",
    },
  ],
  sources: [
    {
      label: "Google: Configure the Google Workspace MCP servers",
      url: "https://developers.google.com/workspace/guides/configure-mcp-servers",
    },
    {
      label: "Google: Configure the Calendar MCP server",
      url: "https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server",
    },
    {
      label: "Google: Calendar API events.insert",
      url: "https://developers.google.com/workspace/calendar/api/v3/reference/events/insert",
    },
  ],
  checkedAt: "2026-10-29",
};
