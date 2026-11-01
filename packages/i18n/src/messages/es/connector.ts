import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Todos los agentes de este equipo pueden usar tus repositorios, incidencias y solicitudes de incorporación de GitHub, además de gh y git.",
  "connector.github.connect": "Conectar GitHub",
  "connector.github.pendingTitle": "Escribe este código en GitHub",
  "connector.github.pendingDescription": "GitHub se abrió en tu navegador. Escribe allí el código para conectarte.",
  "connector.github.waiting": "Esperando a GitHub",
  "connector.github.copyCode": "Copiar código",
  "connector.github.codeCopied": "Copiado",
  "connector.github.openGitHub": "Abrir GitHub",
  "connector.github.cancel": "Cancelar",
  "connector.github.connectedAs": "Conectado como @{login}",
  "connector.github.repositoriesTitle": "Repositorios",
  "connector.github.repositoriesDescription":
    "Los agentes solo pueden usar los repositorios donde está instalada la aplicación de GitHub de OpenBot.",
  "connector.github.chooseRepositories": "Elegir repositorios",
  "connector.github.repositoriesLoading": "Leyendo los repositorios de GitHub",
  "connector.github.repositoriesFailed": "OpenBot no pudo leer los repositorios de GitHub.",
  "connector.github.noRepositories": "La aplicación de GitHub de OpenBot aún no está instalada en ningún repositorio.",
  "connector.github.moreRepositories": {
    one: "Y {count} repositorio más",
    other: "Y {count} repositorios más",
  },
  "connector.github.private": "Privado",
  "connector.github.disconnect": "Desconectar",
  "connector.github.disconnectTitle": "Desconectar GitHub",
  "connector.github.disconnectSummary":
    "Todos los agentes pierden el acceso a GitHub. Tus chats y archivos se conservan.",
  "connector.github.expiredTitle": "La conexión de GitHub caducó",
  "connector.github.expiredDescription":
    "Vuelve a conectarte como @{login} para devolver a los agentes el acceso a GitHub.",
  "connector.github.reconnect": "Reconectar",
  "connector.github.actionFailed": "OpenBot no pudo cambiar la conexión de GitHub.",
  "connector.github.statusConnected": "Conectado",
  "connector.github.statusConnecting": "Conectando",
  "connector.github.statusExpired": "Caducado",
  "connector.github.accountTitle": "Cuenta",
  "connector.github.filterPlaceholder": {
    one: "Filtrar {count} repositorio",
    other: "Filtrar {count} repositorios",
  },
  "connector.github.filterLabel": "Filtrar repositorios",
  "connector.github.noMatch": "Ningún repositorio coincide con «{query}».",
  "connector.github.stepSignIn": "Iniciar sesión",
  "connector.github.stepConnected": "Conectado",
  "connector.github.requestingCode": "OpenBot solicita un código a GitHub.",
  "connector.github.codeLabel": "Código {code}",
  "connector.github.failedTitle": "GitHub no se conectó",
  "connector.github.cancelConnecting": "Cancelar la conexión a GitHub",
  "connector.github.connectedSummary": {
    one: "{count} repositorio · todos los agentes de este equipo",
    other: "{count} repositorios · todos los agentes de este equipo",
  },
  "connector.github.done": "Listo",
  "connector.github.later": "Más tarde",
  "connector.github.disconnectConfirmTitle": "¿Desconectar GitHub?",
  "connector.github.disconnectConfirmDescription":
    "Al desconectar, se elimina de este equipo el inicio de sesión de @{login}.",
  "connector.github.disconnectEffectTools": "Todos los agentes pierden las herramientas de GitHub, gh y git.",
  "connector.github.disconnectEffectRevoke": "Después se abre GitHub, donde puedes revocar el acceso de OpenBot.",
  "connector.github.disconnectEffectKept":
    "Los chats, los archivos y la memoria de los agentes se conservan en este equipo.",
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "Todos los agentes de {host} pueden usar tus repositorios, incidencias y solicitudes de incorporación de GitHub, además de gh y git.",
  "connector.github.connectedSummaryHost": {
    one: "{count} repositorio · todos los agentes de {host}",
    other: "{count} repositorios · todos los agentes de {host}",
  },
  "connector.github.disconnectConfirmDescriptionHost":
    "Al desconectar, se elimina de {host} el inicio de sesión de @{login}.",
  "connector.github.disconnectEffectKeptHost":
    "Los chats, los archivos y la memoria de los agentes se conservan en {host}.",
  "connector.github.keepConnected": "Mantener la conexión",
  "connector.github.close": "Cerrar",
  "connector.dangerZone": "Zona de peligro",
  "connector.statusUnknown": "Desconocido",
  "connector.readFailed": "OpenBot no pudo leer el estado de esta conexión.",
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Las personas mencionan a @OpenBot en Slack o le envían un mensaje directo. El Orquestador de Slack consulta al agente adecuado y responde.",
  "connector.slack.statusConnected": "Conectado",
  "connector.slack.statusAttention": "Requiere atención",
  "connector.slack.summaryConnected": "{workspace} · Responde el Orquestador de Slack",
  "connector.slack.summaryNoAgent": "{workspace} · Aún no responde ningún agente",
  "connector.slack.attentionTitle": {
    one: "{count} espacio de trabajo requiere atención",
    other: "{count} espacios de trabajo requieren atención",
  },
  "connector.slack.attentionDescription": "El estado que aparece abajo indica qué hacer.",
  "connector.slack.connect": "Conectar Slack",
  "connector.slack.addAgent": "Añadir agente",
  "connector.slack.actionFailed": "Slack no aceptó el cambio",
  "connector.slack.workspaceTitle": "Espacios de trabajo",
  "connector.slack.workspaceDescription": "Las personas mencionan a @OpenBot o le envían un mensaje directo.",
  "connector.slack.disconnectWorkspace": "Desconectar",
  "connector.slack.disconnectAllTitle": "Desconectar Slack",
  "connector.slack.disconnectAllSummary":
    "Se desconectan todos los espacios de trabajo. Nadie podrá contactar con tus agentes a través de @OpenBot.",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "Se desconectan todos los espacios de trabajo. El Orquestador de Slack y sus conversaciones se eliminan de OpenBot.",
  "connector.slack.missingScopes":
    "OpenBot no tiene estos permisos en Slack: {scopes}. Desconecta el espacio de trabajo y vuelve a conectarlo.",
  "connector.slack.retryAt": "Slack pidió a OpenBot que esperara. Lo intentará de nuevo a las {time}.",
  "connector.slack.reconnect": "Reconectar",
  "connector.slack.pause": "Pausar",
  "connector.slack.resume": "Reanudar",
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Orquestador de Slack",
  "connector.slack.orchestratorDescription":
    "Este agente recibe todas las solicitudes de Slack. Responde por sí mismo a las breves, asigna el resto del trabajo al agente adecuado y publica la respuesta en el hilo.",
  "connector.slack.orchestratorNone": "Aún no responde ningún agente",
  "connector.slack.orchestratorNoneDescription": "Añade el Orquestador de Slack o Slack no recibirá respuesta.",
  "connector.slack.inviteNote":
    "OpenBot se une automáticamente a todos los canales públicos y a los nuevos. Para un canal privado, invítalo: /invite @OpenBot.",
  "connector.slack.stepWorkspace": "Espacio de trabajo",
  "connector.slack.stepAgent": "Agente",
  "connector.slack.connectTitle": "Conectar un espacio de trabajo de Slack",
  "connector.slack.connectDescription":
    "OpenBot instala en el espacio de trabajo una aplicación llamada OpenBot, que se une a todos los canales públicos.",
  "connector.slack.connectStepBrowser": "Slack se abre en tu navegador",
  "connector.slack.connectStepAllow":
    "Selecciona el espacio de trabajo en la esquina superior derecha y después Permitir",
  "connector.slack.connectStepReturn": "Este cuadro de diálogo continúa cuando Slack termina",
  "connector.slack.connectInSlack": "Conectar en Slack",
  "connector.slack.connectWaiting": "Esperando a Slack. Termina la instalación en tu navegador.",
  "connector.slack.agentStepTitle": "Añadir el Orquestador de Slack",
  "connector.slack.agentStepDescription":
    "Este nuevo agente responde a todo lo que las personas envían a @OpenBot en {workspace}.",
  "connector.slack.orchestratorName": "Orquestador de Slack",
  "connector.slack.orchestratorRole": "Responde en Slack y consulta al equipo",
  "connector.slack.orchestratorDoesReceive": "Recibe primero todas las solicitudes de Slack",
  "connector.slack.orchestratorDoesDelegate": "Asigna cada tarea al agente más adecuado",
  "connector.slack.orchestratorDoesAnswer": "Publica la respuesta en el hilo de Slack",
  "connector.slack.orchestratorModel": "Modelo",
  "connector.slack.doneTitle": "OpenBot está en {workspace}",
  "connector.slack.doneDescription": "Menciona a @OpenBot en cualquier canal público o envíale un mensaje directo.",
  "connector.slack.done": "Listo",
  "connector.slack.disconnectTitle": "¿Desconectar {workspace}?",
  "connector.slack.disconnectDescription":
    "OpenBot deja de responder en {workspace} y elimina su token de Slack de este equipo.",
  "connector.slack.disconnectDescriptionHost":
    "OpenBot deja de responder en {workspace} y elimina su token de Slack de {host}.",
  "connector.slack.disconnectEffect":
    "Las personas de {workspace} ya no podrán contactar con tus agentes a través de @OpenBot.",
  "connector.slack.removeEffectKept": "Las conversaciones y el Orquestador de Slack permanecen en OpenBot.",
  "connector.slack.removeEffectDeleted": "El Orquestador de Slack y sus conversaciones se eliminan de OpenBot.",
  "connector.slack.keep": "Mantener la conexión",
  "connector.slack.close": "Cerrar",
  "connector.slack.addWorkspace": "Añadir espacio de trabajo",
  "connector.slack.limitReached": {
    one: "Puedes conectar como máximo {count} espacio de trabajo.",
    other: "Puedes conectar como máximo {count} espacios de trabajo.",
  },
  "connector.slack.summaryMany": {
    one: "{count} espacio de trabajo · Responde el Orquestador de Slack",
    other: "{count} espacios de trabajo · Responde el Orquestador de Slack",
  },
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Las personas mencionan a @OpenBot en un canal de un servidor de Discord. El Orquestador de Discord consulta al agente adecuado y responde.",
  "connector.discord.statusConnected": "Conectado",
  "connector.discord.statusAttention": "Requiere atención",
  "connector.discord.summaryConnected": "{workspace} · Responde el Orquestador de Discord",
  "connector.discord.summaryNoAgent": "{workspace} · Aún no responde ningún agente",
  "connector.discord.attentionTitle": {
    one: "{count} servidor de Discord requiere atención",
    other: "{count} servidores de Discord requieren atención",
  },
  "connector.discord.attentionDescription": "El estado que aparece abajo indica qué hacer.",
  "connector.discord.connect": "Conectar Discord",
  "connector.discord.addAgent": "Añadir agente",
  "connector.discord.actionFailed": "Discord no aceptó el cambio",
  "connector.discord.workspaceTitle": "Servidores de Discord",
  "connector.discord.workspaceDescription": "Menciona a @OpenBot en un canal. Responde a OpenBot para continuar.",
  "connector.discord.disconnectWorkspace": "Desconectar",
  "connector.discord.disconnectAllTitle": "Desconectar Discord",
  "connector.discord.disconnectAllSummary":
    "Se desconectan todos los servidores. Nadie podrá contactar con tus agentes a través de @OpenBot.",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "Se desconectan todos los servidores. El Orquestador de Discord y sus conversaciones se eliminan de OpenBot.",
  "connector.discord.missingScopes":
    "OpenBot no tiene estos permisos en Discord: {scopes}. Desconecta el servidor de Discord y vuelve a conectarlo.",
  "connector.discord.retryAt": "Discord pidió a OpenBot que esperara. Lo intentará de nuevo a las {time}.",
  "connector.discord.reconnect": "Reconectar",
  "connector.discord.pause": "Pausar",
  "connector.discord.resume": "Reanudar",
  "connector.discord.rowAction": "{action}: {name}",
  "connector.discord.orchestratorTitle": "Orquestador de Discord",
  "connector.discord.orchestratorDescription":
    "Este agente recibe todas las solicitudes de Discord. Responde por sí mismo a las breves, asigna el resto del trabajo al agente adecuado y responde en el canal.",
  "connector.discord.orchestratorNone": "Aún no responde ningún agente",
  "connector.discord.orchestratorNoneDescription": "Añade el Orquestador de Discord o Discord no recibirá respuesta.",
  "connector.discord.channelsNote": "OpenBot ve los canales que su rol puede ver.",
  "connector.discord.stepWorkspace": "Servidor de Discord",
  "connector.discord.stepAgent": "Agente",
  "connector.discord.connectTitle": "Conectar un servidor de Discord",
  "connector.discord.connectDescription": "OpenBot añade un bot llamado OpenBot al servidor de Discord.",
  "connector.discord.connectStepBrowser": "Discord se abre en tu navegador",
  "connector.discord.connectStepAllow": "Selecciona el servidor y después Autorizar",
  "connector.discord.connectStepReturn": "Este cuadro de diálogo continúa cuando Discord termina",
  "connector.discord.connectInDiscord": "Conectar en Discord",
  "connector.discord.connectWaiting": "Esperando a Discord. Termina la autorización en tu navegador.",
  "connector.discord.agentStepTitle": "Añadir el Orquestador de Discord",
  "connector.discord.agentStepDescription":
    "Este nuevo agente responde a todo lo que las personas envían a @OpenBot en {workspace}.",
  "connector.discord.orchestratorName": "Orquestador de Discord",
  "connector.discord.orchestratorRole": "Responde en Discord y consulta al equipo",
  "connector.discord.orchestratorDoesReceive": "Recibe primero todas las solicitudes de Discord",
  "connector.discord.orchestratorDoesDelegate": "Asigna cada tarea al agente más adecuado",
  "connector.discord.orchestratorDoesAnswer": "Responde en el canal de Discord",
  "connector.discord.orchestratorModel": "Modelo",
  "connector.discord.doneTitle": "OpenBot está en {workspace}",
  "connector.discord.doneDescription": "Menciona a @OpenBot en un canal. Responde a OpenBot para continuar.",
  "connector.discord.done": "Listo",
  "connector.discord.disconnectTitle": "¿Desconectar {workspace}?",
  "connector.discord.disconnectDescription":
    "OpenBot deja de responder en {workspace} y elimina la conexión de Discord de este equipo.",
  "connector.discord.disconnectDescriptionHost":
    "OpenBot deja de responder en {workspace} y elimina la conexión de Discord de {host}.",
  "connector.discord.disconnectEffect":
    "Las personas de {workspace} ya no podrán contactar con tus agentes a través de @OpenBot.",
  "connector.discord.removeEffectKept": "Las conversaciones y el Orquestador de Discord permanecen en OpenBot.",
  "connector.discord.removeEffectDeleted": "El Orquestador de Discord y sus conversaciones se eliminan de OpenBot.",
  "connector.discord.keep": "Mantener la conexión",
  "connector.discord.close": "Cerrar",
  "connector.discord.addWorkspace": "Añadir servidor de Discord",
  "connector.discord.limitReached": {
    one: "Puedes conectar como máximo {count} servidor de Discord.",
    other: "Puedes conectar como máximo {count} servidores de Discord.",
  },
  "connector.discord.summaryMany": {
    one: "{count} servidor de Discord · Responde el Orquestador de Discord",
    other: "{count} servidores de Discord · Responde el Orquestador de Discord",
  },
  "connector.discord.accessTitle": "Quién puede usar OpenBot",
  "connector.discord.accessDescription": "OpenBot solo responde a estas personas. Ignora las menciones de los demás.",
  "connector.discord.accessEveryone": "Todos en el servidor",
  "connector.discord.accessEveryoneDescription":
    "Cualquiera que pueda publicar en un canal que OpenBot ve puede mencionarlo.",
  "connector.discord.accessRoles": "Miembros con {roles}",
  "connector.discord.accessChoose": "Elegir roles",
  "connector.discord.accessDialogTitle": "¿Quién puede usar OpenBot en {workspace}?",
  "connector.discord.accessDialogDescription": "Si no seleccionas ningún rol, todos pueden mencionar a OpenBot.",
  "connector.discord.accessLoading": "Cargando roles…",
  "connector.discord.accessLoadFailed": "No se cargaron los roles de Discord",
  "connector.discord.accessNoRoles": "Este servidor no tiene roles para elegir.",
  "connector.discord.accessRoleDeleted": "{role} (eliminado)",
  "connector.discord.accessSave": "Guardar",
  "connector.discord.accessHostUpdate": "Actualiza OpenBot en {host} para elegir roles.",
  "connector.telegram.title": "Telegram Bot",
  "connector.telegram.developer": "Telegram",
  "connector.telegram.description":
    "Añade el bot de OpenBot a un grupo de Telegram o abre un chat directo con él. El Orquestador de Telegram consulta al agente adecuado y responde.",
  "connector.telegram.statusConnected": "Conectado",
  "connector.telegram.statusAttention": "Requiere atención",
  "connector.telegram.summaryConnected": {
    one: "{count} chat · Responde el Orquestador de Telegram",
    other: "{count} chats · Responde el Orquestador de Telegram",
  },
  "connector.telegram.summaryNoAgent": {
    one: "{count} chat · Aún no responde ningún agente",
    other: "{count} chats · Aún no responde ningún agente",
  },
  "connector.telegram.attentionTitle": {
    one: "{count} chat requiere atención",
    other: "{count} chats requieren atención",
  },
  "connector.telegram.attentionDescription": "El estado que aparece abajo indica qué hacer.",
  "connector.telegram.connect": "Conectar Telegram",
  "connector.telegram.addAgent": "Añadir agente",
  "connector.telegram.actionFailed": "Telegram no aceptó el cambio",
  "connector.telegram.chatsTitle": "Chats",
  "connector.telegram.groupDescription": "Las personas mencionan al bot o responden a sus mensajes.",
  "connector.telegram.directDescription": "Cada mensaje de este chat va al Orquestador de Telegram.",
  "connector.telegram.helpRemoved":
    "El bot de OpenBot ya no está en este chat. Desconecta el chat y vuelve a añadir el bot.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot no puede recibir mensajes de Telegram en este equipo. Inicia sesión, ponle un nombre a este equipo en Ajustes del servidor y mantén OpenBot abierto.",
  "connector.telegram.helpRelayUnavailableHost":
    "OpenBot en {host} no puede recibir mensajes de Telegram. En {host}, inicia sesión, ponle un nombre al servidor en Ajustes del servidor y mantén OpenBot abierto.",
  "connector.telegram.helpError": "OpenBot no puede acceder a este chat. Vuelve a conectar o desconecta el chat.",
  "connector.telegram.retryAt": "Telegram pidió a OpenBot que esperara. Lo intentará de nuevo a las {time}.",
  "connector.telegram.pause": "Pausar",
  "connector.telegram.resume": "Reanudar",
  "connector.telegram.reconnect": "Reconectar",
  "connector.telegram.disconnectChat": "Desconectar",
  "connector.telegram.disconnectAllTitle": "Desconectar Telegram",
  "connector.telegram.disconnectAllSummary":
    "Se desconectan todos los chats. Nadie podrá contactar con tus agentes a través del bot de OpenBot.",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "Se desconectan todos los chats. El Orquestador de Telegram y sus conversaciones se eliminan de OpenBot.",
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkChat": "Vincular un chat",
  "connector.telegram.addToGroup": "Añadir a un grupo",
  "connector.telegram.openDirectChat": "Abrir un chat directo",
  "connector.telegram.orchestratorTitle": "Orquestador de Telegram",
  "connector.telegram.orchestratorDescription":
    "Este agente recibe los mensajes para OpenBot de todos tus chats de Telegram. Responde él mismo a los cortos, asigna el resto del trabajo al agente adecuado y publica la respuesta en el chat.",
  "connector.telegram.orchestratorNone": "Aún no responde ningún agente",
  "connector.telegram.orchestratorNoneDescription":
    "Añade el Orquestador de Telegram o Telegram no recibirá respuesta.",
  "connector.telegram.mentionNote":
    "En un grupo, menciona al bot o responde a sus mensajes. En un chat directo, cada mensaje va al bot.",
  "connector.telegram.stepChat": "Chat",
  "connector.telegram.stepAgent": "Agente",
  "connector.telegram.connectTitle": "Vincular un chat de Telegram",
  "connector.telegram.connectDescription":
    "Añade el bot de OpenBot a un grupo o abre un chat directo con él. Un solo bot atiende todos tus chats.",
  "connector.telegram.connectStepBrowser": "Telegram se abre en tu navegador",
  "connector.telegram.connectStepPick": "Selecciona el grupo o pulsa Iniciar en el chat directo",
  "connector.telegram.connectStepReturn": "Este cuadro de diálogo continúa cuando el chat esté vinculado",
  "connector.telegram.connectWaiting": "Esperando a Telegram. Selecciona el chat en Telegram.",
  "connector.telegram.agentStepTitle": "Añadir el Orquestador de Telegram",
  "connector.telegram.agentStepDescription":
    "Este nuevo agente responde a los mensajes para OpenBot en {chat} y en cada chat que vincules más adelante.",
  "connector.telegram.orchestratorName": "Orquestador de Telegram",
  "connector.telegram.orchestratorRole": "Responde en Telegram y consulta al equipo",
  "connector.telegram.orchestratorDoesReceive": "Recibe primero cada mensaje de Telegram para OpenBot",
  "connector.telegram.orchestratorDoesDelegate": "Asigna cada tarea al agente más adecuado",
  "connector.telegram.orchestratorDoesAnswer": "Publica la respuesta en el chat de Telegram",
  "connector.telegram.orchestratorModel": "Modelo",
  "connector.telegram.doneTitle": "OpenBot está en {chat}",
  "connector.telegram.done": "Listo",
  "connector.telegram.disconnectTitle": "¿Desconectar {chat}?",
  "connector.telegram.leaveDescription": "El bot de OpenBot sale de {chat} y OpenBot deja de responder allí.",
  "connector.telegram.disconnectEffect":
    "Las personas de {chat} ya no podrán comunicarse con tus agentes a través del bot de OpenBot.",
  "connector.telegram.removeEffectKept": "Las conversaciones y el Orquestador de Telegram permanecen en OpenBot.",
  "connector.telegram.removeEffectDeleted":
    "Es el último chat, así que el Orquestador de Telegram y sus conversaciones se eliminan de OpenBot.",
  "connector.telegram.keep": "Mantener la conexión",
  "connector.telegram.close": "Cerrar",
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "Comparte con OpenBot una bóveda exclusiva de 1Password mediante una cuenta de servicio para que los agentes puedan iniciar sesión en sitios desde el navegador de OpenBot.",
  "connector.onePassword.howItWorks":
    "Al conectar, se crea una bóveda «Shared with OpenBot» en tu cuenta de 1Password y una cuenta de servicio que solo puede leer esa bóveda. OpenBot rellena los inicios de sesión guardados en su navegador en este equipo, por lo que solo se comparten los elementos que muevas a esa bóveda. Los agentes nunca ven contraseñas.",
  "connector.onePassword.connect": "Conectar 1Password",
  "connector.onePassword.setupTitle": "Configurar",
  "connector.onePassword.stepCliTitle": "Instalar la CLI de 1Password",
  "connector.onePassword.stepCliChecking": "Buscando la CLI de 1Password en este equipo",
  "connector.onePassword.stepCliInstalling": "Descargando la CLI de 1Password desde 1Password",
  "connector.onePassword.stepCliReady": "La versión {version} está instalada.",
  "connector.onePassword.stepCliMissing":
    "OpenBot la descarga desde 1Password a su propia carpeta. No necesita contraseña de administrador.",
  "connector.onePassword.stepCliManual":
    "OpenBot no puede instalarla en este equipo. Instálala desde 1Password y vuelve a esta página.",
  "connector.onePassword.installCli": "Instalar",
  "connector.onePassword.stepAppTitle": "Activar la integración con la CLI",
  "connector.onePassword.stepAppDescription":
    "En la aplicación de 1Password, abre Ajustes > Desarrollador y activa «Integrar con la CLI de 1Password».",
  "connector.onePassword.stepAppReady": "La aplicación de 1Password permite que la CLI cree la bóveda compartida.",
  "connector.onePassword.openApp": "Abrir 1Password",
  "connector.onePassword.openAppFailed": "OpenBot no pudo abrir 1Password.",
  "connector.onePassword.checkAgain": "Comprobar",
  "connector.onePassword.stepVaultTitle": "Crear la bóveda compartida",
  "connector.onePassword.stepVaultDescription":
    "OpenBot crea la bóveda «Shared with OpenBot» y una cuenta de servicio que solo puede leerla. 1Password te pide que lo apruebes.",
  "connector.onePassword.useTokenDescription":
    "En lugar de estos pasos, pega un token de cuenta de servicio de 1Password.com.",
  "connector.onePassword.useTokenAction": "Usar token",
  "connector.onePassword.tokenLabel": "Token de cuenta de servicio",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "Conectar",
  "connector.onePassword.approveInApp": "Aprueba la solicitud en la aplicación de 1Password",
  "connector.onePassword.cancel": "Cancelar",
  "connector.onePassword.chooseAccountTitle": "Elegir una cuenta",
  "connector.onePassword.chooseAccountDescription": "OpenBot crea la bóveda compartida en la cuenta que elijas.",
  "connector.onePassword.useAccount": "Usar esta cuenta",
  "connector.onePassword.vaultTitle": "Bóveda compartida",
  "connector.onePassword.vaultDescription":
    "Mueve un inicio de sesión a esta bóveda en 1Password para que los agentes puedan usarlo. Retíralo para impedir su uso.",
  "connector.onePassword.loginsLoading": "Leyendo los inicios de sesión de 1Password",
  "connector.onePassword.loginCount": {
    one: "{count} inicio de sesión",
    other: "{count} inicios de sesión",
  },
  "connector.onePassword.disconnect": "Desconectar",
  "connector.onePassword.disconnectTitle": "Desconectar 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot olvida el token. La bóveda y la cuenta de servicio permanecen en 1Password; elimínalas allí si ya no las necesitas.",
  "connector.onePassword.actionFailed": "OpenBot no pudo cambiar la conexión de 1Password.",
  "connector.onePassword.statusConnected": "Conectado",
  "connector.onePassword.statusConnecting": "Conectando",
  "connector.onePassword.descriptionHost":
    "Comparte con OpenBot en {host} una bóveda exclusiva de 1Password mediante una cuenta de servicio, para que los agentes de {host} puedan iniciar sesión en sitios desde su navegador.",
  "connector.onePassword.howItWorksHost":
    "{host} se conecta con un token de cuenta de servicio. En 1Password.com, crea una cuenta de servicio que solo pueda leer la bóveda que compartes con OpenBot y pega aquí su token. {host} comprueba el token y lo guarda; este equipo no. Los agentes nunca ven una contraseña.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} olvida el token. La bóveda y la cuenta de servicio permanecen en 1Password; elimínalas allí si ya no las necesitas.",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Rellena los inicios de sesión del navegador desde Bitwarden.",
  "connector.bitwarden.setup":
    "Instala la CLI de Bitwarden e inicia sesión con bw login. Crea una carpeta llamada Shared with OpenBot y guarda en ella solo los inicios de sesión que puedan usar los agentes. Ejecuta bw unlock --raw y pega la clave de sesión abajo. No pegues tu contraseña maestra.",
  "connector.bitwarden.scope":
    "Todos los agentes de este equipo pueden usar los inicios de sesión coincidentes de Shared with OpenBot. OpenBot usa orígenes HTTPS exactos. No usa elementos que requieran solicitar la contraseña maestra ni una regla personalizada de coincidencia de URI.",
  "connector.bitwarden.session":
    "La clave de sesión permanece en memoria. Vuelve a conectarte tras 8 horas sin usar la bóveda o después de cerrar OpenBot. Desconectar detiene el acceso de OpenBot; no bloquea otros clientes de Bitwarden.",
  "connector.bitwarden.sessionKey": "Clave de sesión de Bitwarden",
  "connector.bitwarden.connect": "Conectar Bitwarden",
  "connector.bitwarden.disconnect": "Desconectar Bitwarden",
  "connector.bitwarden.disconnectAction": "Desconectar",
  "connector.bitwarden.disconnectSummary":
    "OpenBot olvida la clave de sesión. Los agentes ya no pueden rellenar inicios de sesión desde Bitwarden. Los demás clientes de Bitwarden siguen desbloqueados.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} elimina la clave de API y la contraseña maestra. Los agentes de {host} ya no pueden rellenar inicios de sesión desde Bitwarden.",
  "connector.bitwarden.connected": "Conectado",
  "connector.bitwarden.actionFailed": "OpenBot no pudo cambiar la conexión de Bitwarden.",
  "connector.bitwarden.descriptionHost":
    "Rellena los inicios de sesión del navegador en {host} desde Bitwarden o Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} inicia sesión con su propia CLI de Bitwarden. En tu caja fuerte, crea una carpeta llamada Shared with OpenBot y pon en ella solo los inicios de sesión que los agentes pueden usar. En la caja fuerte web, abre Configuración › Seguridad › Claves y muestra tu clave de API. Introduce abajo la dirección del servidor, client_id, client_secret y tu contraseña maestra.",
  "connector.bitwarden.scopeHost":
    "Todos los agentes de {host} pueden usar los inicios de sesión coincidentes de Shared with OpenBot. OpenBot usa orígenes HTTPS exactos. No usa elementos que piden la contraseña maestra ni los que tienen una regla de coincidencia de URI personalizada.",
  "connector.bitwarden.sessionHost":
    "{host} guarda la clave de API y la contraseña maestra cifradas, para poder desbloquear de nuevo después de reiniciarse. Este ordenador no las guarda. Desconectar las elimina de {host}. {host} debe llegar a la dirección del servidor por HTTPS.",
  "connector.bitwarden.serverUrl": "Dirección del servidor",
  "connector.bitwarden.folderTitle": "Carpeta compartida",
  "connector.bitwarden.folderDescription":
    "Mueve un inicio de sesión a esta carpeta en Bitwarden para que los agentes puedan usarlo. Retíralo para impedir su uso.",
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Carpeta en Bitwarden",
  "connector.bitwarden.clientId": "client_id de la clave de API",
  "connector.bitwarden.clientSecret": "client_secret de la clave de API",
  "connector.bitwarden.masterPassword": "Contraseña maestra",
  "connector.bitwarden.connecting": "Conectando",
  "connector.telegramAccount.title": "Cuenta de Telegram",
  "connector.telegramAccount.description":
    "Los agentes pueden leer tus chats de Telegram y, si lo permites, enviar mensajes en tu nombre.",
  "connector.telegramAccount.descriptionHost":
    "Los agentes de {host} pueden leer tus chats de Telegram y, si lo permites, enviar mensajes en tu nombre.",
  "connector.telegramAccount.statusConnecting": "Iniciando sesión",
  "connector.telegramAccount.statusConnected": "Conectado",
  "connector.telegramAccount.actionFailed": "OpenBot no pudo cambiar la conexión de la cuenta de Telegram.",
  "connector.telegramAccount.disconnectTitle": "Desconectar la cuenta de Telegram",
  "connector.telegramAccount.disconnectSummary":
    "OpenBot cierra esta sesión. Los agentes ya no pueden leer ni enviar mensajes, y el envío se desactiva.",
  "connector.telegramAccount.disconnectSummaryHost":
    "{host} cierra esta sesión. Los agentes de {host} ya no pueden leer ni enviar mensajes, y el envío se desactiva.",
  "connector.telegramAccount.disconnect": "Desconectar",
  "connector.telegramAccount.signInTitle": "Iniciar sesión",
  "connector.telegramAccount.howItWorks":
    "OpenBot inicia sesión en tu propia cuenta de Telegram, como Telegram Desktop. La sesión queda cifrada en este ordenador. Telegram la muestra en Ajustes › Dispositivos como OpenBot.",
  "connector.telegramAccount.howItWorksHost":
    "{host} inicia sesión en tu propia cuenta de Telegram, como Telegram Desktop. La sesión queda cifrada en {host}. Telegram la muestra en Ajustes › Dispositivos como OpenBot.",
  "connector.telegramAccount.signInProgress":
    "Completa el paso de abajo para iniciar sesión. Cancelar detiene el inicio de sesión.",
  "connector.telegramAccount.methodTitle": "Iniciar sesión con",
  "connector.telegramAccount.methodQrDescription": "Escanea un código con Telegram en tu teléfono.",
  "connector.telegramAccount.methodPhoneDescription":
    "Escribe tu número de teléfono y el código que te envía Telegram.",
  "connector.telegramAccount.methodQr": "Código QR",
  "connector.telegramAccount.methodPhone": "Teléfono",
  "connector.telegramAccount.credentialsTitle": "api_id y api_hash",
  "connector.telegramAccount.credentialsStored":
    "OpenBot usa tu propia app de Telegram de my.telegram.org. Tras el primer inicio de sesión, este ordenador guarda su api_id y su api_hash.",
  "connector.telegramAccount.credentialsStoredHost":
    "OpenBot usa tu propia app de Telegram de my.telegram.org. Tras el primer inicio de sesión, {host} guarda su api_id y su api_hash.",
  "connector.telegramAccount.credentialsOpen": "Introducir",
  "connector.telegramAccount.credentialsHelp":
    "Inicia sesión en my.telegram.org, abre API development tools y crea una app. Copia aquí su api_id y su api_hash.",
  "connector.telegramAccount.apiId": "api_id",
  "connector.telegramAccount.apiHash": "api_hash",
  "connector.telegramAccount.openApps": "Abrir my.telegram.org",
  "connector.telegramAccount.openAppsFailed": "OpenBot no pudo abrir my.telegram.org.",
  "connector.telegramAccount.connect": "Conectar",
  "connector.telegramAccount.sendingOffNote": "Los agentes solo pueden leer tus chats hasta que actives el envío.",
  "connector.telegramAccount.devicesNote":
    "Telegram muestra esta sesión en Ajustes › Dispositivos como OpenBot. Si la cierras allí, OpenBot se desconecta.",
  "connector.telegramAccount.devicesNoteHost":
    "Telegram muestra esta sesión en Ajustes › Dispositivos como OpenBot. Si la cierras allí, {host} se desconecta.",
  "connector.telegramAccount.connecting": "Conectando con Telegram",
  "connector.telegramAccount.connectingDescription":
    "Este ordenador se comunica con Telegram. Puede tardar unos segundos.",
  "connector.telegramAccount.connectingHost": "{host} se comunica con Telegram. Puede tardar unos segundos.",
  "connector.telegramAccount.qrLabel": "Código QR para iniciar sesión en Telegram",
  "connector.telegramAccount.qrTitle": "Escanea este código con Telegram en tu teléfono",
  "connector.telegramAccount.qrStepOpen": "Abre Telegram en tu teléfono.",
  "connector.telegramAccount.qrStepDevices": "Ve a Ajustes › Dispositivos › Vincular dispositivo de escritorio.",
  "connector.telegramAccount.qrStepScan": "Apunta el teléfono a este código.",
  "connector.telegramAccount.qrRefresh": "El código cambia cada 30 segundos aproximadamente. Escanea el más reciente.",
  "connector.telegramAccount.usePhone": "Usar teléfono",
  "connector.telegramAccount.phoneDescription":
    "Escribe el número de teléfono de tu cuenta de Telegram, con el prefijo del país.",
  "connector.telegramAccount.phoneLabel": "Número de teléfono",
  "connector.telegramAccount.sendCode": "Enviar código",
  "connector.telegramAccount.phonePlaceholder": "+48 600 100 200",
  "connector.telegramAccount.useQr": "Usar código QR",
  "connector.telegramAccount.codeViaApp": "Telegram envió un código a la app de Telegram de tus otros dispositivos.",
  "connector.telegramAccount.codeViaSms": "Telegram envió un código por SMS.",
  "connector.telegramAccount.codeDescription": "Escribe el código que te envió Telegram.",
  "connector.telegramAccount.codeLabel": "Código",
  "connector.telegramAccount.signIn": "Iniciar sesión",
  "connector.telegramAccount.passwordDescription": "Tu cuenta tiene verificación en dos pasos. Escribe su contraseña.",
  "connector.telegramAccount.passwordHint": "Pista: {hint}",
  "connector.telegramAccount.passwordLabel": "Contraseña de verificación en dos pasos",
  "connector.telegramAccount.accountTitle": "Cuenta",
  "connector.telegramAccount.accountDescription": "Los agentes de este ordenador usan esta cuenta de Telegram.",
  "connector.telegramAccount.accountDescriptionHost": "Los agentes de {host} usan esta cuenta de Telegram.",
  "connector.telegramAccount.sendingLabel": "Permitir que los agentes envíen mensajes y marquen chats como leídos",
  "connector.telegramAccount.sendingDescription": "Si está desactivado, los agentes solo pueden leer tus chats.",
} as const satisfies PartialTranslation<typeof source>;
