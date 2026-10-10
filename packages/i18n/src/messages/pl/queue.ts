import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Kolejka wiadomości",
  "queue.moved": "Przeniesiono wiadomość z kolejki na pozycję {position} z {total}.",
  "queue.attachment": "Załącznik",
  "queue.hold.named": "Oczekiwanie – {name} pracuje w kanale {channel}",
  "queue.hold.unnamed": "Oczekiwanie – ten agent pracuje w kanale {channel}",
  "queue.item.label": "Wiadomość w kolejce {position}: {preview}",
  "queue.item.labelEditing": "Wiadomość w kolejce {position}, edycja: {preview}",
  "queue.item.editing": "Edycja",
  "queue.item.steerLabel": "Pokieruj wiadomością z kolejki {position}",
  "queue.item.steerTooltip": "Pokieruj wiadomością",
  "queue.item.steering": "Kierowanie",
  "queue.item.steer": "Pokieruj",
  "queue.item.notSteered": "Nie pokierowano",
  "queue.item.steerFallback.providerUnsupported":
    "Ten dostawca nie może pokierować trwającą turą, więc wiadomość czeka w kolejce.",
  "queue.item.steerFallback.steerFailed": "Pokierowanie nie powiodło się, więc wiadomość czeka w kolejce.",
  "queue.item.deleteLabel": "Usuń wiadomość z kolejki {position}",
  "queue.item.deleteTooltip": "Usuń wiadomość",
  "queue.item.editLabel": "Edytuj wiadomość z kolejki {position}",
  "queue.item.editTooltip": "Edytuj wiadomość",
  "queue.deleteHeld.title": "Usunąć wiadomość z kolejki?",
  "queue.deleteHeld.body": "Inne urządzenie edytuje tę wiadomość. Agent jej nie otrzyma.",
  "queue.deleteHeld.keep": "Zachowaj",
} as const satisfies PartialTranslation<typeof source>;
