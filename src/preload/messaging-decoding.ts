// What main answers for the Slack connection of an agent. These guard the renderer; the host replies
// that main receives have their own decoders.

import {
  isMessagingOverview,
  isMessagingThread,
  isSlackOverview,
  type MessagingOverview,
  type MessagingThread,
  type SlackOverview,
} from "@openbot/contracts/ipc";

export function decodeMessagingOverviewReply(value: unknown): MessagingOverview {
  if (!isMessagingOverview(value)) throw new Error("Invalid messaging overview response.");
  return value;
}

export function decodeMessagingThreadReply(value: unknown): MessagingThread {
  if (!isMessagingThread(value)) throw new Error("Invalid messaging thread response.");
  return value;
}

export function decodeSlackOverviewReply(value: unknown): SlackOverview {
  if (!isSlackOverview(value)) throw new Error("Invalid Slack overview response.");
  return value;
}
