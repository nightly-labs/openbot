import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "File d’attente des messages",
  "queue.moved": "Message en attente déplacé en position {position} sur {total}.",
  "queue.attachment": "Pièce jointe",
  "queue.hold.named": "En attente - {name} travaille dans {channel}",
  "queue.hold.unnamed": "En attente - cet agent travaille dans {channel}",
  "queue.item.label": "Message en attente {position} : {preview}",
  "queue.item.labelEditing": "Message en attente {position}, en cours de modification : {preview}",
  "queue.item.editing": "Modification",
  "queue.item.steerLabel": "Orienter le message en attente {position}",
  "queue.item.steerTooltip": "Orienter le message",
  "queue.item.steering": "Orientation",
  "queue.item.steer": "Orienter",
  "queue.item.deleteLabel": "Supprimer le message en attente {position}",
  "queue.item.deleteTooltip": "Supprimer le message",
  "queue.item.editLabel": "Modifier le message en attente {position}",
  "queue.item.editTooltip": "Modifier le message",
  "queue.deleteHeld.title": "Supprimer le message en attente ?",
  "queue.deleteHeld.body": "Un autre appareil modifie ce message. L’agent ne le recevra pas.",
  "queue.deleteHeld.keep": "Conserver",
} as const satisfies PartialTranslation<typeof source>;
