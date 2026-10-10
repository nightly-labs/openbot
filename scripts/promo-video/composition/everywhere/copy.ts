// Every line of text in the everywhere video. The app words are the English catalog strings, from
// packages/i18n/src/messages/en/ (chat.ts, composer.ts, sidebar.ts, mobile/chat.ts and
// mobile/liveActivity.ts), and the tab title is apps/auth-api/src/routes/app.tsx. The claims stay
// true: the web app and the iPhone app connect to the computer that runs OpenBot (PRIVACY.md), so
// the video does not say "synced" or "cloud". The video is English-only.

import { COPY } from "../copy";

export const EVERYWHERE_COPY = {
  request: ["Plan", "Friday's", "launch."],
  agent: COPY.agentName,
  team: ["Researcher", "Writer", "Designer", "Engineer"],
  /** The account shelf on the web. Not checked against the web app. */
  you: "Y",
  youName: "You",
  /** chat.activity.workingOnIt */
  working: "Working on it…",
  /** chat.taskList.title and chat.taskList.count */
  tasks: "Tasks",
  count: (done: number, total: number) => `${done}/${total}`,
  steps: ["Find sources", "Write the brief", "Draft the page", "Schedule the posts"],
  /** composer.placeholder.message */
  composer: `Message ${COPY.agentName}`,
  /** mobile.chat.composer.ask */
  phoneComposer: `Ask ${COPY.agentName}`,
  /** sidebar.search.label */
  search: "Search chats",
  /** sidebar.state.working */
  thinking: "Thinking",
  tab: "OpenBot web",
  url: "openbot.run/app",
  time: "9:41",
  island: {
    /** mobile.liveActivity.badge.working */
    working: "Working",
    /** mobile.liveActivity.badge.message */
    message: "Message",
    /** mobile.liveActivity.unread */
    unread: "1 unread",
    reply: "Launch plan is ready.",
  },
  captions: [
    ["Start", "on", "your", "computer."],
    ["Check", "in", "from", "any", "browser."],
    ["Follow", "it", "on", "your", "iPhone."],
  ],
  tagline: "One team. Every screen.",
  line: "Live from your own computer.",
  site: COPY.url,
} as const;
