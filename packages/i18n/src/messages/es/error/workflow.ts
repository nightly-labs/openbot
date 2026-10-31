import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Este flujo de trabajo ya no existe.",
  "error.workflow.versionMissing": "Esta versión del flujo de trabajo ya no existe.",
  "error.workflow.annotation": "Los textos, las notas y las formas no pueden tener conexiones.",
  "error.workflow.port": "Un paso no puede recibir este tipo de entrada.",
  "error.workflow.branch": "Solo una condición puede tener conexiones de sí y no.",
  "error.workflow.conditionBranch": "Cada conexión de una condición debe ser sí o no.",
  "error.workflow.duplicateEdge": "Estos dos pasos ya tienen esta conexión.",
  "error.workflow.serverTooOld":
    "Este servidor no admite flujos de trabajo. Actualiza OpenBot en el ordenador que lo ejecuta.",
  "error.workflow.nodeUnsupported":
    "Esta versión de OpenBot aún no puede ejecutar pasos de imagen, archivo ni mensaje.",
  "error.workflow.interrupted": "OpenBot se detuvo mientras se ejecutaba este paso. Ejecútalo de nuevo.",
  "error.workflow.agentMissing": "Elige un agente para este paso.",
  "error.workflow.handoffFailed": "OpenBot no pudo enviar este paso a su agente.",
  "error.workflow.agentStepEnded": "El mensaje al agente se eliminó antes de que respondiera.",
  "error.workflow.conditionUnclear": "El modelo no respondió sí o no.",
  "error.workflow.modelFailed": "El modelo no pudo responder. Ejecuta el paso de nuevo.",
  "error.workflow.modelBusy": "Hay otra solicitud al modelo en curso. Ejecuta el paso de nuevo en breve.",
  "error.workflow.stepMissing": "Este paso ya no existe.",
  "error.workflow.nodeMissing": "Este paso no está en el flujo de trabajo.",
  "error.workflow.runMissing": "Esta ejecución ya no existe.",
  "error.workflow.notRetryable": "Solo un paso que falló o se detuvo puede ejecutarse de nuevo.",
  "error.workflow.noDecision": "Este paso no espera una decisión.",
  "error.workflow.outputPlaceMissing": "Elige un lugar de mensajería para esta salida.",
  "error.workflow.outputConnectionOff":
    "La conexión de mensajería de esta salida está desactivada o se eliminó. Elige un lugar de nuevo.",
  "error.workflow.outputNotRunning":
    "La conexión de mensajería no está en marcha ahora. Inténtalo de nuevo cuando lo esté.",
  "error.workflow.outputRefused": "El lugar rechazó la publicación. Asegúrate de que OpenBot pueda publicar allí.",
  "error.workflow.outputUncertain":
    "La publicación se detuvo a medio camino. Una parte puede estar ya en el lugar. Revísalo antes de intentarlo de nuevo.",
  "error.workflow.tooLarge":
    "Este flujo de trabajo es demasiado grande para guardarlo. Quita algunos dibujos o textos largos e inténtalo de nuevo.",
  "error.workflow.tooLargeToSend":
    "Este flujo de trabajo es demasiado grande para enviarlo a otro ordenador. Ábrelo en el ordenador que ejecuta el servidor.",
  "error.workflow.webhookMissing":
    "Este paso no es un disparador de webhook. Guarda el flujo de trabajo y vuelve a intentarlo.",
  "error.workflow.githubActionMissing": "Elige qué hace esta salida en GitHub.",
  "error.workflow.githubRepositoryMissing": "Elige un repositorio para esta salida.",
  "error.workflow.githubItemMissing":
    "Esta salida no tiene ninguna incidencia ni pull request. Inicia la ejecución desde un evento de GitHub o pon el número en su entrada.",
  "error.workflow.githubPullRequestOnly": "Esta acción solo funciona en pull requests.",
  "error.workflow.githubTextMissing": "Esta salida no tiene texto para enviar. Conecta un paso que lo escriba.",
  "error.workflow.githubEventText":
    "Esta salida no puede enviar el evento sin procesar del activador. Pon un agente entre el activador y esta salida.",
  "error.workflow.githubChoiceMissing": "Elige las etiquetas o la persona para esta salida.",
  "error.workflow.githubChoseNothing": "El modelo no eligió ninguna etiqueta ni persona de este repositorio.",
  "error.workflow.githubNotConnected": "Conecta GitHub en el ordenador que ejecuta este flujo de trabajo.",
  "error.workflow.githubNoAccess":
    "La aplicación de GitHub de OpenBot no puede ver este repositorio ni este elemento. Abre GitHub y dale acceso.",
  "error.workflow.githubNoWrite":
    "La aplicación de GitHub de OpenBot no puede cambiar este repositorio. Abre GitHub y dale acceso.",
  "error.workflow.githubLocked": "Esta conversación está bloqueada en GitHub.",
  "error.workflow.githubRefused": "GitHub rechazó el cambio: {detail}",
  "error.workflow.githubUnreachable": "OpenBot no pudo conectar con GitHub. Ejecuta el paso de nuevo.",
  "error.workflow.githubUncertain":
    "El cambio se detuvo a medio camino. Puede que ya esté en GitHub. Revísalo antes de ejecutar el paso de nuevo.",
  "error.workflow.githubNoEvent":
    "GitHub no tiene ninguna incidencia ni pull request con la que se inicie este activador.",
} as const satisfies PartialTranslation<typeof source>;
