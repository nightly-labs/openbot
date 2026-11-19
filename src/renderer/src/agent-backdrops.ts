import { chatBackdropPage, chatBackdropRequesters } from "@openbot/contracts/chat-visual";
import { toast } from "@openbot/ui";
import { type ChatBackdropChoice, customBackdropChoice } from "@openbot/ui/features/conversation/chat-backdrop";
import { currentText } from "@openbot/ui/text";
import { setChatBackdrop, useChatBackdrop } from "./chat-backdrop-preference";
import { addCustomBackdrop, readCustomBackdrop } from "./custom-backdrops";

/**
 * The pages that an agent puts behind the window with `set_backdrop`. The host keeps each one as a
 * chat message (`CHAT_BACKDROP_ITEM_TYPE`), so a joined server and the web client need no other
 * event. Each client shows the newest backdrop message once, in the one slot of its agent, so a
 * changed scene replaces the scene before it.
 *
 * A message older than the mark does not change the backdrop: the history of a chat, a message that
 * this device showed before, or one from before this device first ran this code. The mark is per
 * device and browser, like the backdrop choice.
 */

const MARK_STORAGE_KEY = "openbot:agent-backdrop-mark";

let unsavedMark: number | undefined;

function readMark(): number {
  if (unsavedMark !== undefined) return unsavedMark;
  try {
    const value = Number(window.localStorage.getItem(MARK_STORAGE_KEY));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // Blocked storage keeps the mark for this page only.
  }
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

// The first read sets the mark, so the history of a chat that loads later stays in the chat.
if (typeof window !== "undefined") readMark();

/** The slot of an agent: each new page of that agent replaces the one before. */
function agentSlot(agentId: string): string {
  return `agent-${agentId}`;
}

/** The message ids that wait or run now. A second update of the chat does not add them again. */
const pending = new Set<string>();
/** The message ids whose page could not be read or kept. This page does not fetch them again. */
const failed = new Set<string>();
/**
 * The people who asked for each page that this page read. A page that another member asked for stays
 * off this window. The reader can be known later, such as when the team roster loads, so the ids stay
 * and each update asks again with no second read of the page.
 */
const requesters = new Map<string, readonly string[]>();
/** One page goes behind the window at a time, so an older page cannot replace a newer one. */
let queue: Promise<void> = Promise.resolve();

interface BackdropMessage<Attachment extends { mimeType: string }> {
  id: string;
  createdAt?: string | undefined;
  itemType?: string | null | undefined;
  attachments?: readonly Attachment[] | null | undefined;
}

/** The action that puts back the backdrop before the agent's page. */
async function undoAction(slot: string, choice: ChatBackdropChoice): Promise<() => void> {
  const previous = useChatBackdrop()();
  if (previous !== choice) return () => setChatBackdrop(previous);
  // The agent replaces its own page: keep the old page, so Undo can put it back in the slot.
  const old = await readCustomBackdrop(slot);
  if (!old) return () => setChatBackdrop(null);
  const bytes = new Uint8Array(await old.blob.arrayBuffer());
  return () => {
    void addCustomBackdrop({ id: slot, name: old.name, mimeType: old.mimeType, bytes }).catch(() => {
      setChatBackdrop(null);
    });
  };
}

/**
 * Shows the newest backdrop message of one agent's chat when it is newer than the mark and the reader
 * asked for it. `title` and `bytes` read the page title and the page file of that message, and
 * `isReader` tells whether a sender id is the reader.
 */
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
  let newest: { message: Message; attachment: Attachment; time: number } | undefined;
  for (const message of messages) {
    const attachment = chatBackdropPage<Attachment>(message);
    const time = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    if (!attachment || !(time > mark) || (newest && newest.time >= time)) continue;
    if (pending.has(message.id) || failed.has(message.id)) continue;
    if (requesters.get(message.id)?.some(page.isReader) === false) continue;
    newest = { message, attachment, time };
  }
  if (!newest) return;
  const { message, attachment, time } = newest;
  pending.add(message.id);
  queue = queue.then(async () => {
    const { t } = currentText();
    try {
      // A newer page, from this or another window, went behind the window first.
      if (readMark() >= time) return;
      const title = page.title(message);
      const bytes = await page.bytes(attachment);
      const askedBy = chatBackdropRequesters(new TextDecoder().decode(bytes));
      requesters.set(message.id, askedBy);
      // On a joined server, another member asked for this page. It stays in the chat only.
      if (!askedBy.some(page.isReader)) return;
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
      // A page that cannot be read or kept does not change the backdrop.
      failed.add(message.id);
    } finally {
      pending.delete(message.id);
    }
  });
}
