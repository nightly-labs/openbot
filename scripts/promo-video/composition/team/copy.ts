// Every line of text in the team video. The agent messages and the closing line are the first
// video's (see ../copy.ts); the opening request is new. The video is English-only.

import { COPY } from "../copy";

export const TEAM_COPY = {
  you: "You",
  youInitial: "Y",
  channel: COPY.channel,
  request: { lines: ["Ship the launch", "page by Friday."], mention: "@Researcher" },
  messages: [
    { name: "Researcher", text: "Found 12 sources.", mention: "@Writer", after: "over to you." },
    { name: "Writer", text: "Draft is in the workspace.", mention: "@Designer", after: "" },
    { name: "Designer", text: "Hero images are done.", mention: "@Engineer", after: "" },
    { name: "Engineer", text: "Shipped to staging.", mention: "", after: "" },
  ],
  shipped: "Shipped",
  tagline: COPY.team.join(" "),
  url: COPY.url,
} as const;
