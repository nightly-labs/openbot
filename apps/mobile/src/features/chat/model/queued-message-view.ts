import type { QueueDelivery } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";

export function queuedMessagePreview(delivery: QueueDelivery, t: MobileTranslate): string {
  if (delivery.sender.kind === "routine") return t("mobile.chat.queue.routine", { name: delivery.sender.routineName });
  return delivery.text.trim() || delivery.attachments.map((file) => file.name).join(", ");
}

export function runsInNewThread(delivery: QueueDelivery): boolean {
  return delivery.sender.kind === "user";
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
