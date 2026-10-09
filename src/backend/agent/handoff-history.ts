import { type ConversationMessage, type ConversationPageAnchor, isContextResetMarker } from "@openbot/contracts/ipc";
import type { OpenBotDatabase } from "../openbot-database";
import { estimateTokens, renderHandoffMessage, summarizeOldMessages } from "./delivery-content";

const HANDOFF_TOKENS = 60_000;
const RECENT_TOKENS = Math.floor(HANDOFF_TOKENS * 0.85);
const SUMMARY_CHARACTERS = (HANDOFF_TOKENS - RECENT_TOKENS) * 4;

/** Read the transcript in pages. Only the prompt budget stays in memory. */
export function readHandoffHistory(
  database: OpenBotDatabase,
  agentId: string,
  threadId: string,
  names: ReadonlyMap<string, string>,
) {
  const recent: ConversationMessage[] = [];
  let recentTokens = 0;
  let olderCount = 0;
  let throughMessageId: string | null = null;
  let summaryLines = "";
  let anchor: ConversationPageAnchor = { type: "latest" };
  let reachedReset = false;
  const summarize = (message: ConversationMessage, prepend: boolean) => {
    // One item at a time, so summary generation does not retain the old transcript.
    const line = summarizeOldMessages([message], 1_000, names).split("\n").slice(1).join("\n");
    summaryLines = (prepend ? `${line}\n${summaryLines}` : `${summaryLines}${line}\n`).slice(0, SUMMARY_CHARACTERS);
    olderCount += 1;
    throughMessageId ??= message.id;
  };
  while (!reachedReset) {
    const page = database.readConversationPage(agentId, threadId, anchor, 50);
    for (const message of page.messages.toReversed()) {
      if (isContextResetMarker(message)) {
        reachedReset = true;
        break;
      }
      if (
        !["user", "assistant", "agent"].includes(message.author) ||
        message.itemType === "commentary" ||
        (message.delivery && !["completed", "failed", "interrupted"].includes(message.delivery.status))
      )
        continue;
      const tokens = estimateTokens(renderHandoffMessage(message, names));
      if (olderCount === 0 && recentTokens + tokens <= HANDOFF_TOKENS) {
        recent.unshift(message);
        recentTokens += tokens;
      } else summarize(message, true);
    }
    if (reachedReset || !page.pageInfo.olderCursor) break;
    anchor = { type: "before", cursor: page.pageInfo.olderCursor };
  }
  if (olderCount > 0) {
    while (recentTokens > RECENT_TOKENS && recent.length) {
      const message = recent.shift();
      if (!message) break;
      recentTokens -= estimateTokens(renderHandoffMessage(message, names));
      summarize(message, false);
      throughMessageId = message.id;
    }
  }
  return {
    recent,
    olderCount,
    throughMessageId,
    summary: () => `Summary of ${olderCount} older user-visible messages:\n${summaryLines}`,
    summarize,
  };
}
