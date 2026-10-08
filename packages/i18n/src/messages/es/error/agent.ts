import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.approvalWhileDeleting": "No se puede conceder la aprobación mientras se elimina el agente.",
  "error.agent.accessLocalOnly": "El acceso del agente solo se puede cambiar en el equipo que lo ejecuta.",
  "error.agent.duplicateCleanupFailed": "No se pudo duplicar el agente ni eliminar la copia incompleta.",
  "error.agent.commitEffectsFailed": "La transacción se confirmó, pero fallaron sus efectos guardados.",
  "error.agent.settingsLocalOnly": "Los ajustes del agente solo se pueden cambiar en el equipo que lo ejecuta.",
  "error.agent.skillsLocalOnly": "Las habilidades solo se pueden cambiar en el equipo que ejecuta el agente.",
  "error.agent.addLocalOnly": "Los agentes solo se pueden añadir en el equipo que los ejecuta.",
  "error.agent.joinedServerUpdate": "No se puede actualizar desde aquí un agente de un servidor al que te has unido.",
  "error.agent.searchQueryRequired": "Se requiere una consulta de búsqueda.",
  "error.agent.messageTooLong": "El mensaje es demasiado largo.",
  "error.agent.messageOrAttachmentRequired": "Se requiere un mensaje o un archivo adjunto.",
  "error.agent.promptAnswersTooLong": "Las respuestas a las preguntas son demasiado largas.",
  "error.agent.gone": "Este agente ya no existe.",
  "error.agent.profileGenerationBusy": "La generación de perfiles está ocupada. Inténtalo de nuevo en breve.",
  "error.agent.initialMessageRequired": "Se requiere un mensaje inicial.",
  "error.agent.initialMessageTooLong": "El mensaje inicial es demasiado largo.",
  "error.agent.setupCleanupFailed": "No se pudo configurar el agente ni eliminar el agente incompleto.",
  "error.agent.modelUnavailable": "El modelo de agente seleccionado no está disponible.",
  "error.agent.modelProviderNotConnected":
    "El modelo de agente seleccionado «{model}» no está disponible: {provider} no está conectado.",
  "error.agent.modelListEmpty":
    "El modelo de agente seleccionado «{model}» no está disponible: {provider} no mostró ningún modelo. Último error: {detail}",
  "error.agent.modelListEmptyNoError":
    "El modelo de agente seleccionado «{model}» no está disponible: {provider} no mostró ningún modelo.",
  "error.agent.modelNotInProviderList":
    "El modelo de agente seleccionado «{model}» no está disponible: {provider} no lo incluye en su lista.",
  "error.agent.modelProviderMismatch": "El modelo seleccionado no pertenece a ese proveedor.",
  "error.agent.modelNotListed": "El modelo «{model}» no está disponible. Modelos disponibles: {models}.",
  "error.agent.providerNotListed":
    "No hay ningún modelo de {provider} disponible ahora. Llama a list_models para ver los modelos disponibles.",
  "error.agent.reasoningEffortUnsupported":
    "El modelo «{model}» no admite el nivel de razonamiento «{effort}». Niveles admitidos: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} no tiene ningún modelo disponible, y ningún otro proveedor conectado tiene uno. Inicia sesión en un proveedor o cambia el proveedor predeterminado en Ajustes del servidor → Proveedores.",
  "error.agent.noStartingModel":
    "{provider} no tiene ningún modelo disponible, ni tampoco los demás proveedores con sesión iniciada. Inicia sesión en un proveedor o cambia el proveedor predeterminado en Proveedores y permisos.",
  "error.agent.waitBeforeProviderChange":
    "Espera a que terminen el turno activo y la cola antes de cambiar de proveedor.",
  "error.agent.waitBeforeClearContext":
    "Espera a que terminen el turno activo y la cola antes de iniciar un nuevo chat.",
  "error.agent.unknown": "Agente desconocido: {id}",
  "error.agent.onlyUserWidensSettings":
    "Solo el usuario puede dar acceso completo a un agente o activar el uso del equipo. Pide al usuario que lo cambie en los ajustes del agente.",
  "error.agent.queuedMessageCreateFailed": "No se pudo crear el mensaje en cola.",
  "error.agent.messageUnavailable": "El mensaje ya no está disponible.",
  "error.agent.hostLimit": "Un host puede tener hasta {limit} agentes.",
  "error.agent.changedWhileDuplicating": "El agente cambió mientras se duplicaba. Inténtalo de nuevo.",
  "error.agent.duplicatedAgentGone": "El agente duplicado ya no existe.",
  "error.agent.stateCorrupt":
    "El estado del agente está dañado o pertenece a una versión más reciente de OpenBot; no se sobrescribirá.",
  "error.agent.oldRoleField":
    "Los perfiles de agente guardados usan el antiguo campo role; actualiza los datos antes de iniciar OpenBot.",
  "error.agent.duplicateIds":
    "El estado del agente contiene identificadores de agente duplicados; no se sobrescribirá.",
  "error.agent.copyNameFailed": "OpenBot no pudo crear un nombre único para la copia del agente.",
  "error.agent.endpointRemoved": "Se eliminó el endpoint que usaba este agente. Elige otro modelo para él.",
  "error.agent.selectedGone": "El agente seleccionado ya no existe.",
  "error.agent.profileEndpointsChanged":
    "Los endpoints personalizados cambiaron durante la generación. Inténtalo de nuevo.",
  "error.agent.profileInvalid": "El proveedor devolvió un perfil no válido. Prueba a modificar tus instrucciones.",
  "error.agent.profileSectionUnavailable":
    "La sección generada no está disponible. Inténtalo de nuevo o elige una sección manualmente.",
  "error.agent.profileTimedOut": "Se agotó el tiempo de generación del perfil. Inténtalo de nuevo.",
  "error.agent.profileDisconnected": "El proveedor se desconectó durante la generación del perfil.",
  "error.agent.profileToolUse": "El proveedor intentó usar una herramienta. Prueba a modificar tus instrucciones.",
  "error.agent.profileFailed": "El proveedor no pudo generar un perfil. Inténtalo de nuevo.",
  "error.agent.profileTooLarge": "El perfil generado es demasiado grande. Prueba con instrucciones más cortas.",
  "error.agent.profileNotStarted": "El proveedor no pudo iniciar la generación del perfil.",
  "error.agent.deletionBusy": "La eliminación del agente ya está en curso.",
  "error.agent.stopBeforeDelete": "Detén el agente y cancela sus mensajes en cola antes de eliminarlo.",
  "error.agent.deleteIncomplete": "No se pudieron eliminar todos los datos del agente. Intenta eliminarlo de nuevo.",
  "error.agent.duplicationBusy": "Este agente ya se está duplicando.",
  "error.agent.waitBeforeDuplicate": "Espera a que el agente termine y vacía su cola antes de duplicarlo.",
  "error.agent.saveOtherAgent": "Este guardado pertenece a otro agente.",
  "error.agent.savedGone": "El agente guardado ya no existe.",
  "error.agent.storedProfileUnreadable":
    "Un perfil de agente guardado tiene un valor «{field}» ilegible; actualiza los datos antes de iniciar OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "El perfil de agente guardado {id} tiene un valor «{field}» ilegible; actualiza los datos antes de iniciar OpenBot.",
  "error.agent.queueEditRejected": "Edición de la cola rechazada: {reason}",
  "error.agent.computerUseLocalOnly": "El uso del equipo solo se puede cambiar en el equipo que ejecuta el agente.",
  "error.agent.automationLocalOnly": "Los scripts locales solo se pueden permitir en el equipo que ejecuta el agente.",
  "error.agent.busyMessageModeLocalOnly":
    "El comportamiento de los mensajes mientras trabaja el agente solo se puede configurar en el equipo que lo ejecuta.",
  "error.agent.automationOff": "Este agente no permite que los scripts locales ejecuten sus rutinas.",
  "error.agent.automationPayloadTooLong": "El contenido supera los {limit} caracteres.",
  "error.agent.automationRateLimited":
    "Los scripts locales ejecutaron las rutinas de este agente {limit} veces en la última hora. Inténtalo más tarde.",
  "error.agent.workspaceOnlyMacOnly":
    "Solo espacio de trabajo está disponible para este proveedor únicamente en macOS. Elige Acceso completo en los ajustes del agente.",
  "error.agent.lowMemory":
    "Este servidor tiene poca memoria disponible. Tu mensaje espera en la cola y se iniciará cuando se libere memoria. Un plan superior proporciona más memoria al servidor.",
  "error.agent.workspaceOnlyToolMissing":
    "Solo espacio de trabajo requiere {tool}, que OpenBot no encontró. Instálalo o elige Acceso completo en los ajustes del agente.",
} as const satisfies PartialTranslation<typeof source>;
