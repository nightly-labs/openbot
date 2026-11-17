import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";

/** A visible host acknowledgement, not a second runnable copy of a routed request. */
export const SERVER_WORK_RECEIPT_ITEM_TYPE = "custom_work_route_receipt";
const MARKDOWN_PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** A work title remains plain text; it cannot turn the receipt into a link or instruction. */
export function serverWorkReceiptText(title: string): string {
  const safeTitle = Array.from(redactText(title).slice(0, INPUT_LIMITS.agentTaskTitle))
    .map((character) => (MARKDOWN_PUNCTUATION.includes(character) ? `\\${character}` : character))
    .join("");
  return sourceText("status.agent.workRequestRouted", { title: safeTitle });
}

export interface PreparedServerWorkReceipt {
  threadId: string;
  activeTurnId: string | null;
  text: string;
  /** Runs only after the mailbox and acknowledgement commit together. */
  publish(message: ConversationMessage, revision: number): void;
}

/** Do not interpret provider text or an ordinary task message as a host receipt. */
export function isServerWorkReceipt(message: ConversationMessage): boolean {
  return (
    message.source === "system" &&
    message.author === "agent" &&
    message.itemType === SERVER_WORK_RECEIPT_ITEM_TYPE &&
    message.status === "completed" &&
    message.turnId === undefined &&
    message.delivery === undefined &&
    message.exchange === undefined
  );
}
