import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Fila de mensagens",
  "queue.moved": "Mensagem na fila movida para a posição {position} de {total}.",
  "queue.attachment": "Anexo",
  "queue.hold.named": "Aguardando - {name} está trabalhando em {channel}",
  "queue.hold.unnamed": "Aguardando - este agente está trabalhando em {channel}",
  "queue.item.label": "Mensagem na fila {position}: {preview}",
  "queue.item.labelEditing": "Mensagem na fila {position}, em edição: {preview}",
  "queue.item.editing": "Editando",
  "queue.item.steerLabel": "Redirecionar com a mensagem na fila {position}",
  "queue.item.steerTooltip": "Redirecionar com a mensagem",
  "queue.item.steering": "Redirecionando",
  "queue.item.steer": "Redirecionar",
  "queue.item.notSteered": "Não redirecionada",
  "queue.item.steerFallback.providerUnsupported":
    "Este provedor não pode redirecionar um turno em andamento, então a mensagem espera na fila.",
  "queue.item.steerFallback.steerFailed": "O redirecionamento falhou, então a mensagem espera na fila.",
  "queue.item.deleteLabel": "Excluir mensagem na fila {position}",
  "queue.item.deleteTooltip": "Excluir mensagem",
  "queue.item.editLabel": "Editar mensagem na fila {position}",
  "queue.item.editTooltip": "Editar mensagem",
  "queue.deleteHeld.title": "Excluir mensagem na fila?",
  "queue.deleteHeld.body": "Outro dispositivo está editando esta mensagem. O agente não vai recebê-la.",
  "queue.deleteHeld.keep": "Manter",
} as const satisfies PartialTranslation<typeof source>;
