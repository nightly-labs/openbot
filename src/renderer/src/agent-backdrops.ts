import { chatBackdropChange, chatBackdropRequesters } from "@openbot/contracts/chat-visual";
import { toast } from "@openbot/ui";
import { type ChatBackdropChoice, customBackdropChoice } from "@openbot/ui/features/conversation/chat-backdrop";
import { currentText } from "@openbot/ui/text";
import { setChatBackdrop, useChatBackdrop } from "./chat-backdrop-preference";
import { addCustomBackdrop, readCustomBackdrop } from "./custom-backdrops";

const MARK_STORAGE_KEY = "openbot:agent-backdrop-mark";

let unsavedMark: number | undefined;

function readMark(): number {
  if (unsavedMark !== undefined) return unsavedMark;
  try {
    const value = Number(window.localStorage.getItem(MARK_STORAGE_KEY));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {}
  return writeMark(Date.now());
}

function writeMark(time: number): number {
  try {
    window.localStorage.setItem(MARK_STORAGE_KEY, String(time));
    unsavedMark = undefined;
  } catch {
    unsavedMark = time;
  }
  return time;
}

if (typeof window !== "undefined") readMark();

function agentSlot(agentId: string): string {
  return `agent-${agentId}`;
}

const pending = new Set<string>();
const failed = new Set<string>();
const requesters = new Map<string, readonly string[]>();
let queue: Promise<void> = Promise.resolve();

interface BackdropMessage<Attachment extends { mimeType: string }> {
  id: string;
  createdAt?: string | undefined;
  itemType?: string | null | undefined;
  attachments?: readonly Attachment[] | null | undefined;
}

async function undoAction(slot: string, choice: ChatBackdropChoice): Promise<() => void> {
  const previous = useChatBackdrop()();
  if (previous !== choice) return () => setChatBackdrop(previous);
  const old = await readCustomBackdrop(slot);
  if (!old) return () => setChatBackdrop(null);
  const bytes = new Uint8Array(await old.blob.arrayBuffer());
  return () => {
    void addCustomBackdrop({ id: slot, name: old.name, mimeType: old.mimeType, bytes }).catch(() => {
      setChatBackdrop(null);
    });
  };
}

function removeBackdrop(time: number): void {
  if (readMark() >= time) return;
  writeMark(time);
  const previous = useChatBackdrop()();
  if (previous === null) return;
  setChatBackdrop(null);
  const { t } = currentText();
  toast(t("chat.backdrop.agentRemoved"), {
    action: {
      label: t("chat.backdrop.undo"),
      onClick: () => {
        if (useChatBackdrop()() === null) setChatBackdrop(previous);
      },
    },
  });
}

export function showNewAgentBackdrop<
  Attachment extends { mimeType: string },
  Message extends BackdropMessage<Attachment>,
>(
  agentId: string,
  messages: readonly Message[],
  page: {
    title: (message: Message) => string;
    bytes: (attachment: Attachment) => Promise<Uint8Array>;
    isReader: (senderId: string) => boolean;
  },
): void {
  const mark = readMark();
  let newest: { message: Message; attachment: Attachment; clear: boolean; time: number } | undefined;
  for (const message of messages) {
    const change = chatBackdropChange<Attachment>(message);
    const time = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    if (!change || !(time > mark) || (newest && newest.time >= time)) continue;
    if (pending.has(message.id) || failed.has(message.id)) continue;
    if (requesters.get(message.id)?.some(page.isReader) === false) continue;
    newest = { message, ...change, time };
  }
  if (!newest) return;
  const { message, attachment, clear, time } = newest;
  pending.add(message.id);
  queue = queue.then(async () => {
    const { t } = currentText();
    try {
      if (readMark() >= time) return;
      const title = page.title(message);
      const bytes = await page.bytes(attachment);
      const askedBy = chatBackdropRequesters(new TextDecoder().decode(bytes));
      requesters.set(message.id, askedBy);
      if (!askedBy.some(page.isReader)) return;
      if (clear) {
        removeBackdrop(time);
        return;
      }
      const slot = agentSlot(agentId);
      const choice = customBackdropChoice(slot);
      const undo = await undoAction(slot, choice);
      if (readMark() >= time) return;
      await addCustomBackdrop({ id: slot, name: title, mimeType: attachment.mimeType, bytes });
      writeMark(time);
      setChatBackdrop(choice);
      toast(t("chat.backdrop.agentSet", { name: title }), {
        action: { label: t("chat.backdrop.undo"), onClick: undo },
      });
    } catch {
      failed.add(message.id);
    } finally {
      pending.delete(message.id);
    }
  });
}
