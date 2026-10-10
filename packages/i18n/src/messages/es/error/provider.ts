import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot no pudo registrar los servidores MCP en la configuración de Codex. Comprueba que tu config.toml de Codex sea válido y se pueda escribir, y reinicia OpenBot.",
  "error.provider.computerUseConfig":
    "OpenBot no pudo registrar el uso del equipo en la configuración de Codex. Comprueba que tu config.toml de Codex sea válido y se pueda escribir, y reinicia OpenBot. Puedes desactivar el uso del equipo en los ajustes del compañero para continuar sin él.",
  "error.provider.endpointsReadOnly":
    "Los endpoints guardados se escribieron con una versión más reciente de OpenBot o el archivo no se puede leer. Actualiza OpenBot para cambiarlos.",
  "error.provider.endpointNoSecureStorage":
    "Este equipo no tiene almacenamiento seguro, por lo que no se puede guardar una clave API ni una cabecera. Elimínalas o usa un endpoint que no necesite credenciales.",
  "error.provider.endpointDuplicate":
    "Ya hay un endpoint guardado con este ID de proveedor. Elimínalo primero o usa otro ID.",
  "error.provider.endpointNotSaved": "Este endpoint no está guardado. Actualiza la lista e inténtalo de nuevo.",
  "error.provider.endpointKeyForNewAddress":
    "La dirección tiene un nuevo host o puerto. Introduce la clave API y las cabeceras de nuevo para no enviar las guardadas a esa dirección.",
  "error.provider.endpointSecretUnreadable":
    "Este equipo no puede leer la clave API ni las cabeceras guardadas. Introdúcelas de nuevo para que no se pierda ninguna.",
  "error.provider.discoveryTimeout": "{host} no respondió a tiempo.",
  "error.provider.discoveryUnreachable": "OpenBot no pudo conectarse a {host}.",
  "error.provider.discoveryRedirect": "{host} envió una redirección. Introduce la dirección final del servidor.",
  "error.provider.discoveryRefused": "{host} rechazó la solicitud. Comprueba la clave API y las cabeceras.",
  "error.provider.discoveryHttp": "{host} respondió con HTTP {status}.",
  "error.provider.discoveryTooLarge": "La lista de modelos de {host} es demasiado grande.",
  "error.provider.discoveryInvalid": "{host} no envió una lista de modelos compatible con OpenAI.",
  "error.provider.detectionSettingsReadOnly":
    "Los ajustes de detección se escribieron con una versión más reciente de OpenBot o el archivo no se puede leer. Actualiza OpenBot para cambiarlos.",
  "error.provider.detectionEntryInvalid":
    "Una dirección debe ser una URL http:// o https:// sin contraseña, y una carpeta debe ser una ruta absoluta.",
  "error.provider.detectionEntriesTooMany": "Hay demasiadas direcciones o carpetas.",
  "error.provider.credentialFileUnreadable": "El archivo de credenciales del proveedor no se puede leer.",
  "error.provider.credentialFileTooLarge": "El archivo de credenciales del proveedor es demasiado grande.",
  "error.provider.archiveSpecialFile": "El archivo del entorno de ejecución contiene un enlace o un archivo especial.",
  "error.provider.archiveUnsafePath": "El archivo del entorno de ejecución contiene una ruta no segura.",
  "error.provider.runtimeSpecialFile": "El entorno de ejecución contiene un enlace o un archivo especial.",
  "error.provider.codexArchivePath": "El archivo de Codex tiene una ruta inesperada.",
  "error.provider.codexVersionUnexpected": "Versión inesperada del entorno de ejecución de Codex.",
  "error.provider.claudeArchivePath": "El archivo de Claude tiene una ruta inesperada.",
  "error.provider.claudePackageMismatch": "El paquete de Claude no coincide con el catálogo de entornos de ejecución.",
  "error.provider.claudeChecksum": "La suma de comprobación del entorno de ejecución de Claude no coincide.",
  "error.provider.claudeLicenseChecksum": "La suma de comprobación de la licencia de Claude no coincide.",
  "error.provider.opencodeArchivePath": "El archivo de OpenCode tiene una ruta inesperada.",
  "error.provider.opencodePackageMismatch":
    "El paquete de OpenCode no coincide con el catálogo de entornos de ejecución.",
  "error.provider.opencodeChecksum": "La suma de comprobación del entorno de ejecución de OpenCode no coincide.",
  "error.provider.opencodeLicenseChecksum": "La suma de comprobación de la licencia de OpenCode no coincide.",
  "error.provider.grokChecksum": "La suma de comprobación del entorno de ejecución de Grok no coincide.",
  "error.provider.grokLicenseChecksum": "La suma de comprobación de la licencia de Grok no coincide.",
  "error.provider.grokNoticesChecksum": "La suma de comprobación de los avisos de Grok no coincide.",
  "error.provider.bunArchivePath": "El archivo de Bun tiene una ruta inesperada.",
  "error.provider.bunPackageMismatch": "El paquete de Bun no coincide con el catálogo de entornos de ejecución.",
  "error.provider.bunChecksum": "La suma de comprobación del entorno de ejecución de Bun no coincide.",
  "error.provider.bunLicenseChecksum": "La suma de comprobación de la licencia de Bun no coincide.",
  "error.provider.bunxDamaged": "El ejecutor del gestor de paquetes de Bun falta o está dañado.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot no pudo acceder a las fuentes de versiones del proveedor. Comprueba la conexión e inténtalo de nuevo.",
  "error.provider.runtimesUnsupported":
    "Los entornos de ejecución de proveedores no están disponibles en esta plataforma.",
  "error.provider.closing": "OpenBot se está cerrando.",
  "error.provider.cliOverride": "Elimina la ruta de CLI definida explícitamente antes de actualizar en OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "La actualización del entorno de ejecución no se completó.",
  "error.provider.downloadHttp": "La descarga del entorno de ejecución falló con HTTP {status}.",
  "error.provider.downloadNoData": "La descarga del entorno de ejecución no devolvió datos.",
  "error.provider.downloadSize": "La descarga del entorno de ejecución tiene un tamaño inesperado.",
  "error.provider.downloadIntegrity": "La descarga del entorno de ejecución no superó la comprobación de integridad.",
  "error.provider.runtimeReplacing":
    "No se pudo instalar el entorno de ejecución porque otra instancia lo está reemplazando.",
  "error.provider.runtimeFilesInUse":
    "No se pudo instalar el entorno de ejecución porque otro programa tiene sus archivos abiertos. Ciérralo e inténtalo de nuevo.",
  "error.provider.metadataHttp": "La descarga de metadatos del entorno de ejecución falló con HTTP {status}.",
  "error.provider.metadataIntegrity":
    "Los metadatos del entorno de ejecución no superaron la comprobación de integridad.",
  "error.provider.diskSpace": "No hay suficiente espacio libre en disco para este proveedor.",
  "error.provider.unexpectedVersion": "El entorno de ejecución del proveedor devolvió una versión inesperada.",
  "error.provider.metadataNoData": "La descarga de metadatos del entorno de ejecución no devolvió datos.",
  "error.provider.metadataTooLarge": "Los metadatos del entorno de ejecución son demasiado grandes.",
  "error.provider.requestFailed": "OpenBot no pudo descargar {url}. {reason}",
  "error.provider.installRecordMismatch": "El registro de instalación del entorno de ejecución no coincide.",
  "error.provider.runtimeChecksum": "La suma de comprobación del entorno de ejecución del proveedor no coincide.",
  "error.provider.codexReleaseShape": "La versión de Codex tiene una estructura inesperada.",
  "error.provider.codexReleaseNoDownload": "La versión de Codex no tiene una descarga verificable para este equipo.",
  "error.provider.claudeReleaseShape": "La versión de Claude tiene una estructura inesperada.",
  "error.provider.grokReleaseVersion": "La publicación de Grok tiene una versión inesperada.",
  "error.provider.blockedListShape": "La lista de versiones bloqueadas tiene una estructura inesperada.",
  "error.provider.releaseNoDownload": "La versión de {name} no tiene una descarga verificable.",
  "error.provider.releaseSizeUnknown": "Se desconoce el tamaño de la descarga de la versión.",
  "error.provider.releaseMetadataNotObject": "Los metadatos de la versión no son un objeto JSON.",
  "error.provider.releaseCheckHttp": "La comprobación de la versión falló con HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "Los metadatos de la versión son demasiado grandes.",
  "error.provider.idInvalid": "Un ID de proveedor debe contener letras minúsculas, dígitos, `-` o `_`.",
  "error.provider.baseUrlInvalid": "La URL base no es una URL.",
  "error.provider.baseUrlProtocol": "La URL base debe empezar por http:// o https://.",
  "error.provider.baseUrlCredentials":
    "La URL base no debe contener un nombre de usuario ni una contraseña. Pon la credencial en una cabecera.",
  "error.provider.modelsRequired": "Se requiere al menos un modelo.",
  "error.provider.modelsTooMany": "Hay demasiados modelos.",
  "error.provider.modelIdCharacter": "Un ID de modelo contiene un carácter no permitido.",
  "error.provider.modelIdDuplicate": "Dos modelos tienen el mismo ID.",
  "error.provider.headersTooMany": "Hay demasiadas cabeceras.",
  "error.provider.headerNameCharacter": "El nombre de una cabecera contiene un carácter que HTTP no permite.",
  "error.provider.headerNameTooLong": "El nombre de una cabecera es demasiado largo.",
  "error.provider.headerNameDuplicate": "Dos cabeceras tienen el mismo nombre.",
  "error.provider.headerValueInvalid": "Falta el valor de una cabecera o es demasiado largo.",
  "error.provider.apiKeyTooLong": "La clave API es demasiado larga.",
  "error.provider.localOnly": "Los proveedores solo se pueden cambiar en el equipo que ejecuta los agentes.",
  "error.provider.keyRequired": "Se requiere una clave de proveedor.",
  "error.provider.keyTooLong": "La clave del proveedor es demasiado larga.",
  "error.provider.noModel": "El proveedor seleccionado no tiene ningún modelo disponible.",
  "error.provider.noModelNamed": "{provider} no tiene ningún modelo disponible.",
  "error.provider.acpNoModels":
    "La CLI de ACP no anunció ningún modelo ACP. OpenBot no adivinará un modelo alternativo.",
  "error.provider.endpointRemoveBusy":
    "Espera a que terminen el turno activo y la cola antes de eliminar este endpoint.",
  "error.provider.codexOutdated": "Codex CLI {version} es demasiado antiguo. OpenBot requiere 0.156.0 o posterior.",
  "error.provider.codexNotStarted": "Se encontró Codex CLI, pero no se pudo iniciar.",
  "error.provider.codexNotStartedHint":
    "Se encontró Codex CLI, pero no se pudo iniciar. Ejecuta `codex --version` en una nueva terminal.",
  "error.provider.codexMissing": "ChatGPT no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.codexConfigIgnored": {
    one: "Codex ignoró {count} ajuste de su configuración: {settings}. Corrígelo, elimínalo o actualiza Codex.",
    other: "Codex ignoró {count} ajustes de su configuración: {settings}. Corrígelos, elimínalos o actualiza Codex.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    one: "Codex ignoró {count} ajuste de su configuración. Corrígelo, elimínalo o actualiza Codex.",
    other: "Codex ignoró {count} ajustes de su configuración. Corrígelos, elimínalos o actualiza Codex.",
  },
  "error.provider.claudeOutdated": "Claude Code {version} es demasiado antiguo. OpenBot requiere 2.1.232 o posterior.",
  "error.provider.claudeNotStarted": "Se encontró Claude CLI, pero no se pudo iniciar.",
  "error.provider.claudeNotStartedHint":
    "Se encontró Claude CLI, pero no se pudo iniciar. Ejecuta `claude --version` en una nueva terminal.",
  "error.provider.claudeMissing": "Claude no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.grokOutdated": "Grok CLI {version} es demasiado antiguo. OpenBot requiere 1.0.5 o posterior.",
  "error.provider.grokNotStarted": "Se encontró Grok CLI, pero no se pudo iniciar.",
  "error.provider.grokNotStartedHint":
    "Se encontró Grok CLI, pero no se pudo iniciar. Ejecuta `grok --version` en una nueva terminal.",
  "error.provider.grokMissing": "Grok no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.opencodeNotStarted": "OpenCode no pudo iniciarse. Ejecuta `opencode --version` en una terminal.",
  "error.provider.opencodeMissing": "OpenCode no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.codexVersionUnreadable": "No se pudo leer la versión de Codex CLI.",
  "error.provider.claudeVersionUnreadable": "No se pudo leer la versión de Claude CLI.",
  "error.provider.grokVersionUnreadable": "No se pudo leer la versión de Grok CLI.",
  "error.provider.opencodeVersionUnreadable": "No se pudo leer la versión de OpenCode CLI.",
  "error.provider.bunVersionUnreadable": "No se pudo leer la versión del entorno de ejecución de Bun.",
  "error.provider.connectBeforeProfile": "Conecta el proveedor seleccionado antes de generar un perfil.",
  "error.provider.cliNotReady": "La CLI de {provider} no está lista o no tiene una sesión iniciada.",
  "error.provider.cliTimedOut":
    "{provider} no respondió a tiempo. El equipo puede estar ocupado. OpenBot lo intentará de nuevo.",
  "error.provider.cliTimedOutRefresh":
    "{provider} no respondió a tiempo. El equipo puede estar ocupado. Actualiza los proveedores para intentarlo de nuevo.",
  "error.provider.noCodeSignIn": "No se puede iniciar sesión en {provider} con un código.",
  "error.provider.codeLoginNoLink": "El proveedor no mostró un enlace de inicio de sesión. Inténtalo de nuevo.",
  "error.provider.codeLoginNotWaiting": "Ningún inicio de sesión está esperando un código. Inicia sesión de nuevo.",
  "error.provider.codeLoginBadCode": "Pega el código que muestra la página de inicio de sesión.",
  "error.provider.codeLoginRefused": "El proveedor no aceptó el código. Inicia sesión de nuevo.",
  "error.provider.codeLoginUnsupported":
    "Este servidor no permite iniciar sesión con un código pegado. Inicia sesión en el navegador del equipo del servidor.",
  "error.provider.cliBusyRetry":
    "La CLI de {provider} está procesando un turno. Espera a que termine e inténtalo de nuevo.",
  "error.provider.cliSigningIn":
    "La CLI de {provider} está iniciando sesión. Termina o cancela el inicio de sesión y luego actualiza.",
  "error.provider.cliBusyUpdate":
    "La CLI de {provider} está procesando un turno. Espera a que termine y luego actualiza.",
  "error.provider.cliSelectFailed": "OpenBot no pudo seleccionar la CLI gestionada instalada.",
  "error.provider.noAuthenticatedAccount": "{provider} no devolvió una cuenta autenticada.",
  "error.provider.cliActivateFailed": "OpenBot no pudo activar la CLI gestionada.",
  "error.provider.cliBusyReconnect":
    "La CLI de {provider} está procesando un turno. Espera a que termine y vuelve a conectar.",
  "error.provider.opencodeCredentialsRejected":
    "El proveedor del modelo rechazó la clave API. Corrige la clave de OpenCode en Ajustes o la clave del proveedor con `opencode auth login`. Luego inténtalo de nuevo o elige otro modelo.\n{detail}",
  "error.provider.opencodeServiceFailure":
    "OpenCode no pudo completar este turno porque falló su servicio local. Inténtalo de nuevo. Si el error continúa, vuelve a conectar OpenCode en Ajustes.",
  "error.provider.opencodeRateLimited":
    "El proveedor del modelo rechazó la solicitud por su límite de frecuencia. Espera unos minutos o elige otro modelo e inténtalo de nuevo.\n{detail}",
  "error.provider.opencodeBilling":
    "El proveedor del modelo rechazó la solicitud por la facturación de la cuenta. Esperar no lo resuelve. Añade un método de pago o saldo en la cuenta del proveedor, o elige otro modelo.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "El proveedor del modelo de OpenCode informó de una solicitud de carga no válida. Elige otro modelo y continúa. Comprueba las rutinas guardadas antes de crearlas de nuevo.\n{detail}",
  "error.provider.opencodeProviderFailed":
    "El proveedor del modelo tuvo un fallo interno. Tu conexión no es la causa. Inténtalo más tarde o elige otro modelo.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode no pudo conectarse al proveedor del modelo. Comprueba la conexión de red del equipo que ejecuta OpenBot e inténtalo de nuevo.\n{detail}",
  "error.provider.chatgptPageFailed": "OpenBot no pudo abrir la página de conexión de ChatGPT.",
  "error.provider.noneReady": "Ningún proveedor de agentes está listo.",
  "error.provider.claudeTurnActive": "Espera a que termine el turno activo de Claude antes de actualizar su contexto.",
  "error.provider.codexLoginRequired":
    "Codex requiere iniciar sesión con una suscripción de ChatGPT. Ejecuta `codex login`.",
  "error.provider.cliUpdateFailed": "OpenBot no pudo actualizar la CLI de {provider}. {reason}",
  "error.provider.tryAgain": "Inténtalo de nuevo.",
  "error.provider.noAgentProcess": "{provider} no tiene ningún proceso en ejecución para este agente.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} se detuvo antes de que se iniciara el proceso del agente.",
  "error.provider.archiveUnreadable":
    "El archivo del entorno de ejecución no se puede leer o usa un formato no admitido.",
  "error.provider.antigravityArchivePath": "El archivo de Gemini contiene un archivo inesperado.",
  "error.provider.antigravityChecksum": "La suma de comprobación del entorno de ejecución de Gemini no coincide.",
  "error.provider.antigravityReleaseShape": "La versión de Gemini tiene una estructura inesperada.",
  "error.provider.antigravityMissing": "Gemini no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.antigravityNotStarted": "Se encontró el servidor de Gemini, pero no se puede leer su versión.",
  "error.provider.antigravityVersionUnreadable": "No se pudo leer la versión del servidor de Gemini.",
  "error.provider.antigravitySignIn": "Inicia sesión con Google para usar Gemini.",
  "error.provider.antigravityRateLimited":
    "Gemini rechazó la solicitud porque se alcanzó un límite de frecuencia o la cuota del plan. Espera unos minutos o elige otro modelo y vuelve a intentarlo.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini no puede usar este modelo ahora. Elige otro modelo y vuelve a intentarlo.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "El servicio Gemini de Google no completó la solicitud. Vuelve a intentarlo en unos minutos.\n{detail}",
  "error.provider.cursorArchivePath": "El archivo de Cursor contiene un archivo inesperado.",
  "error.provider.cursorChecksum": "La suma de comprobación del entorno de ejecución de Cursor no coincide.",
  "error.provider.cursorReleaseShape": "La versión de Cursor tiene una estructura inesperada.",
  "error.provider.cursorMissing": "Cursor no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.cursorNotStarted": "Se encontró el agente de Cursor, pero no se puede leer su versión.",
  "error.provider.cursorVersionUnreadable": "No se pudo leer la versión del agente de Cursor.",
  "error.provider.cursorSignIn": "Inicia sesión con Cursor o define CURSOR_API_KEY para usar Cursor.",
  "error.provider.clineArchivePath": "El archivo de Cline tiene una ruta inesperada.",
  "error.provider.clinePackageMismatch": "El paquete de Cline no coincide con el catálogo de entornos de ejecución.",
  "error.provider.clineChecksum": "La suma de comprobación del entorno de ejecución de Cline no coincide.",
  "error.provider.clineLicenseChecksum": "La suma de comprobación de la licencia de Cline no coincide.",
  "error.provider.clineMissing": "Cline no está descargado. Descárgalo en OpenBot para continuar.",
  "error.provider.clineOutdated": "Cline CLI {version} es demasiado antiguo. OpenBot requiere 3.0.68 o posterior.",
  "error.provider.clineNotStarted": "Cline no pudo iniciarse. Ejecuta `cline --version` en una terminal.",
  "error.provider.clineVersionUnreadable": "No se pudo leer la versión de Cline CLI.",
  "error.provider.clineSignIn": "Inicia sesión con Cline o define CLINE_API_KEY para usar Cline.",
  "error.provider.usageLimitReached": "La cuenta alcanzó su límite de uso.",
  "error.provider.foreignReasoning":
    "{provider} no aceptó el razonamiento anterior de este chat porque lo recibió otra cuenta o clave API. OpenBot inició una nueva sesión de {provider} con el historial del chat. Inténtalo de nuevo.",
  "error.provider.grokSignIn": "Ejecuta `grok login` o define XAI_API_KEY para usar Grok.",
  "error.provider.acpSignInTimedOut": "Se agotó el tiempo del inicio de sesión.",
  "error.provider.acpSignInStopped": "El inicio de sesión se detuvo antes de completarse.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini no pudo abrir la página de inicio de sesión. Instala un navegador y xdg-utils, y conéctate desde una sesión de escritorio en este host. Un servidor sin escritorio no puede completar este inicio de sesión.",
  "error.provider.acpSignInFailed": "El inicio de sesión no se completó.",
  "error.provider.messageTooLarge": "OpenBot detuvo {provider} porque envió un mensaje de más de {limit} MB.",
  "error.provider.customAgentIdInvalid":
    "Un ID de agente debe contener letras minúsculas, dígitos o `-`, y no puede ser el ID de un proveedor integrado.",
  "error.provider.customAgentEnvInvalid":
    "Un nombre de variable debe contener letras, dígitos o `_`, y no empezar por un dígito. Usa cada nombre una vez, con un máximo de 16 nombres.",
  "error.provider.customAgentCommandInvalid":
    "El comando debe ser una ruta completa, una ruta que empiece por ~/ o un nombre de comando sin espacios.",
  "error.provider.customAgentArgsInvalid":
    "Un argumento no puede contener saltos de línea. Usa un máximo de 32 argumentos.",
  "error.provider.customAgentWindowsScript":
    "Un comando .cmd o .bat solo puede aceptar letras, números y - _ . , : = @ + / \\ en sus argumentos.",
  "error.provider.customAgentNotFound": "OpenBot no encuentra {command}. Introduce la ruta completa del comando.",
  "error.provider.customAgentCheckTimedOut": "El agente no respondió en 20 segundos.",
  "error.provider.customAgentCheckStopped": "El agente se detuvo antes de responder.",
  "error.provider.customAgentProtocolVersion": "El agente usa la versión {version} de ACP. OpenBot usa la versión 1.",
  "error.provider.customAgentCheckFailed": "El agente no respondió como un agente ACP.",
  "error.provider.customAgentRemoveBusy":
    "Espera a que terminen el turno activo y la cola antes de eliminar este agente personalizado.",
  "error.provider.customAgentNone": "No hay ningún agente personalizado guardado.",
  "error.provider.customAgentMissing": "Este agente personalizado no está guardado ahora. Elige otro modelo.",
  "error.provider.customAgentSignIn": "Inicia sesión con el comando propio del agente e inténtalo de nuevo.",
  "error.provider.customAgentsReadOnly":
    "Los agentes personalizados guardados se escribieron con una versión más reciente de OpenBot o el archivo no se puede leer. Actualiza OpenBot para cambiarlos.",
  "error.provider.customAgentNoSecureStorage":
    "Este equipo no tiene almacenamiento seguro, por lo que no se pueden guardar los valores del entorno. Elimínalos e inténtalo de nuevo.",
  "error.provider.customAgentNotSaved":
    "Este agente personalizado no está guardado. Actualiza la lista e inténtalo de nuevo.",
  "error.provider.customAgentTooMany": "Puedes guardar un máximo de {count} agentes personalizados.",
  "error.provider.customAgentEnvValueMissing": "Introduce un valor para {name}.",
  "error.provider.off": "{provider} está desactivado en OpenBot. Actívalo primero en los ajustes de proveedores.",
  "error.provider.inUse": "Un agente usa {provider}. Cambia su modelo antes de desactivar este proveedor.",
  "error.provider.useBusy":
    "Espera a que termine la comprobación del proveedor o el inicio de sesión e inténtalo de nuevo.",
  "error.provider.useSettingsReadOnly":
    "No se pueden leer los ajustes guardados del proveedor. Actualiza OpenBot antes de cambiarlos.",
  "error.provider.useChangeFailed": "OpenBot no pudo cambiar el ajuste del proveedor.",
  "error.provider.sessionSettingUnavailable": "Este ajuste no está disponible en la sesión actual del proveedor.",
  "error.provider.sessionSettingInvalid": "Este valor no está disponible para el ajuste.",
  "error.provider.sessionSettingsBusy": "Espera a que termine el turno actual antes de cambiar un ajuste de la sesión.",
  "error.provider.piOutdated":
    "Pi {version} es demasiado antiguo. Instala Pi 1.1.0 o posterior para la compatibilidad nativa con RPC y MCP.",
  "error.provider.nativeMissing": "La CLI de {provider} no está instalada. Descárgala en Ajustes.",
  "error.provider.nativeNotStarted": "La CLI de {provider} no pudo iniciarse.",
  "error.provider.nativeVersionUnreadable": "No se pudo leer la versión de la CLI de {provider}.",
  "error.provider.piSessionBusy": "Espera a que termine el turno actual de Pi.",
  "error.provider.piStopped": "Pi no se está ejecutando. Conecta Pi e inténtalo de nuevo.",
  "error.provider.piSessionMissing": "El archivo de sesión de Pi no está disponible en este equipo.",
  "error.provider.piResumeCancelled": "Pi canceló la reanudación de la sesión. Inténtalo de nuevo.",
  "error.provider.piSessionIdentity": "Pi devolvió una sesión diferente. La sesión guardada no se reemplazó.",
  "error.provider.piModelInvalid": "Selecciona un modelo de Pi que incluya su proveedor.",
  "error.provider.piToolInvalid": "La herramienta devolvió un resultado no válido.",
  "error.provider.piSignIn": "Usa /login en Pi en el equipo anfitrión. Cierra Pi cuando termines de iniciar sesión.",
  "error.provider.museBusy": "La sesión de Muse está ocupada.",
  "error.provider.museStopped": "El cliente de Muse no se está ejecutando.",
  "error.provider.museUnexpectedProvider": "Muse devolvió un proveedor de modelo inesperado.",
  "error.provider.museNoActiveTurn": "Muse no tiene ningún turno activo que orientar.",
  "error.provider.museInvalidProtocol": "Muse devolvió una respuesta de protocolo no válida.",
  "error.provider.museNotStarted": "Muse no se inició.",
  "error.provider.museNativeWindows": "Muse necesita un ejecutable nativo en Windows.",
  "error.provider.museStartTimeout": "Se agotó el tiempo de inicialización de Muse.",
  "error.provider.museStartStopped": "Muse se detuvo durante la inicialización.",
  "error.provider.museProtocolVersion": "Versión del protocolo de Muse no admitida.",
  "error.provider.museHistoryRequired": "Muse debe conservar el historial de la sesión.",
  "error.provider.museRequestUnsupported": "Solicitud del servidor de Muse no admitida.",
  "error.provider.museConnectionFailed":
    "Falló la conexión con Muse. Reanuda la conversación para recuperar su historial guardado.",
  "error.provider.museUnknownSession": "Sesión de Muse desconocida.",
  "error.provider.museInvalidToolResult": "Resultado de herramienta de OpenBot no válido.",
  "error.provider.museMcpRequired": "Muse debe admitir servidores MCP de sesión.",
  "error.provider.museSessionMismatch": "Muse devolvió una sesión diferente.",
  "error.provider.museCompactRejected": "Muse no aceptó la compactación.",
  "error.provider.museTurnMismatch": "Muse devolvió un turno diferente.",
  "error.provider.museHistoryMismatch": "El historial de Muse mezcló sesiones.",
  "error.provider.museRecoveryFailed": "Muse no pudo recuperar los eventos que faltan.",
  "error.provider.museHistoryStalled": "El cursor del historial de Muse no avanzó.",
  "error.provider.museApprovalUnavailable": "Muse no ofreció esta respuesta de aprobación.",
  "error.provider.museHistoryOwner": "El historial de Muse pertenece a otra sesión.",
  "error.provider.museHistoryMissing": "Muse no devolvió el historial de la sesión.",
  "error.provider.museEmptyInput": "Muse necesita texto o una imagen.",
  "error.provider.museMethodUnsupported": "Muse no admite {method}.",
  "error.provider.museTurnFailed": "Falló el turno de Muse.",
  "error.provider.museProfileUnsupported":
    "Muse no puede generar un perfil sin acceso a herramientas externas. Usa otro proveedor para generar el perfil y luego selecciona Muse para el agente.",
  "error.provider.museAuthUnverified":
    "La autenticación de Muse no está verificada. Conéctate en el equipo anfitrión o define una clave de API de Meta.",
  "error.provider.museSignIn": "Inicia sesión en Muse en el equipo anfitrión para continuar.",
  "error.provider.terminalLoginFailed":
    "No se pudo abrir la terminal de inicio de sesión. Abre la CLI del proveedor en este host, inicia sesión allí y actualiza los proveedores.",
  "error.provider.nativeArchiveInvalid": "La descarga del proveedor no contiene una instalación válida.",
  "error.provider.nativeChecksum": "La instalación del proveedor no superó su comprobación de integridad.",
  "error.provider.registryUnavailable": "El registro ACP no está disponible. Inténtalo de nuevo.",
  "error.provider.registryInvalid": "El registro ACP devolvió datos no válidos.",
  "error.provider.registryMissing": "Este agente no está en el registro ACP.",
  "error.provider.registryBusy": "Ya hay una instalación en curso para este agente.",
  "error.provider.registryCancelled": "Se canceló la instalación del agente.",
  "error.provider.registryPrerequisite": "Instala {tool} en el host antes de instalar este agente.",
  "error.provider.registryBindingChanged": "El agente personalizado cambió durante la instalación. Inténtalo de nuevo.",
  "error.provider.registryInstallFailed": "Falló la instalación del agente. La instalación anterior no cambió.",
  "error.provider.registryRemoveBusy":
    "Espera a que terminen la instalación del agente y el trabajo ACP activo antes de quitarlo.",
} as const satisfies PartialTranslation<typeof source>;
