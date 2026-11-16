import { chatBackdropPage } from "@openbot/contracts/chat-visual";
import { toast } from "@openbot/ui";
import { customBackdropChoice } from "@openbot/ui/features/conversation/chat-backdrop";
import { currentText } from "@openbot/ui/text";
import { setChatBackdrop, useChatBackdrop } from "./chat-backdrop-preference";
import { addCustomBackdrop } from "./custom-backdrops";

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

/** The message ids that this page puts behind the window now. A second update of the chat waits. */
const applying = new Set<string>();

interface BackdropMessage<Attachment extends { mimeType: string }> {
  id: string;
  createdAt?: string | undefined;
  itemType?: string | null | undefined;
  attachments?: readonly Attachment[] | null | undefined;
}

/**
 * Shows the newest backdrop message of one agent's chat when it is newer than the mark. `title` and
 * `bytes` read the page title and the page file of that message.
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
  },
): void {
  const mark = readMark();
  let newest: { message: Message; attachment: Attachment; time: number } | undefined;
  for (const message of messages) {
    const attachment = chatBackdropPage<Attachment>(message);
    const time = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    if (!attachment || !(time > mark) || (newest && newest.time >= time)) continue;
    newest = { message, attachment, time };
  }
  if (!newest || applying.has(newest.message.id)) return;
  const { message, attachment, time } = newest;
  applying.add(message.id);
  void (async () => {
    const { t } = currentText();
    try {
      const title = page.title(message);
      const id = await addCustomBackdrop({
        id: agentSlot(agentId),
        name: title,
        mimeType: attachment.mimeType,
        bytes: await page.bytes(attachment),
      });
      // Another window or update of the chat can show it first.
      if (readMark() >= time) return;
      writeMark(time);
      const previous = useChatBackdrop()();
      const choice = customBackdropChoice(id);
      setChatBackdrop(choice);
      if (previous === choice) return;
      toast(t("chat.backdrop.agentSet", { name: title }), {
        action: { label: t("chat.backdrop.undo"), onClick: () => setChatBackdrop(previous) },
      });
    } catch {
      // A page that cannot be read or kept does not change the backdrop, and a later update tries again.
    } finally {
      applying.delete(message.id);
    }
  })();
}
