import type { QueueDelivery } from "@openbot/contracts/ipc";

export function queuedMessagePreview(delivery: QueueDelivery): string {
  return delivery.text.trim() || delivery.attachments.map((file) => file.name).join(", ");
}

interface QueueActionState {
  busy: boolean;
  online: boolean;
  held: QueueDelivery | null;
}

export function queuedMessageLocks(delivery: QueueDelivery, state: QueueActionState) {
  return {
    locked: state.busy || !state.online || Boolean(state.held && state.held.id !== delivery.id),
    editedElsewhere: Boolean(delivery.editing) && state.held?.id !== delivery.id,
    heldForEdit: Boolean(delivery.editing) || state.held?.id === delivery.id,
  };
}
