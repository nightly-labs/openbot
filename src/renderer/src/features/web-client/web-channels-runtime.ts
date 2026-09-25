import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent, AttachmentSummary, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import type { ChannelsPort } from "../channels/channels-port";
import { createWebAttachmentFiles, openWebLink } from "./web-attachments";
import type { WebWorkspaceRuntime } from "./web-runtime";

const unavailable = async (): Promise<never> => {
  throw new Error("This action is available in the desktop app.");
};

/** The browser's file chooser. A dismissed chooser answers with no files. */
function chooseFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    // The chooser needs the click that started this call, so nothing may be awaited before it.
    input.click();
  });
}

/**
 * The channels runtime of the browser client: the same channel UI as the desktop, sent over the host
 * connection instead of preload. Files are chosen with the browser's chooser and uploaded as drafts.
 */
export function createWebChannelsPort(
  remote: WebWorkspaceRuntime,
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void,
): ChannelsPort {
  const files = createWebAttachmentFiles(remote);
  const channels = remote.channels;
  return {
    agent: {
      listChannels: channels?.listChannels ?? unavailable,
      readChannel: channels?.readChannel ?? unavailable,
      channelCommand: channels?.channelCommand ?? unavailable,
      listChannelMemories: channels?.listChannelMemories ?? unavailable,
      createChannelMemory: channels?.createChannelMemory ?? unavailable,
      updateChannelMemory: channels?.updateChannelMemory ?? unavailable,
      deleteChannelMemory: channels?.deleteChannelMemory ?? unavailable,
      clearChannelMemories: channels?.clearChannelMemories ?? unavailable,
      listChannelRoutines: channels?.listChannelRoutines ?? unavailable,
      listChannelRoutineRuns: channels?.listChannelRoutineRuns ?? unavailable,
      createChannelRoutine: channels?.createChannelRoutine ?? unavailable,
      updateChannelRoutine: channels?.updateChannelRoutine ?? unavailable,
      deleteChannelRoutine: channels?.deleteChannelRoutine ?? unavailable,
      testChannelRoutine: channels?.testChannelRoutine ?? unavailable,
      onEvent: (listener) =>
        onHostEvent((event) => {
          if (event.type === "channel-memories-changed" || event.type === "channel-routines-changed") listener(event);
        }),
      async chooseAttachments() {
        const chosen = await chooseFiles();
        if (chosen.length > INPUT_LIMITS.attachments)
          throw new Error(`A message can have up to ${INPUT_LIMITS.attachments} attachments.`);
        const uploaded: AttachmentSummary[] = [];
        try {
          for (const file of chosen) uploaded.push(await remote.upload(file));
        } catch (error) {
          await Promise.allSettled(uploaded.map((attachment) => remote.discard(attachment.id)));
          throw error;
        }
        return uploaded;
      },
      openAttachment: ({ attachmentId }) => files.download(attachmentId),
      respondToApproval: (input) => remote.approve(input),
      respondToPrompt: (input) => remote.answer(input),
      respondToBrowserTakeover: (input) => remote.respondToTakeover(input),
      respondToBrowserSecret: (input) => remote.respondToBrowserSecret?.(input) ?? unavailable(),
    },
    browser: { capturePreview: remote.browserPreview ?? unavailable },
    openUrl: openWebLink,
    fileActions: "browser",
    previewAttachment: files.preview,
  };
}
