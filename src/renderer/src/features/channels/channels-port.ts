import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the channels domain reaches in main: channel pages, commands, attachments, and the answers a
 * channel turn waits for.
 */
export interface ChannelsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "channelCommand"
    | "chooseAttachments"
    | "downloadAttachments"
    | "listChannels"
    | "openAttachment"
    | "readChannel"
    | "respondToApproval"
    | "respondToBrowserSecret"
    | "respondToBrowserTakeover"
    | "respondToPrompt"
  >;
  browser: Pick<OpenBotDesktopApi["browser"], "capturePreview">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function channelsPort(): ChannelsPort {
  return window.openbot;
}
