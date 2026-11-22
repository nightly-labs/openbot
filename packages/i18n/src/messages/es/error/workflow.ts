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
  "error.workflow.agentStepStopped": "El agente se detuvo antes de responder a este paso. Ejecuta el paso de nuevo.",
  "error.workflow.conditionUnclear": "El modelo no respondió sí o no.",
  "error.workflow.answerInvalid":
    "La respuesta no tenía los campos que pide este paso: {fields}. Ejecuta el paso de nuevo.",
  "error.workflow.answerSetup":
    "Los campos de respuesta de este flujo de trabajo tienen un problema aquí: {fields}. Corrige el flujo de trabajo y vuelve a ejecutar el paso.",
  "error.workflow.answerSourceEnded":
    "Estos campos no tienen valor porque el paso que los da no terminó: {fields}. Primero vuelve a ejecutar ese paso.",
  "error.workflow.runInputInvalid":
    "La entrada de la ejecución no coincide con los campos de respuesta del disparador: {fields}. Envía un objeto JSON con estos campos.",
  "error.workflow.sourceNotDone":
    "Un paso anterior falló o se detuvo la última vez que se ejecutó. Primero vuelve a ejecutar ese paso.",
  "error.workflow.checkInvalid": "La comprobación de este paso no es válida. Corrígela y ejecuta el paso de nuevo.",
  "error.workflow.modelFailed": "El modelo no pudo responder. Ejecuta el paso de nuevo.",
  "error.workflow.modelTimedOut":
    "El modelo no respondió a tiempo. Elige un esfuerzo menor o un modelo más rápido para este paso y ejecútalo de nuevo.",
  "error.workflow.modelToolUse":
    "El modelo intentó usar una herramienta, pero este paso solo puede responder con texto. Ejecuta el paso de nuevo o elige otro modelo para él.",
  "error.workflow.modelImageUnsupported":
    "El modelo de este paso no puede leer imágenes. Elige un modelo que pueda, o quita la conexión de la imagen.",
  "error.workflow.modelImageType":
    "Un paso de modelo solo puede leer imágenes PNG, JPEG, GIF y WebP. Conecta una imagen de uno de estos tipos.",
  "error.workflow.modelUnavailable": "El modelo de este paso no está disponible. Elige otro modelo para este paso.",
  "error.workflow.providerBusy": "El proveedor está ocupado. Espera unos minutos y ejecuta el paso de nuevo.",
  "error.workflow.providerOffline":
    "OpenBot no pudo conectar con el proveedor. Comprueba la conexión a internet y ejecuta el paso de nuevo.",
  "error.workflow.modelBusy": "Hay otra solicitud al modelo en curso. Ejecuta el paso de nuevo en breve.",
  "error.workflow.mediaFailed": "El modelo no pudo crear la imagen o el vídeo. Ejecuta el paso de nuevo.",
  "error.workflow.mediaNotMade": "El modelo no creó la imagen ni el vídeo. Respondió: {answer}",
  "error.workflow.pictureMissing": "La imagen ya no está en el servidor. Envíala de nuevo.",
  "error.workflow.pictureType": "Usa una imagen PNG, JPEG o WebP.",
  "error.workflow.mediaInputMissing": "Una imagen de un paso anterior no está disponible. Ejecuta ese paso de nuevo.",
  "error.workflow.mediaEmptyRequest":
    "Escribe una descripción o ejecuta los pasos anteriores para que llegue un texto o una imagen.",
  "error.workflow.mediaInputNotImage": "Este paso solo acepta imágenes, no vídeos. Quita la conexión desde el vídeo.",
  "error.workflow.mediaInputNotClip":
    "Esta entrada solo acepta vídeos y archivos de audio. Quita la conexión desde el archivo.",
  "error.workflow.stepMissing": "Este paso ya no existe.",
  "error.workflow.nodeMissing": "Este paso no está en el flujo de trabajo.",
  "error.workflow.runMissing": "Esta ejecución ya no existe.",
  "error.workflow.notRetryable": "Solo un paso que falló o se detuvo puede ejecutarse de nuevo.",
  "error.workflow.noDecision": "Este paso no espera una decisión.",
  "error.workflow.outputPlaceMissing": "Elige un lugar de mensajería para esta salida.",
  "error.workflow.outputChannelMissing": "Elige un canal para esta salida.",
  "error.workflow.outputChannelFailed": "OpenBot no pudo publicar el resultado en el canal. Ejecuta el paso de nuevo.",
  "error.workflow.discordNoMessage":
    "Esta salida actúa sobre el mensaje de Discord que inició la ejecución. Inicia la ejecución desde una mención en Discord o elige Publicar en canal.",
  "error.workflow.slackNoMessage":
    "Esta salida actúa sobre el mensaje de Slack que inició la ejecución. Inicia la ejecución desde una mención en Slack o elige Publicar en canal.",
  "error.workflow.telegramNoMessage":
    "Esta salida actúa sobre el mensaje de Telegram que inició la ejecución. Inicia la ejecución desde una mención en Telegram o elige Publicar en chat.",
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
  "error.workflow.sunraSignIn": "Inicia sesión en Sunra en Apps para usar los modelos de Sunra.",
  "error.workflow.sunraNoCredits":
    "Tu cuenta de Sunra no tiene créditos suficientes. Añade créditos en sunra.ai/pricing y vuelve a ejecutar el paso.",
  "error.workflow.sunraNeedsPlan":
    "Este modelo de Sunra necesita un plan de Sunra. Elige un plan en sunra.ai/pricing o selecciona otro modelo.",
  "error.workflow.sunraTeamInputs":
    "Sunra usa imágenes de entrada solo con una cuenta personal. Selecciona tu cuenta personal en Sunra o quita las conexiones de imágenes.",
  "error.workflow.sunraFailed": "Sunra no pudo crear el archivo: {reason}",
  "error.workflow.sunraTimeout":
    "Sunra no terminó el archivo a tiempo. Revisa el proyecto OpenBot en sunra.ai antes de volver a ejecutar el paso.",
  "error.workflow.higgsfieldSignIn": "Inicia sesión en Higgsfield en Apps para usar los modelos de Higgsfield.",
  "error.workflow.higgsfieldNoCredits":
    "Tu cuenta de Higgsfield no tiene créditos suficientes. Añade créditos en higgsfield.ai/pricing y vuelve a ejecutar el paso.",
  "error.workflow.higgsfieldNeedsPlan":
    "Este modelo de Higgsfield necesita un plan de Higgsfield. Elige un plan en higgsfield.ai/pricing o selecciona otro modelo.",
  "error.workflow.higgsfieldBlocked":
    "Higgsfield no creó el archivo porque su control de contenido lo detuvo. Cambia el prompt o las imágenes de entrada y vuelve a ejecutar el paso.",
  "error.workflow.higgsfieldFailed": "Higgsfield no pudo crear el archivo: {reason}",
  "error.workflow.higgsfieldTimeout":
    "Higgsfield no terminó el archivo a tiempo. Revisa tu historial en higgsfield.ai antes de volver a ejecutar el paso.",
} as const satisfies PartialTranslation<typeof source>;
