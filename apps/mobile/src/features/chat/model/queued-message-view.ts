import type { QueueDelivery } from "@openbot/contracts/ipc";

/** A queued row shows its text, or the file names when the message is attachments only. */
export function queuedMessagePreview(delivery: QueueDelivery): string {
  return delivery.text.trim() || delivery.attachments.map((file) => file.name).join(", ");
}

/** The queue state that decides which actions one queued message has. */
interface QueueActionState {
  busy: boolean;
  online: boolean;
  /** The message that this phone holds for editing. */
  held: QueueDelivery | null;
}

/**
 * The lock rule of one queued message. The queue sheet and the rows above the composer use it,
 * so the two places always offer the same actions.
 */
export function queuedMessageLocks(delivery: QueueDelivery, state: QueueActionState) {
  return {
    // Editing holds one delivery on the host: our own hold locks every other row until it ends.
    locked: state.busy || !state.online || Boolean(state.held && state.held.id !== delivery.id),
    // Another device holds this one. Only confirmed deletion remains available.
    editedElsewhere: Boolean(delivery.editing) && state.held?.id !== delivery.id,
    // The host keeps a message under an edit hold in the queue, also when the hold is this phone's.
    heldForEdit: Boolean(delivery.editing) || state.held?.id === delivery.id,
  };
}
