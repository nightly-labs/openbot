import type { QueueDelivery } from "@openbot/contracts/ipc";

/** A queued row shows its text, or the file names when the message is attachments only. */
export function queuedMessagePreview(delivery: QueueDelivery): string {
  return delivery.text.trim() || delivery.attachments.map((file) => file.name).join(", ");
}
