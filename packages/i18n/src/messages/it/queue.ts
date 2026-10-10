import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Coda dei messaggi",
  "queue.moved": "Messaggio in coda spostato alla posizione {position} di {total}.",
  "queue.attachment": "Allegato",
  "queue.hold.named": "In attesa - {name} sta lavorando in {channel}",
  "queue.hold.unnamed": "In attesa - questo agente sta lavorando in {channel}",
  "queue.item.label": "Messaggio in coda {position}: {preview}",
  "queue.item.labelEditing": "Messaggio in coda {position}, in modifica: {preview}",
  "queue.item.editing": "In modifica",
  "queue.item.steerLabel": "Indirizza il messaggio in coda {position}",
  "queue.item.steerTooltip": "Indirizza il messaggio",
  "queue.item.steering": "Indirizzamento",
  "queue.item.steer": "Indirizza",
  "queue.item.notSteered": "Non indirizzato",
  "queue.item.steerFallback.providerUnsupported":
    "Questo provider non può indirizzare un turno in corso, quindi il messaggio resta in coda.",
  "queue.item.steerFallback.steerFailed": "L'indirizzamento non è riuscito, quindi il messaggio resta in coda.",
  "queue.item.deleteLabel": "Elimina il messaggio in coda {position}",
  "queue.item.deleteTooltip": "Elimina messaggio",
  "queue.item.editLabel": "Modifica il messaggio in coda {position}",
  "queue.item.editTooltip": "Modifica messaggio",
  "queue.deleteHeld.title": "Eliminare il messaggio in coda?",
  "queue.deleteHeld.body": "Un altro dispositivo sta modificando questo messaggio. L'agente non lo riceverà.",
  "queue.deleteHeld.keep": "Mantieni",
} as const satisfies PartialTranslation<typeof source>;
