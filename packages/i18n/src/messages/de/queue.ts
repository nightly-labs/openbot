import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Nachrichtenwarteschlange",
  "queue.moved": "Die Nachricht wurde in der Warteschlange an Position {position} von {total} verschoben.",
  "queue.attachment": "Anhang",
  "queue.hold.named": "Wartet – {name} arbeitet in {channel}",
  "queue.hold.unnamed": "Wartet – dieser Agent arbeitet in {channel}",
  "queue.item.label": "Nachricht {position} in der Warteschlange: {preview}",
  "queue.item.labelEditing": "Nachricht {position} in der Warteschlange, in Bearbeitung: {preview}",
  "queue.item.editing": "In Bearbeitung",
  "queue.item.steerLabel": "Nachricht {position} aus der Warteschlange in die aktuelle Arbeit einbringen",
  "queue.item.steerTooltip": "Nachricht in aktuelle Arbeit einbringen",
  "queue.item.steering": "Wird eingebracht",
  "queue.item.steer": "Steuern",
  "queue.item.notSteered": "Nicht eingebracht",
  "queue.item.steerFallback.providerUnsupported":
    "Dieser Anbieter kann einen laufenden Durchgang nicht steuern. Die Nachricht wartet daher in der Warteschlange.",
  "queue.item.steerFallback.steerFailed":
    "Die Nachricht konnte nicht in die aktuelle Arbeit eingebracht werden und wartet daher in der Warteschlange.",
  "queue.item.deleteLabel": "Nachricht {position} aus der Warteschlange löschen",
  "queue.item.deleteTooltip": "Nachricht löschen",
  "queue.item.editLabel": "Nachricht {position} in der Warteschlange bearbeiten",
  "queue.item.editTooltip": "Nachricht bearbeiten",
  "queue.deleteHeld.title": "Nachricht aus der Warteschlange löschen?",
  "queue.deleteHeld.body": "Ein anderes Gerät bearbeitet diese Nachricht. Der Agent wird sie nicht erhalten.",
  "queue.deleteHeld.keep": "Behalten",
} as const satisfies PartialTranslation<typeof source>;
