// Every line of text in the pastel video, from the first video's copy (see ../copy.ts) and the
// team video's request. The video is English-only.

import { COPY } from "../copy";
import { TEAM_COPY } from "../team/copy";

export const PASTEL_COPY = {
  meet: COPY.meet,
  name: COPY.name,
  teamTitle: ["Persistent", "AI teammates."],
  chatTitle: COPY.team,
  channel: COPY.channel,
  you: TEAM_COPY.you,
  request: TEAM_COPY.request.lines.join(" "),
  requestMention: TEAM_COPY.request.mention,
  messages: TEAM_COPY.messages,
  shipped: TEAM_COPY.shipped,
  modelsTitle: COPY.modelsTitle,
  modelsLine: COPY.modelsLine,
  /** `COPY.tagline` on two lines. */
  tagline: ["Persistent AI teammates", "on your own computer."],
  url: COPY.url,
} as const;
