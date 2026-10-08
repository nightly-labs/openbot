import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Cola de mensajes",
  "queue.moved": "Se movió el mensaje en cola a la posición {position} de {total}.",
  "queue.attachment": "Archivo adjunto",
  "queue.hold.named": "En espera: {name} está trabajando en {channel}",
  "queue.hold.unnamed": "En espera: este agente está trabajando en {channel}",
  "queue.item.label": "Mensaje en cola {position}: {preview}",
  "queue.item.labelEditing": "Mensaje en cola {position}, en edición: {preview}",
  "queue.item.editing": "En edición",
  "queue.item.steerLabel": "Incorporar el mensaje en cola {position} al trabajo actual",
  "queue.item.steerTooltip": "Incorporar mensaje al trabajo actual",
  "queue.item.steering": "Incorporando",
  "queue.item.steer": "Orientar",
  "queue.item.notSteered": "No incorporado",
  "queue.item.steerFallback.providerUnsupported":
    "Este proveedor no puede modificar un turno en curso, así que el mensaje espera en la cola.",
  "queue.item.steerFallback.steerFailed":
    "No se pudo incorporar el mensaje al trabajo actual, así que espera en la cola.",
  "queue.item.deleteLabel": "Eliminar mensaje en cola {position}",
  "queue.item.deleteTooltip": "Eliminar mensaje",
  "queue.item.editLabel": "Editar mensaje en cola {position}",
  "queue.item.editTooltip": "Editar mensaje",
  "queue.deleteHeld.title": "¿Eliminar mensaje en cola?",
  "queue.deleteHeld.body": "Otro dispositivo está editando este mensaje. El agente no lo recibirá.",
  "queue.deleteHeld.keep": "Conservar",
} as const satisfies PartialTranslation<typeof source>;
