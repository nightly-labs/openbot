import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Los eventos no están disponibles en este host.",
  "error.backend.databaseIntegrity": "La base de datos de OpenBot no superó la comprobación de integridad.",
  "error.backend.webhookRouteLimit": "Un host puede tener un máximo de {limit} rutinas de webhook.",
  "error.backend.webhookSettingsInvalid": "Comprueba los ajustes del webhook e inténtalo de nuevo.",
  "error.backend.webhookRouteUnavailable":
    "La ruta pública del webhook no está lista. Comprueba la conexión del host e inténtalo de nuevo.",
  "error.backend.browserViewRemoteOnly": "La vista del navegador en directo solo está disponible para un host remoto.",
  "error.backend.browserViewUnsupported": "Este host remoto no admite una vista del navegador en directo.",
  "error.backend.browserViewLimit": "Hay demasiadas vistas del navegador abiertas en este host.",
  "error.backend.browserViewEnded": "La vista en directo de esta página terminó.",
  "error.backend.browserViewFailed": "La vista en directo de esta página falló.",
  "error.backend.windowTemporarilyUnavailable": "La ventana de OpenBot no está disponible temporalmente.",
  "error.backend.windowUnavailable": "La ventana de OpenBot no está disponible.",
  "error.backend.sunshineApiHttp": "La API de Sunshine falló con HTTP {status}.",
  "error.backend.sunshinePortsUnavailable":
    "No se pudo reservar una familia de puertos libre de Sunshine para el escritorio remoto.",
  "error.backend.moonlightPortsUnavailable":
    "No se pudo reservar un rango de puertos libre de Moonlight WebRTC para el escritorio remoto.",
  "error.backend.iceServerNoPort": "El servidor ICE del escritorio remoto no recibió un puerto.",
  "error.backend.remoteDesktopStoppedWhileStarting":
    "El entorno de ejecución del escritorio remoto se detuvo mientras se iniciaba.",
  "error.backend.sunshineNotStarted": "Sunshine no se inició en una familia de puertos reservada.",
  "error.backend.moonlightNoHost": "Moonlight no tiene ningún host local vinculado.",
  "error.backend.sunshineNoDesktop": "Sunshine no publicó la aplicación Desktop.",
  "error.backend.sunshineAmbiguousPairing": "Sunshine devolvió solicitudes de vinculación local ambiguas.",
  "error.backend.sunshineNoPairingRequest": "Sunshine no recibió la solicitud de vinculación local esperada.",
  "error.backend.moonlightPairingHttp": "La vinculación de Moonlight falló con HTTP {status}.",
  "error.backend.moonlightRejectedPairing": "Moonlight rechazó la vinculación con Sunshine.",
  "error.backend.moonlightNoPin": "Moonlight no devolvió un PIN de vinculación.",
  "error.backend.moonlightPairingIncomplete": "La vinculación de Moonlight no se completó.",
  "error.backend.moonlightWebNotEmbedded": "Moonlight Web no es una compilación integrada de OpenBot.",
  "error.backend.moonlightEmptyResponse": "Moonlight devolvió una respuesta vacía.",
  "error.backend.remoteDesktopTimeout": "Se agotó el tiempo de la solicitud de escritorio remoto.",
  "error.backend.moonlightApiHttp": "La API de Moonlight falló con HTTP {status}.",
  "error.backend.sunshineExited": "Sunshine se cerró antes de que su API HTTPS en el puerto {port} estuviera lista.",
  "error.backend.sunshineNoAnswer": "Sunshine no respondió.",
  "error.backend.sunshineTlsUnexpected": "Sunshine devolvió un certificado TLS inesperado.",
  "error.backend.moonlightWebExited": "Moonlight Web se cerró antes de que {url} estuviera lista.",
  "error.backend.moonlightWebNotReady": "Moonlight Web no llegó a estar listo.",
  "error.backend.channelDeleteUnsupported": "Este servidor no admite la eliminación de canales.",
  "error.backend.browserNavigateUnsupported":
    "Este host remoto no admite navegar con la barra de direcciones en una pestaña existente.",
  "error.backend.browserUserControlBusy":
    "Esta pestaña del navegador espera un secreto. Responde primero a la solicitud del secreto.",
  "error.backend.browserUserControlUnsupported":
    "Este host remoto no admite tomar el control de una pestaña del navegador.",
  "error.backend.browserSignInUnsupported": "Este host remoto no puede recibir un inicio de sesión de este equipo.",
  "error.backend.browserSignInOpenFailed": "OpenBot no pudo abrir la ventana de inicio de sesión.",
  "error.backend.browserSignInReadFailed": "OpenBot no pudo leer el inicio de sesión de la ventana.",
  "error.backend.browserStopUnsupported": "Este host remoto no puede detener la carga de una página.",
  "error.backend.sharedDataLocalOnly": "Los datos compartidos se gestionan en el equipo que ejecuta estos agentes.",
  "error.backend.browserUrlProtocol": "Solo se permiten URL HTTP(S) en el navegador.",
  "error.backend.sunshineNotReady": "Sunshine no llegó a estar listo.",
  "error.backend.sunshineNotReadyReason": "Sunshine no llegó a estar listo. {reason}",
  "error.backend.channelLeadModelUnavailable": "El modelo del coordinador del canal no está disponible.",
  "error.backend.sharedDataUnavailable": "Los datos compartidos no están disponibles.",
  "error.backend.shuttingDown": "OpenBot se está cerrando.",
  "error.backend.channelUnconfirmedStart":
    "El canal tiene un inicio de tarea sin confirmar. Comprueba el resultado antes de eliminarlo.",
  "error.backend.channelNotFound": "No se encontró el canal.",
  "error.backend.channelMemberUnavailable": "Un miembro del canal no está disponible.",
  "error.backend.channelArchived": "Restaura este canal antes de enviar mensajes o cambiar tareas.",
  "error.backend.channelReferenceUnavailable": "El mensaje del canal al que se hace referencia no está disponible.",
  "error.backend.channelTaskNotFound": "No se encontró la tarea del canal.",
  "error.backend.channelTaskComplete": "Esta tarea ya está completada.",
  "error.backend.channelSelectAgent": "Selecciona un agente.",
  "error.backend.channelLeadRequired": "Elige un coordinador de canal disponible o asigna esta tarea a un miembro.",
  "error.backend.channelRoutingTooLong":
    "Esta solicitud supera el límite de contexto de asignación. Selecciona un miembro o envía una solicitud más corta.",
  "error.backend.channelTaskMemberRequired": "Elige un miembro para esta tarea.",
  "error.backend.channelTaskStopped": "Detenida. Continúa o reasigna esta tarea.",
  "error.backend.channelRoutingUnreadable": "El líder no pudo dirigir este mensaje. Reasígnalo a un miembro.",
  "error.backend.channelRoutingFailed": "La asignación falló. Elige un miembro o inténtalo de nuevo.",
  "error.backend.channelLeadTimedOut":
    "El coordinador del canal no respondió a tiempo. Elige un miembro o inténtalo de nuevo.",
  "error.backend.channelLeadFailed":
    "El coordinador del canal no pudo asignar este mensaje. Elige un miembro o inténtalo de nuevo.",
  "error.backend.channelRequestMemberRequired": "Elige un miembro para esta solicitud.",
  "error.backend.channelDeliveryNotCreated": "No se creó la entrega del canal.",
  "error.backend.channelAssignmentStopped": "Esta asignación del canal se detuvo o se reemplazó.",
  "error.backend.channelAssigneeUnavailable": "El agente asignado no está disponible.",
  "error.backend.channelAssigneeRemoved": "Se quitó al miembro asignado.",
  "error.backend.channelAssigneeReassign": "El miembro asignado no está disponible. Reasigna esta tarea.",
  "error.backend.channelAssignmentChanged": "Esta asignación del canal cambió.",
  "error.backend.channelMemberRequired": "Selecciona un miembro disponible de este canal.",
  "error.backend.memoryEssentialBudget":
    "Los recuerdos esenciales superan el límite del prompt. Configura una entrada para buscarla cuando sea necesario e inténtalo de nuevo.",
  "error.backend.memorySelectionConflict": "El recuerdo cambió. Vuelve a cargarlo e inténtalo de nuevo.",
  "error.backend.memorySelectionUserControlled":
    "El usuario controla la selección de este recuerdo. Respeta la elección del usuario.",
  "error.backend.memorySearchQuery": "Escribe una o más palabras de búsqueda, hasta 256 caracteres.",
  "error.backend.memoryOperationFailed": "Falló la operación de memoria. Inténtalo de nuevo.",
  "error.backend.memoryGone": "Este recuerdo ya no existe.",
  "error.backend.routineGone": "Esta rutina ya no existe.",
  "error.backend.turnNotStarted": "El proveedor no inició este turno.",
  "error.backend.routineResultConnectionOff":
    "Esta conexión de mensajería está desactivada o eliminada. Elige otro lugar.",
  "error.backend.routineResultNoDelivery": "Esta ejecución no tiene una respuesta para enviar de nuevo.",
  "error.backend.channelMemoryLimit": "Un canal puede tener hasta {limit} recuerdos.",
  "error.backend.channelRoutineLimit": "Un canal puede tener un máximo de {limit} rutinas.",
  "error.backend.agentRoutineLimit": "Un agente puede tener un máximo de {limit} rutinas.",
  "error.backend.agentMemoryLimit": "Un agente puede tener hasta {limit} recuerdos.",
  "error.backend.agentMemoryLimitReached":
    "Tienes {saved} de {limit} recuerdos. Para hacer sitio, actualiza un recuerdo por su memoryId con el texto combinado de dos recuerdos relacionados y olvida el otro, u olvida un recuerdo que ya no sea cierto. Luego vuelve a intentarlo.",
  "error.backend.agentMemoryLimitExceeded":
    "Tienes {saved} recuerdos y el límite es {limit}. El usuario fijó el límite por debajo del número de recuerdos guardados. No olvides recuerdos para hacer sitio. Dile al usuario que este recuerdo no se guardó.",
  "error.backend.channelHistoryLeadRequired": "Elige un coordinador de canal para preparar el historial compartido.",
  "error.backend.channelHistoryArriving": "Aún se está recibiendo un mensaje compartido. Reanuda cuando esté completo.",
  "error.backend.channelHistoryInvalid": "El resumen del historial no es válido. Reanuda para intentarlo de nuevo.",
  "error.backend.channelContextTooLong":
    "Esta asignación supera el límite de contexto compartido. Envía una solicitud más corta o vuelve a asignarla.",
  "error.backend.draftAttachmentLimit": "Mantén un máximo de {limit} archivos adjuntos en borrador.",
  "error.backend.recipientRequired": "Se requiere al menos un destinatario.",
  "error.backend.recipientLimit": "Un mensaje puede tener un máximo de {limit} destinatarios.",
  "error.backend.attachmentDraftGone": "El borrador del archivo adjunto ya no existe: {id}",
  "error.backend.attachmentInQueueEdit": "Un archivo adjunto pertenece a una edición de la cola.",
  "error.backend.messageEmpty": "El mensaje no puede estar vacío.",
  "error.backend.attachLimit": "Adjunta un máximo de {limit} archivos.",
  "error.backend.queuedMessageNotFound": "No se encontró el mensaje en cola.",
  "error.backend.cancelQueuedOnly": "Solo se pueden cancelar mensajes en cola.",
  "error.backend.messageBeingEdited": "Este mensaje se está editando. Primero guarda o cancela la edición.",
  "error.backend.queuedMessageUnavailable": "Este mensaje en cola ya no está disponible.",
  "error.backend.editedOnOtherDevice": "Este mensaje se está editando en otro dispositivo.",
  "error.backend.editUnavailable": "Esta edición ya no está disponible.",
  "error.backend.attachmentInOtherEdit": "Un archivo adjunto pertenece a otra edición.",
  "error.backend.messageBeingSaved": "Este mensaje se está guardando. Inténtalo de nuevo cuando termine.",
  "error.backend.editQueuedOnly": "Solo se pueden editar mensajes en cola.",
  "error.backend.attachmentNotInMessage": "Un archivo adjunto no pertenece al mensaje en cola.",
  "error.backend.queueOrderStale": "El orden de la cola está desactualizado. Actualiza la cola e inténtalo de nuevo.",
  "error.backend.fileGone": "El archivo no existe o ya se ha eliminado.",
  "error.backend.managedAttachmentChanged": "El archivo adjunto gestionado falta o ha cambiado: {name}",
  "error.backend.mailboxStateCorrupt":
    "El estado del buzón está dañado o pertenece a una versión más reciente de OpenBot; no se sobrescribirá.",
  "error.backend.recipientDeleting":
    "El destinatario se está eliminando. Inténtalo de nuevo cuando termine la eliminación.",
  "error.backend.recipientHidden": "Este agente está oculto. Restáuralo para enviarle mensajes.",
  "error.backend.attachBetween": "Adjunta entre 1 y {limit} archivos.",
  "error.backend.attachmentNotFile": "El adjunto no es un archivo: {path}",
  "error.backend.generatedImageTooLarge": "La imagen generada supera el límite de 100 MB.",
  "error.backend.attachmentNotRegularFile": "Solo se pueden adjuntar archivos normales: {name}",
  "error.backend.attachmentCopyFailed": "OpenBot no pudo copiar {name}.",
  "error.backend.routineNameRequired": "Se requiere un nombre para la rutina.",
  "error.backend.routineNameTooLong": "El nombre de la rutina es demasiado largo.",
  "error.backend.routineInstructionRequired": "Se requiere una instrucción para la rutina.",
  "error.backend.routineInstructionTooLong": "La instrucción de la rutina es demasiado larga.",
  "error.backend.routineScheduleInvalid": "La programación de la rutina no es válida.",
  "error.backend.routineIntervalTooShort":
    "Los intervalos de las rutinas deben ser de al menos {minutes} minutos. Usa {minutes} minutos o más, o una programación diaria, semanal o cron.",
  "error.backend.routineIntervalTooShortFixed":
    "Los intervalos de las rutinas deben ser de al menos {minutes} minutos. Usa {minutes} minutos o más, o una hora fija.",
  "error.backend.routineCronTooOften":
    "Las programaciones personalizadas no deben ejecutarse con más frecuencia que cada {minutes} minutos.",
  "error.backend.routineAnchorInvalid": "El punto de inicio del intervalo de la rutina no es válido.",
  "error.backend.routineNoOccurrence": "La programación no tiene ninguna ejecución en los próximos cinco años.",
  "error.backend.routineOncePassed": "La hora de esta rutina única ya pasó. Elige una fecha u hora posterior.",
  "error.backend.routineTimezoneInvalid": "La zona horaria de la rutina no es válida.",
  "error.backend.routineCronFields": "Las programaciones personalizadas deben usar cinco campos cron.",
  "error.backend.routineCronValueInvalid": "El valor cron {field} no es válido.",
  "error.backend.routineCronFieldEmpty": "El campo cron {field} está vacío.",
  "error.backend.routineDeletionBusy": "Ya se está eliminando otra rutina de este agente.",
  "error.backend.routineWaitForAgent": "Espera a que termine la operación del agente antes de ejecutar una rutina.",
  "error.backend.routineRunStarting":
    "Esta ejecución de la rutina aún se está iniciando. Inténtalo de nuevo cuando empiece su turno.",
  "error.backend.routineRunNoSession":
    "OpenBot no puede interrumpir la ejecución activa de la rutina porque su sesión del proveedor no está disponible.",
  "error.backend.interruptSelf": "Un agente no puede interrumpirse a sí mismo.",
  "error.backend.interruptOtherWork":
    "Este agente trabaja en una tarea que no inició tu mensaje. Solo el usuario o quien envió esa tarea puede detenerlo.",
  "error.backend.interruptStarting":
    "Este agente aún está iniciando un turno. Inténtalo de nuevo cuando empiece el turno.",
  "error.backend.interruptNoSession":
    "OpenBot no puede interrumpir este agente porque su sesión del proveedor no está disponible.",
  "error.backend.memoryTextRequired": "Se requiere el texto del recuerdo.",
  "error.backend.memoryTextTooLong": "El texto del recuerdo es demasiado largo.",
  "error.backend.mcpServerGone": "Este servidor MCP ya no existe.",
  "error.backend.routineFlowLinkGone": "Esta conexión ya no existe.",
  "error.backend.routineFlowSameAgent": "Un agente no puede pasarse trabajo a sí mismo.",
  "error.backend.routineFlowIntoOwner":
    "La rutina empieza con su propio agente, por lo que ese agente no puede recibir trabajo de otro.",
  "error.backend.routineFlowNotOnPath": "Este agente aún no forma parte de la rutina. Primero conéctalo a la rutina.",
  "error.backend.routineFlowDuplicate": "Estos agentes ya están conectados en esta rutina.",
  "error.backend.routineFlowCycle": "Esta conexión crearía un bucle.",
  "error.backend.routineFlowLinkLimit": "Una rutina puede tener un máximo de {limit} conexiones.",
  "error.backend.agentWaitLimit":
    "Este agente ya tiene {count} esperas abiertas. Cierra una espera con openbot.close_wait antes de abrir otra.",
  "error.backend.agentWaitGone": "Esta espera no está abierta. El agente la cerró o alguien la canceló.",
  "error.backend.agentWaitNoRequest":
    "Una espera necesita un mensaje para continuar. Este turno no tiene ningún mensaje.",
  "error.backend.agentWaitOwnChatOnly":
    "Abre una espera solo en tu propio chat. Una tarea de canal o de mensajería no puede esperar.",
  "error.backend.agentWaitNoteRequired": "Escribe una nota breve que diga para qué es la espera.",
  "error.backend.agentWaitRoutineGone": "Este agente no tiene ninguna rutina con este id.",
  "error.backend.agentWaitNoRoutine":
    "Solo una ejecución de una de tus rutinas despierta una espera, y no tienes ninguna rutina. Crea una con openbot.create_routine y luego abre la espera.",
  "error.backend.agentWaitRemoteUnsupported":
    "Las esperas abiertas solo están disponibles para agentes en este equipo.",
  "error.backend.routineFlowHandoffFailed": "La rutina no pudo pasar el trabajo a este agente.",
  "error.backend.mcpServerLimit": "OpenBot mantiene hasta {limit} servidores MCP.",
  "error.backend.mcpServerNameTaken": "Ya existe un servidor MCP llamado {name}.",
  "error.backend.mcpServerInvalid": "OpenBot no puede guardar esta configuración del servidor MCP.",
  "error.backend.mcpServerNoAnswer": "El servidor no respondió en {seconds} segundos.",
  "error.backend.mcpSignInNotAccepted": "El servidor no aceptó ese inicio de sesión.",
  "error.backend.mcpSignInClientRefused":
    "El servidor de inicio de sesión no aceptó a OpenBot al completar el inicio de sesión. Inicia sesión de nuevo: OpenBot se registra otra vez en el servidor.",
  "error.backend.mcpCommandNotFound": "No se encontró el comando: {command}",
  "error.backend.mcpRegistrationRefused":
    "El servidor de inicio de sesión aún no acepta OpenBot como aplicación. Tu cuenta no es la causa. Usa otra forma de conexión, como un servidor MCP local.",
  "error.backend.mcpSignInAbandonedGeneric": "Se abandonó el inicio de sesión.",
  "error.backend.mcpSignInForgotten": "Se olvidó el inicio de sesión de MCP mientras estaba en curso.",
  "error.backend.mcpSignInAbandoned": "Se abandonó el inicio de sesión de MCP.",
  "error.backend.mcpSignInNoBrowser": "Este inicio de sesión de MCP no puede abrir un navegador.",
  "error.backend.mcpSignInNotWebPage": "La dirección de inicio de sesión no es una página web.",
  "error.backend.mcpSignInRequired":
    "Este servidor pide que inicies sesión. Elige Iniciar sesión para continuar en tu navegador.",
  "error.backend.mcpSignInOnHost":
    "Este servidor pide un inicio de sesión. Inicia sesión en él desde OpenBot en el equipo host.",
  "error.backend.mcpSignInNeedsHttps":
    "Este servidor pide un inicio de sesión, y OpenBot solo inicia sesión por https. Cambia la URL a {url}.",
  "error.backend.mcpSignInCancelled": "Se canceló el inicio de sesión.",
  "error.backend.mcpSignInTimedOut": "El inicio de sesión no se completó en el navegador.",
  "error.backend.mcpSignInResponseTimedOut": "La respuesta del inicio de sesión no llegó a tiempo.",
  "error.backend.mcpSignInMetadataUnreadable":
    "OpenBot no pudo leer la información de inicio de sesión de este servidor. Revisa la dirección del servidor y vuelve a intentarlo.",
  "error.backend.mcpServerExited":
    "El servidor se detuvo antes de responder. Ejecuta el comando en una terminal para ver su error.",
  "error.backend.mcpServerFailedToStart": "El servidor no se inició: {reason}",
  "error.backend.mcpOAuthProxyUnavailable":
    "OpenBot no pudo iniciar su conexión local de inicio de sesión para este servidor. Reinicia OpenBot y vuelve a intentarlo.",
  "error.backend.mcpOAuthSignInNeeded":
    "El inicio de sesión en este servidor MCP ha terminado. El usuario debe volver a iniciar sesión en OpenBot.",
  "error.backend.mcpServerUnreachable": "OpenBot no pudo conectar con el servidor. Revisa la URL y tu red.",
  "error.backend.mcpLocalServerOff":
    "Ningún servidor responde en {address} en este equipo. Inicia el servidor o actívalo en la app que lo ejecuta y vuelve a intentarlo.",
  "error.backend.mcpServerBlocked":
    "Este equipo bloqueó la conexión con el servidor. Revisa tu cortafuegos o software de seguridad y vuelve a intentarlo.",
  "error.backend.mcpServerIncompatible":
    "Algo respondió en esta dirección, pero no como un servidor MCP por Streamable HTTP. Revisa la URL y actualiza la app que ejecuta el servidor.",
  "error.backend.mcpRemoteBridge":
    "{reason} Este comando ejecuta el puente mcp-remote. Elige Streamable HTTP con la URL {url} y OpenBot iniciará tu sesión.",
  "error.backend.oauthNotHttps": "El endpoint OAuth {origin} no usa https, por lo que no se enviaron las credenciales.",
  "error.backend.oauthTooManyRedirects": "El endpoint OAuth redirigió demasiadas veces.",
  "error.backend.oauthRedirectOrigin":
    "El endpoint OAuth redirigió a {origin}, por lo que no se reenviaron las credenciales.",
  "error.backend.oauthTimedOut": "El endpoint OAuth {origin} no respondió a tiempo.",
  "error.backend.oauthResponseTooLarge": "El endpoint OAuth {origin} envió una respuesta demasiado grande.",
  "error.backend.oauthResponseUnreadable": "No se pudo leer la respuesta del endpoint OAuth {origin}.",
  "error.backend.mcpOAuthPrivateEndpoint":
    "El endpoint OAuth {origin} está en una red privada, pero el servidor MCP es público, por lo que no se enviaron las credenciales.",
  "error.backend.sidebarSectionLimit": "Un servidor puede tener hasta {limit} secciones en la barra lateral.",
  "error.backend.sectionNameRequired": "Se requiere un nombre para la sección.",
  "error.backend.sectionNameTooLong": "El nombre de la sección es demasiado largo.",
  "error.backend.sectionNameDuplicate": "Los nombres de las secciones deben ser únicos.",
  "error.backend.directMessageRequired": "Escribe un mensaje primero.",
  "error.backend.directMessageTooLong": "Un mensaje directo puede tener hasta {limit} caracteres.",
  "error.backend.directMessageSelf": "No puedes enviarte un mensaje directo a ti mismo.",
  "error.backend.readBoundaryUnavailable": "El punto de lectura ya no está disponible.",
  "error.backend.sharedFileOutside": "El archivo compartido debe estar dentro del directorio compartido.",
  "error.backend.sharedPathIsFolder": "La ruta compartida es una carpeta, no un archivo.",
  "error.backend.sharedPathNotFile": "La ruta compartida no es un archivo.",
  "error.backend.workspaceFileOutside":
    "El archivo del espacio de trabajo debe estar dentro del espacio de trabajo del agente.",
  "error.backend.workspacePathNotFile": "La ruta del espacio de trabajo no es un archivo.",
  "error.backend.workspacePathNotDirectory": "La ruta del espacio de trabajo no es una carpeta.",
  "error.backend.workspacePathMissing": "No existe nada en {path} dentro del espacio de trabajo del agente {root}.",
  "error.backend.workspacePathMissingForMember": "No existe nada en {path} dentro del espacio de trabajo del agente.",
  "error.backend.useChannelTaskControls": "Usa los controles de tareas del canal para esta asignación.",
  "error.backend.editFinished": "Esta edición ya terminó.",
  "error.backend.editCancelled": "Esta edición se canceló, por lo que el mensaje conserva su texto original.",
  "error.backend.editSaved": "Esta edición ya se guardó.",
  "error.backend.editSavedDifferent": "Esta edición ya se guardó con otro contenido. Tus cambios no se guardaron.",
  "error.backend.useChannelTaskControlsWork": "Usa los controles de tareas del canal para el trabajo del canal.",
  "error.backend.steerTurnChanged": "El turno activo cambió antes de que se pudiera orientar con este mensaje.",
  "error.backend.steerUnsupported": "Este proveedor no puede orientar un turno en curso. Tu mensaje sigue en la cola.",
  "error.backend.steerRoutineRun":
    "Ahora se ejecuta una rutina. Tu mensaje sigue en la cola y empieza después de la rutina.",
  "error.backend.steerQueuedOnly": "Solo se puede orientar con mensajes en cola.",
  "error.backend.promptInactive": "Esta pregunta ya no está activa.",
  "error.backend.promptAnswerMismatch": "Una respuesta no coincide con ninguna pregunta activa.",
  "error.backend.approvalInactive": "Esta aprobación ya no está activa.",
  "error.backend.takeoverInactive": "Esta toma de control del navegador ya no está activa.",
  "error.backend.authSubmitting": "Ya se están enviando los datos de autenticación.",
  "error.backend.apiKeySaveFailed": "OpenBot no pudo guardar la clave de API. Inténtalo de nuevo.",
  "error.backend.apiKeyNotAllowed":
    "Solo el propietario del servidor o un administrador puede introducir una clave de API.",
  "error.backend.apiKeySaving": "La clave de API ya se está guardando.",
  "error.backend.authRequestInactive": "Esta solicitud de autenticación segura ya no está activa.",
  "error.backend.secureAuthUnavailable": "La autenticación segura no está disponible.",
  "error.backend.browserUrlRequired": "Se requiere una URL para el navegador.",
  "error.backend.browserUrlTooLong": "La URL del navegador es demasiado larga.",
  "error.backend.browserTabLimit": "El navegador puede tener hasta {limit} pestañas abiertas.",
  "error.backend.browserProfileMissing":
    "El perfil de navegador de este agente ya no existe. Elige otro perfil en los ajustes del agente.",
  "error.backend.browserProfileNotFound": "Este perfil de navegador ya no existe.",
  "error.backend.browserProfileNameTaken": "Ya existe un perfil de navegador con este nombre.",
  "error.backend.browserSessionInUse": "Una pestaña todavía usa esta sesión del navegador. Inténtalo de nuevo.",
  "error.backend.browserProfileLimit": "Puedes tener hasta {limit} perfiles de navegador.",
  "error.backend.browserLowMemory":
    "Este servidor tiene poca memoria disponible, por lo que el navegador no puede abrir otra pestaña. Cierra una pestaña o espera a que terminen otros agentes.",
  "error.backend.browserOpenFailed": "No se pudo abrir {url}: {reason}",
  "error.backend.popupSecureInput":
    "Las ventanas emergentes están bloqueadas durante la entrada segura. Termina o cancela la entrada segura y vuelve a intentarlo desde la página.",
  "error.backend.popupUnsupportedType":
    "Este tipo de ventana emergente no se admite. Usa un enlace normal o un botón de inicio de sesión en la página.",
  "error.backend.popupUnsupportedAddress":
    "Esta ventana emergente usa una dirección no admitida. Usa una opción de inicio de sesión HTTP o HTTPS en la página.",
  "error.backend.popupTabLimit":
    "Se alcanzó el límite de pestañas del navegador. Cierra una pestaña y vuelve a intentarlo desde la página.",
  "error.backend.popupLoadFailed":
    "No se pudo cargar la ventana emergente. Intenta iniciar sesión de nuevo desde la página original.",
  "error.backend.browserTabNotFound": "No se encontró la pestaña del navegador.",
  "error.backend.authActive": "La autenticación ya está activa.",
  "error.backend.authHttpsRequired": "La autenticación segura requiere HTTPS.",
  "error.backend.authDigitsRange": "Los códigos de autenticación requieren entre 4 y 12 dígitos.",
  "error.backend.authExpired": "La solicitud de autenticación caducó.",
  "error.backend.authDigitsRequired": "Introduce el número de dígitos solicitado.",
  "error.backend.browserViewProtected": "La vista del navegador está protegida durante la autenticación.",
  "error.backend.browserPreviewPageChanged":
    "La página del navegador cambió durante la vista previa. Inténtalo de nuevo.",
  "error.backend.browserInputProtected": "La entrada del navegador está protegida durante la autenticación.",
  "error.backend.mcpServerHttpCredentials":
    "El servidor respondió {status}. Comprueba la clave de API u otras credenciales.",
  "error.backend.mcpServerHttpUrl":
    "El servidor respondió {status}. Comprueba la URL. El enlace puede ser incorrecto, haber caducado o haberse eliminado.",
  "error.backend.mcpSignInAppUrl": "La app de inicio de sesión necesita una URL de servidor válida.",
  "error.backend.mcpSignInAppClientId": "Introduce el ID de cliente de la app de inicio de sesión.",
  "error.backend.mcpSignInAppIssuerChanged":
    "El servidor de inicio de sesión de este servidor MCP cambió, así que OpenBot no le envió la app de inicio de sesión. Si el cambio es correcto, quita la app de inicio de sesión y añádela de nuevo.",
  "error.backend.mcpSignInAppNoServer":
    "Guarda este servidor MCP como servidor de URL antes de añadir una app de inicio de sesión.",
  "error.backend.mcpSignInAppUnavailable": "Este equipo no puede guardar una app de inicio de sesión.",
  "error.backend.taskMoveRefused": "Solo un mensaje que enviaste únicamente a este agente puede ejecutarse como tarea.",
  "error.backend.taskNotFound": "Esta tarea no está disponible.",
  "error.backend.taskClosed": "Esta tarea está cerrada. Vuelve a abrirla para enviar un mensaje.",
  "error.backend.taskStillRunning": "Esta tarea sigue en ejecución. Espera a que se detenga y después ciérrala.",
  "error.backend.threadNotFound": "Este hilo no está disponible.",
  "error.backend.threadStillRunning": "Este hilo sigue en ejecución. Detenlo y vuelve a intentarlo.",
  "error.backend.threadArchived": "Este hilo está archivado. Restáuralo para enviar un mensaje.",
  "error.backend.threadTitleRequired": "Dale al hilo un título corto.",
  "error.backend.threadOpenLimitReached":
    "Este agente tiene {count} hilos abiertos. Archiva un hilo y después inicia o restaura otro.",
  "error.backend.threadRemoteUnsupported": "Los hilos solo están disponibles para los agentes de este equipo.",
  "error.backend.threadMoveRefused":
    "Solo un mensaje que enviaste únicamente a este agente puede ejecutarse en un hilo nuevo.",
  "error.backend.taskTitleRequired": "Dale a la tarea un título corto.",
  "error.backend.taskToolInvalid":
    "Dale a la tarea un título de 120 caracteres como máximo y una descripción que diga qué hay que hacer.",
  "error.backend.taskOwnChatOnly":
    "Inicia una tarea solo desde tu propio chat. Un canal, una conversación de mensajería u otra tarea no pueden iniciarla.",
  "error.backend.taskOpenLimit":
    "Este agente ya tiene {count} tareas abiertas. Espera a que el usuario cierre una antes de iniciar otra tarea.",
  "error.backend.taskOpenLimitReached":
    "Este agente tiene {count} tareas abiertas. Cierra una tarea y después inicia o abre otra.",
  "error.backend.taskRemoteUnsupported": "Las tareas solo están disponibles para los agentes de este equipo.",
  "error.backend.taskStartFailed": "OpenBot no pudo iniciar la tarea. Haz el trabajo en este turno.",
} as const satisfies PartialTranslation<typeof source>;
