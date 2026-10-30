import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Berichtenwachtrij",
  "queue.moved": "Bericht in wachtrij verplaatst naar positie {position} van {total}.",
  "queue.attachment": "Bijlage",
  "queue.hold.named": "Wachten - {name} is bezig in {channel}",
  "queue.hold.unnamed": "Wachten - deze agent is bezig in {channel}",
  "queue.item.label": "Bericht in wachtrij {position}: {preview}",
  "queue.item.labelEditing": "Bericht in wachtrij {position}, wordt bewerkt: {preview}",
  "queue.item.editing": "Bewerken",
  "queue.item.steerLabel": "Bijsturen met bericht in wachtrij {position}",
  "queue.item.steerTooltip": "Bijsturen met bericht",
  "queue.item.steering": "Bijsturen",
  "queue.item.steer": "Bijsturen",
  "queue.item.notSteered": "Niet bijgestuurd",
  "queue.item.steerFallback.providerUnsupported":
    "Deze aanbieder kan een lopende beurt niet bijsturen, dus het bericht wacht in de wachtrij.",
  "queue.item.steerFallback.steerFailed": "Bijsturen is niet gelukt, dus het bericht wacht in de wachtrij.",
  "queue.item.runAsTask": "Uitvoeren in nieuwe thread",
  "queue.item.runAsTaskLabel": "Bericht in wachtrij {position} uitvoeren in een nieuwe thread",
  "queue.item.deleteLabel": "Bericht in wachtrij {position} verwijderen",
  "queue.item.deleteTooltip": "Bericht verwijderen",
  "queue.item.editLabel": "Bericht in wachtrij {position} bewerken",
  "queue.item.editTooltip": "Bericht bewerken",
  "queue.deleteHeld.title": "Bericht in wachtrij verwijderen?",
  "queue.deleteHeld.body": "Een ander apparaat bewerkt dit bericht. De agent ontvangt het niet.",
  "queue.deleteHeld.keep": "Bewaren",
} as const satisfies PartialTranslation<typeof source>;
