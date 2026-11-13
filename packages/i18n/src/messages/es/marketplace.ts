import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Programación",
  "marketplace.category.design": "Diseño",
  "marketplace.category.dataAnalytics": "Datos y análisis",
  "marketplace.category.documents": "Documentos",
  "marketplace.category.productivity": "Productividad",
  "marketplace.category.research": "Investigación",
  "marketplace.category.automation": "Automatización",
  "marketplace.category.other": "Otros",
  "marketplace.loadFailed": "No se pudo cargar el marketplace.",
  "marketplace.loading.skills": "Cargando habilidades",
  "marketplace.loading.agents": "Cargando agentes",
  "marketplace.noMatch.skills": "Ninguna habilidad coincide con esta búsqueda.",
  "marketplace.noMatch.agents": "Ningún agente coincide con esta búsqueda.",
  "marketplace.loadMore": "Cargar más",
  "marketplace.version": "Versión {version}",
  "marketplace.title": "Marketplace",
  "marketplace.kinds": "Tipos de contenido del marketplace",
  "marketplace.tab.agents": "Agentes",
  "marketplace.tab.skills": "Habilidades",
  "marketplace.description.apps": "Conecta las herramientas y los servicios con los que trabajan tus agentes.",
  "marketplace.description.agents": "Agentes listos para usar, con sus propias instrucciones y habilidades.",
  "marketplace.description.skills": "Instrucciones que enseñan a un agente una tarea o una herramienta.",
  "marketplace.plugins.missing": "Este plugin no está en el catálogo de OpenBot.",
  "marketplace.agents.loadingDetail": "Cargando detalles del agente…",
  "marketplace.agents.skills": "Habilidades",
  "marketplace.agents.routines": "Rutinas",
  "marketplace.agents.routineInactive": "Inactiva",
  "marketplace.agents.by": "de {name}",
  "marketplace.agents.routineCount": { one: "{count} rutina", other: "{count} rutinas" },
  "marketplace.agents.yours": "Tus agentes",
  "marketplace.agents.all": "Todos los agentes",
  "marketplace.agents.missing": "Este agente no está en el Marketplace.",
  "marketplace.agents.trust.reviewed":
    "Creado por otra persona usuaria de OpenBot. OpenBot lo revisó antes de publicarlo.",
  "marketplace.agents.trust.reviewedBeforeAdd":
    "Creado por otra persona usuaria de OpenBot. OpenBot lo revisó antes de publicarlo. Una vez añadido, puede actuar en tu nombre.",
  "marketplace.agents.trust.pending": "Compartido por su creador antes de que OpenBot lo revisara.",
  "marketplace.agents.trust.pendingBeforeAdd":
    "Compartido por su creador antes de que OpenBot lo revisara. Una vez añadido, puede actuar en tu nombre.",
  "marketplace.agents.source.pending": "Aún sin revisar",
  "marketplace.skill.loading": "Cargando habilidad",
  "marketplace.try.readFailed": "OpenBot no pudo leer las habilidades de este agente. Inténtalo de nuevo.",
  "marketplace.try.enable": "Activa esta habilidad en los ajustes del agente para probarla.",
  "marketplace.try.repair": "Repara esta habilidad en los ajustes del agente para probarla.",
  "marketplace.try.update": "Actualiza esta habilidad para probar esta versión.",
  "marketplace.try.composerUnavailable": "El editor de mensajes del agente no está disponible.",
  "marketplace.open": "Abrir {name}",
  "marketplace.tab.apps": "Apps",
  "marketplace.crumbs.label": "Ubicación",
  "marketplace.search.label": "Buscar en el marketplace",
  "marketplace.search.placeholder": "Buscar",
  "marketplace.installs": {
    one: "{installs} instalación",
    other: "{installs} instalaciones",
  },
  "marketplace.filter.clear": "Borrar filtros",
  "marketplace.noMatch.apps": "Ninguna app coincide con esta búsqueda.",
  "marketplace.noMatch.filters": "Ningún resultado coincide con los filtros.",
  "marketplace.noMatch.showAgents": {
    one: "Mostrar {count} agente",
    other: "Mostrar {count} agentes",
  },
  "marketplace.noMatch.showApps": {
    one: "Mostrar {count} app",
    other: "Mostrar {count} apps",
  },
  "marketplace.noMatch.showSkills": {
    one: "Mostrar {count} habilidad",
    other: "Mostrar {count} habilidades",
  },
  "marketplace.empty.agents": "Todavía no hay agentes en el marketplace.",
  "marketplace.empty.apps": "Todavía no hay apps en el marketplace.",
  "marketplace.empty.skills": "Todavía no hay habilidades en el marketplace.",
  "marketplace.properties.creator": "Creador",
  "marketplace.properties.category": "Categoría",
  "marketplace.properties.version": "Versión",
  "marketplace.properties.updated": "Actualización",
  "marketplace.properties.installs": "Instalaciones",
  "marketplace.agent.add": "Añadir",
  "marketplace.agent.addNamed": "Añadir {name}",
  "marketplace.agent.addAgent": "Añadir agente",
  "marketplace.agent.added": "Añadido",
  "marketplace.agent.updateAvailable": "Actualización disponible",
  "marketplace.agent.update": "Actualizar",
  "marketplace.agent.openChat": "Abrir chat",
  "marketplace.app.connect": "Conectar",
  "marketplace.app.reconnect": "Reconectar",
  "marketplace.app.connectNamed": "Conectar {name}",
  "marketplace.app.reconnectNamed": "Reconectar {name}",
  "marketplace.app.connected": "Conectada",
  "marketplace.app.attention": "Requiere atención",
  "marketplace.app.partialTitle": "{name} no está completo",
  "marketplace.app.partialDescription":
    "Algunas de sus apps o habilidades no están instaladas. Reconectar las instala.",
  "marketplace.app.notConnected": "Sin conectar",
  "marketplace.app.custom": "Servidor MCP",
  "marketplace.app.githubTagline": "Repositorios, incidencias y pull requests",
  "marketplace.app.onePasswordTagline": "Inicia sesión en sitios con las credenciales que compartes",
  "marketplace.app.slackTagline": "Menciones y mensajes directos en Slack",
  "marketplace.app.discordTagline": "Menciones y mensajes directos en Discord",
  "marketplace.app.telegramTagline": "Grupos y chats directos en Telegram",
  "marketplace.app.whatsappTagline": "Tu propio chat y las personas que permitas en WhatsApp",
  "marketplace.app.bitwardenTagline": "Inicia sesión en sitios con credenciales de una carpeta compartida",
  "marketplace.app.protonPassTagline": "Inicia sesión en sitios con credenciales de una bóveda compartida",
  "marketplace.app.onePasswordCategory": "Gestión de inicios de sesión y credenciales",
  "marketplace.app.yourApps": "Tus apps",
  "marketplace.app.addCustom": "Añadir personalizada",
  "marketplace.app.server": "Servidor",
  "marketplace.app.command": "Comando",
  "marketplace.app.address": "Dirección",
  "marketplace.app.disconnect.title": "Desconectar {name}",
  "marketplace.app.disconnect.description":
    "Elimina {name} y sus habilidades de este equipo. Puedes volver a conectarla más adelante.",
  "marketplace.app.disconnect.action": "Desconectar",
  "marketplace.app.remove.title": "Eliminar servidor",
  "marketplace.app.remove.description": "Tus agentes ya no podrán usar este servidor. Se eliminarán sus ajustes.",
  "marketplace.app.remove.action": "Eliminar",
  "marketplace.app.remove.confirmTitle": "¿Eliminar {name}?",
  "marketplace.app.remove.keep": "Conservar",
  "marketplace.app.connection": "Conexión",
  "marketplace.app.access.use": "Puede usar",
  "marketplace.app.access.noAgents": "Ningún agente",
  "marketplace.app.access.agentsOf": "Agentes que pueden usar {name}",
  "marketplace.app.access.chooseAgents": "{name}: {summary}. Elegir agentes",
  "marketplace.app.access.level": "Acceso de {role} a {name}",
  "marketplace.app.setup.account": "Inicia sesión con tu cuenta de {name} en el navegador.",
  "marketplace.app.setup.key": "Necesita una clave de API de tu cuenta de {name}.",
  "marketplace.app.setup.keySaved": "{field} se guarda en {host}.",
  "marketplace.app.account.removeDescription": "OpenBot elimina el inicio de sesión de esta cuenta en {host}.",
  "marketplace.app.setup.desktop": "Se ejecuta en la app de escritorio de {name} en {address}.",
  "marketplace.app.setup.desktopConnected": "Conectada a {address}.",
  "marketplace.app.setup.open": "No necesita inicio de sesión ni clave.",
  "marketplace.app.blocked.update":
    "{host} usa una versión antigua de OpenBot que no puede conectar apps. Actualiza OpenBot en {host} o pide a su propietario que lo actualice.",
  "marketplace.app.blocked.member":
    "Solo un propietario o administrador de {host} puede conectar apps allí. Pide a uno de ellos que conecte {name} o que actualice OpenBot en {host} para que los miembros puedan conectar apps.",
  "marketplace.app.connectAgain": "Volver a conectar",
  "marketplace.app.automation.askOnInstall": "Pedir acceso a macOS al instalar",
  "marketplace.app.automation.title": "Acceso a las apps de Apple",
  "marketplace.app.automation.description":
    "macOS muestra un aviso por cada app. Una app cerrada se abre un momento y luego se cierra.",
  "marketplace.app.automation.request": "Pedir acceso",
  "marketplace.app.automation.allowed": "OpenBot ya puede controlar todas las apps de Apple.",
  "marketplace.app.automation.refused":
    "macOS no dio acceso a {apps}. Permite OpenBot en Ajustes del Sistema › Privacidad y seguridad › Automatización.",
  "marketplace.app.automation.failed": "OpenBot no pudo preguntar a macOS por {apps}. Inténtalo de nuevo.",
  "marketplace.app.automation.app.calendar": "Calendario",
  "marketplace.app.automation.app.contacts": "Contactos",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Notas",
  "marketplace.app.automation.app.reminders": "Recordatorios",
  "marketplace.app.automation.app.messages": "Mensajes",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "Vuelve a iniciar sesión en {name}",
  "marketplace.app.signInDescription":
    "{name} rechazó el inicio de sesión guardado. Tus agentes no pueden usarla hasta que vuelvas a iniciar sesión.",
  "marketplace.plugin.aave.tagline": "Datos y transacciones de Aave",
  "marketplace.plugin.aave.description":
    "Aave ayuda a los usuarios a explorar los mercados en vivo de Aave V3 y V4, revisar posiciones de wallets y la gobernanza de la DAO, simular operaciones de préstamo y preparar transacciones sin custodia. Cada transacción se devuelve sin firmar: el plugin lee los mercados y escribe la llamada, y la wallet sigue en manos del usuario.",
  "marketplace.plugin.aave.app":
    "Mercados en vivo de V3 y V4, posiciones de wallets, gobernanza de la DAO y transacciones preparadas, mediante un único servidor MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield":
    "¿Dónde puedo obtener ahora mismo el mayor rendimiento con stablecoins en Aave?",
  "marketplace.plugin.aave.prompt.usdcRates": "¿Qué paga más por USDC ahora mismo, Aave V3 o V4 en Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "¿Cuál es el factor de salud de 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c y a qué distancia está de la liquidación?",
  "marketplace.plugin.canva.tagline": "Diseños, recursos y exportaciones",
  "marketplace.plugin.canva.description":
    "Canva permite a los usuarios crear y editar diseños con palabras, buscar en su propia biblioteca de diseños, subir y organizar recursos, exportar en el formato que necesita cada canal y dejar comentarios donde está el trabajo. Cada usuario inicia sesión en su propia cuenta de Canva, y el agente puede hacer lo que esa cuenta puede hacer.",
  "marketplace.plugin.canva.app":
    "Creación y edición de diseños, búsqueda en la biblioteca, gestión de recursos y de marca, exportaciones y comentarios, mediante un único servidor MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Muéstrame el diseño de Canva que edité más recientemente.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Cambia el tamaño de mi póster de lanzamiento para Instagram y exporta ambos como PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Convierte estas notas de la versión en una presentación de Canva de seis diapositivas.",
  "marketplace.plugin.linear.tagline": "Incidencias y triaje de proyectos",
  "marketplace.plugin.linear.description":
    "Linear permite a los agentes listar las incidencias asignadas, clasificar el backlog, actualizar estados y redactar nuevas incidencias en el espacio de trabajo al que pertenece la cuenta con sesión iniciada. Cada usuario inicia sesión en su propia cuenta de Linear desde el navegador.",
  "marketplace.plugin.linear.app":
    "Búsqueda, triaje, cambios de estado y creación de incidencias, mediante el servidor MCP de Linear con inicio de sesión en el navegador.",
  "marketplace.plugin.linear.prompt.myWeek": "¿Qué tengo asignado esta semana?",
  "marketplace.plugin.linear.prompt.backlog": "Clasifica el backlog: ¿qué está obsoleto, bloqueado o sin responsable?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Crea una incidencia para el fallo en la cola de sincronización con los pasos para reproducirlo.",
  "marketplace.plugin.notion.tagline": "Documentos y base de conocimiento",
  "marketplace.plugin.notion.description":
    "Notion permite a los agentes leer y escribir páginas, buscar en el espacio de trabajo y guardar notas de reuniones y especificaciones donde el equipo ya trabaja. Cada usuario inicia sesión en su propia cuenta de Notion desde el navegador.",
  "marketplace.plugin.notion.app":
    "Búsqueda, lectura y escritura de páginas, y navegación por el espacio de trabajo, mediante el servidor MCP de Notion con inicio de sesión en el navegador.",
  "marketplace.plugin.notion.prompt.findSpec":
    "Busca la especificación de lanzamiento actual y resume las preguntas abiertas.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Convierte estos puntos en una nota de reunión estructurada en el espacio de mi equipo.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Actualiza el documento de incorporación con la nueva lista de comprobación de versiones.",
  "marketplace.plugin.cobrain.tagline": "Memoria compartida para tus agentes de IA",
  "marketplace.plugin.cobrain.description":
    "Cobrain es una memoria en Markdown que toda IA que conectes puede leer y escribir. Los agentes cargan el contexto de un cliente o proyecto antes de trabajar, buscan notas y decisiones anteriores y guardan lo que aprenden para que la siguiente conversación empiece donde terminó la anterior. Cada usuario inicia sesión en su propia cuenta de Cobrain.",
  "marketplace.plugin.cobrain.app":
    "Lectura, búsqueda y escritura de notas en tu cerebro de Cobrain, mediante un servidor MCP.",
  "marketplace.plugin.cobrain.prompt.startSession": "Carga mi contexto de Cobrain para este proyecto antes de empezar.",
  "marketplace.plugin.cobrain.prompt.searchDecision":
    "Busca en mis notas de Cobrain lo que decidimos sobre los precios.",
  "marketplace.plugin.cobrain.prompt.saveNote": "Guarda una nota en Cobrain con lo que hicimos hoy y lo que falta.",
  "marketplace.plugin.honcho.tagline": "Tu memoria en todas las herramientas de IA",
  "marketplace.plugin.honcho.description":
    "Honcho, de Plastic Labs, da a los agentes una memoria a largo plazo sobre ti que otras herramientas de IA que conectes pueden compartir. Los agentes guardan lo que aprenden, y Honcho razona sobre ello para crear un modelo de tus preferencias, objetivos y formas de trabajar. Los agentes le hacen preguntas antes de empezar. Los agentes de OpenBot también tienen su propia memoria; Honcho es la memoria que te sigue a otras herramientas. Los mensajes que guardan los agentes van a tu cuenta de Honcho.",
  "marketplace.plugin.honcho.app":
    "Guarda y consulta memoria a largo plazo en tus espacios de trabajo de Honcho con un solo servidor MCP.",
  "marketplace.plugin.honcho.prompt.recall":
    "Antes de empezar, pregunta a Honcho qué sabe sobre cómo me gusta trabajar.",
  "marketplace.plugin.honcho.prompt.save": "Guarda en Honcho las decisiones de este hilo.",
  "marketplace.plugin.honcho.prompt.preferences":
    "¿Qué dice Honcho sobre mi estilo de escritura? Úsalo para este borrador.",
  "marketplace.plugin.honcho.hint.apiKey": "Crea una clave en app.honcho.dev.",
  "marketplace.plugin.hindsight.tagline": "Memoria que aprende con el tiempo",
  "marketplace.plugin.hindsight.description":
    "Hindsight, de Vectorize, da a los agentes una memoria a largo plazo en Hindsight Cloud. Los agentes retienen hechos y eventos, los recuerdan por significado, tiempo y entidad, y reflexionan sobre ellos para formar modelos mentales. Los recuerdos se guardan en bancos, y los agentes pueden crear un banco para cada proyecto o persona. Los agentes de OpenBot también tienen su propia memoria; Hindsight es la memoria que otras herramientas de IA que conectes pueden compartir. Lo que retienen los agentes va a tu cuenta de Hindsight Cloud.",
  "marketplace.plugin.hindsight.app":
    "Retén, recuerda y reflexiona sobre recuerdos en tus bancos de Hindsight Cloud con un solo servidor MCP.",
  "marketplace.plugin.hindsight.prompt.recall":
    "Antes de empezar, recupera de Hindsight lo que sabemos sobre este proyecto.",
  "marketplace.plugin.hindsight.prompt.retain": "Retén en Hindsight las decisiones y preguntas abiertas de este hilo.",
  "marketplace.plugin.hindsight.prompt.reflect":
    "Reflexiona sobre mis recuerdos de Hindsight: ¿qué patrones ves en mi trabajo del último mes?",
  "marketplace.plugin.hindsight.hint.apiKey": "Crea una clave en la página Connect de Hindsight Cloud.",
  "marketplace.plugin.figma.tagline": "Diseños y prototipos",
  "marketplace.plugin.figma.description":
    "Figma permite a los agentes leer archivos de diseño, inspeccionar componentes, estilos y variables, y entregar especificaciones de producción a los ingenieros. Se conecta al servidor MCP de la aplicación de escritorio de Figma, en este equipo. El servidor solo puede leer diseños; la escritura está en desarrollo.",
  "marketplace.plugin.figma.app":
    "Contexto de diseño, metadatos, variables y capturas de pantalla, mediante el servidor MCP de la aplicación de escritorio de Figma. Por ahora, solo lectura.",
  "marketplace.plugin.figma.prompt.handoff":
    "Prepara la entrega del archivo de pago: lista las pantallas, los componentes y los estilos.",
  "marketplace.plugin.figma.prompt.audit": "Revisa este archivo en busca de espaciados y usos de color incoherentes.",
  "marketplace.plugin.figma.prompt.assets": "Extrae los iconos de marketing a 2x para el paquete de la aplicación.",
  "marketplace.plugin.paper.tagline": "Lienzo de diseño basado en HTML y CSS",
  "marketplace.plugin.paper.description":
    "Paper permite a los agentes leer y escribir el archivo de diseño abierto en Paper Desktop: inspeccionar mesas de trabajo, selecciones, estilos calculados, JSX y tokens, y crear o cambiar marcos, texto y estilos. Instala Paper Desktop, ábrelo una vez y abre un archivo antes de empezar. OpenBot inicia la CLI de Paper que instala Paper Desktop. Paper no necesita clave. Las herramientas de escritura cambian el archivo abierto, así que revisa cada escritura antes de aprobarla.",
  "marketplace.plugin.paper.app":
    "Lee y escribe el archivo abierto de Paper Desktop, mediante el servidor MCP local que retransmite la CLI de Paper. Necesita Paper Desktop con un archivo abierto.",
  "marketplace.plugin.paper.prompt.implement":
    "Implementa el marco seleccionado de Paper en este código, con nuestras convenciones de código.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Usa los estilos de este repositorio y diseña una página de ajustes en Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Lista los tokens de diseño del archivo abierto de Paper y compáralos con nuestro tema.",
  "marketplace.plugin.higgsfield.tagline": "Imágenes, vídeos y audio con IA",
  "marketplace.plugin.higgsfield.description":
    "Higgsfield permite a los agentes generar imágenes, vídeos, personajes y audio con modelos de Higgsfield como Seedance, Kling, Veo y MiniMax Hailuo, consultar el saldo de créditos y explorar la Asset Library. Los resultados se guardan en los Assets de Higgsfield del usuario. Cada usuario inicia sesión en su propia cuenta de Higgsfield en el navegador. Cada generación usa créditos de esa cuenta a la tarifa estándar, también con un plan ilimitado.",
  "marketplace.plugin.higgsfield.app":
    "Generación de imágenes, vídeos y audio, personajes, créditos y assets, mediante el servidor MCP de Higgsfield con inicio de sesión en el navegador.",
  "marketplace.plugin.higgsfield.prompt.credits": "¿Cuántos créditos de Higgsfield tengo?",
  "marketplace.plugin.higgsfield.prompt.productShot":
    "Haz con Higgsfield una foto de producto de una taza de cerámica sobre una mesa de madera.",
  "marketplace.plugin.higgsfield.prompt.clip": "Haz con Higgsfield un vídeo de 5 segundos de olas al atardecer.",
  "marketplace.plugin.sunra.tagline": "Imágenes, vídeos, audio y 3D con IA",
  "marketplace.plugin.sunra.description":
    "Sunra permite a los agentes crear imágenes, vídeos, audio y modelos 3D con modelos como GPT Image, Nano Banana, Seedream, FLUX, Seedance, Kling y Veo, consultar el saldo de créditos y leer los resultados. Los resultados se guardan en un proyecto de la cuenta de Sunra del usuario. Cada usuario inicia sesión en su propia cuenta de Sunra en el navegador. Sunra indica primero el coste de cada generación y solo gasta créditos de esa cuenta después de confirmarla.",
  "marketplace.plugin.sunra.app":
    "Generación de imágenes, vídeos, audio y 3D, créditos y resultados, mediante el servidor MCP de Sunra con inicio de sesión en el navegador.",
  "marketplace.plugin.sunra.prompt.balance": "¿Cuántos créditos de Sunra tengo?",
  "marketplace.plugin.sunra.prompt.poster":
    "Haz con Sunra un póster de un mercado nocturno bajo la lluvia, en formato vertical.",
  "marketplace.plugin.sunra.prompt.clip":
    "Haz con Sunra un vídeo de 5 segundos de un barco de papel en un río. Dime primero cuánto cuesta.",
  "marketplace.plugin.elevenlabs.tagline": "Voz, voces y agentes de voz",
  "marketplace.plugin.elevenlabs.description":
    "ElevenLabs permite a los agentes convertir texto en voz, trabajar con voces y crear, probar y revisar agentes de voz de ElevenLabs y sus conversaciones. El audio generado vuelve como un enlace de descarga de corta duración. Cada usuario inicia sesión en su propia cuenta de ElevenLabs en el navegador, y cada generación usa créditos de esa cuenta.",
  "marketplace.plugin.elevenlabs.app":
    "Texto a voz, voces y gestión de agentes de voz, mediante el servidor MCP de ElevenLabs con inicio de sesión en el navegador.",
  "marketplace.plugin.elevenlabs.prompt.speech":
    "Lee este párrafo en voz alta con una voz tranquila de ElevenLabs y dame el audio.",
  "marketplace.plugin.elevenlabs.prompt.agents": "Muestra mis agentes de voz de ElevenLabs y la voz que usa cada uno.",
  "marketplace.plugin.elevenlabs.prompt.conversations":
    "Resume las últimas diez conversaciones de mi agente de voz de soporte.",
  "marketplace.plugin.appleApps.tagline": "Mail, Calendario y más en tu Mac",
  "marketplace.plugin.appleApps.description":
    "Apple apps permite a los agentes usar Mail, Calendario, Contactos, Recordatorios, Notas, Mensajes y Safari en este Mac. Solo funciona en macOS. OpenBot inicia mcp-icloud, un servidor de la comunidad que no es de Apple ni de OpenBot. El servidor controla las apps con AppleScript, en este equipo, y no necesita cuenta ni clave. Al instalarla, OpenBot puede pedir a macOS acceso a todas estas apps a la vez, con un aviso por app. Si no lo haces, macOS pregunta la primera vez que un agente usa una app. Para cambiarlo después, abre Ajustes del Sistema › Privacidad y seguridad › Automatización. Los agentes pueden enviar correos e iMessages, y cambiar o eliminar eventos, contactos y recordatorios, así que revisa cada escritura antes de aprobarla. Lo que leen las herramientas, como el texto de los correos, va al proveedor del modelo del agente.",
  "marketplace.plugin.appleApps.app":
    "Mail, Calendario, Contactos, Recordatorios, Notas, Mensajes y Safari, mediante el servidor local mcp-icloud. Necesita macOS y acceso de Automatización.",
  "marketplace.plugin.appleApps.prompt.unread": "Resume mis correos no leídos de hoy en Apple Mail.",
  "marketplace.plugin.appleApps.prompt.today": "¿Qué hay en mi Calendario de Apple hoy y mañana?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Busca el correo más reciente sobre la reunión del proyecto y añade la reunión a mi calendario.",
  "marketplace.plugin.sentry.tagline": "Triaje de errores y fallos",
  "marketplace.plugin.sentry.description":
    "Sentry permite a los agentes buscar errores recientes, inspeccionar trazas de pila y versiones afectadas, y resumir qué se rompió tras un despliegue. Cada usuario inicia sesión en su propia cuenta de Sentry desde el navegador.",
  "marketplace.plugin.sentry.app":
    "Búsqueda de errores, inspección de incidencias y estado de las versiones, mediante el servidor MCP de Sentry con inicio de sesión en el navegador.",
  "marketplace.plugin.sentry.prompt.newErrors": "¿Qué errores nuevos aparecieron desde el despliegue de ayer?",
  "marketplace.plugin.sentry.prompt.topCrash": "Explica el fallo más frecuente del proyecto móvil y su causa probable.",
  "marketplace.plugin.sentry.prompt.releaseHealth":
    "¿Cómo es la estabilidad de la versión actual en comparación con la anterior?",
  "marketplace.plugin.gitlab.tagline": "Incidencias, merge requests y pipelines",
  "marketplace.plugin.gitlab.description":
    "GitLab permite a los agentes buscar proyectos, leer y crear incidencias, revisar y actualizar merge requests, leer archivos y commits del repositorio, y comprobar pipelines y jobs de CI en GitLab.com. Cada usuario inicia sesión en su propia cuenta de GitLab desde el navegador. Los agentes tienen los mismos permisos que el usuario: pueden subir commits, cambiar incidencias y merge requests, y fusionarlas. Para un GitLab autoalojado, añade un servidor MCP con tu dirección de GitLab seguida de /api/v4/mcp en los ajustes de servidores MCP e inicia sesión allí.",
  "marketplace.plugin.gitlab.app":
    "Proyectos, incidencias, merge requests, repositorios y pipelines de CI, mediante el servidor MCP de GitLab con inicio de sesión en el navegador.",
  "marketplace.plugin.gitlab.prompt.reviewQueue": "¿Qué merge requests esperan mi revisión?",
  "marketplace.plugin.gitlab.prompt.failedPipeline": "¿Por qué falló el último pipeline en la rama predeterminada?",
  "marketplace.plugin.gitlab.prompt.newIssue":
    "Crea una incidencia para el fallo en la cola de sincronización con los pasos para reproducirlo.",
  "marketplace.plugin.vercel.tagline": "Despliegues, registros de compilación y proyectos",
  "marketplace.plugin.vercel.description":
    "Vercel permite a los agentes listar proyectos y despliegues recientes, leer registros de compilación y de ejecución, y averiguar por qué falló una compilación. Cada usuario inicia sesión en su propia cuenta de Vercel desde el navegador y elige los equipos que pueden usar los agentes. En esos equipos, los agentes tienen los mismos permisos que la cuenta del usuario. También pueden cambiar variables de entorno, dominios, registros DNS y despliegues, y comprar dominios.",
  "marketplace.plugin.vercel.app":
    "Proyectos, despliegues, registros de compilación y de ejecución, mediante el servidor MCP de Vercel con inicio de sesión en el navegador.",
  "marketplace.plugin.vercel.prompt.failedBuild": "¿Por qué falló el último despliegue de producción?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Lista los despliegues de hoy y su estado.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "¿Qué rutas tuvieron errores de ejecución en la última hora?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, almacenamiento y registros",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare permite a los agentes listar y gestionar Workers, registros DNS, R2, D1 y KV mediante la API de Cloudflare, consultar los registros de Workers y buscar en la documentación de Cloudflare. Cada usuario inicia sesión en su propia cuenta de Cloudflare desde el navegador. En la página de consentimiento de Cloudflare, elige Read only: con la opción predeterminada, Minimal, los agentes no ven los Workers, los registros ni los registros DNS. Con permisos de escritura, los agentes pueden desplegar y eliminar Workers, cambiar registros DNS y modificar otros ajustes de la cuenta.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, almacenamiento y registros, mediante el servidor MCP de la API de Cloudflare con inicio de sesión en el navegador.",
  "marketplace.plugin.cloudflare.prompt.workers": "¿Qué Workers están desplegados en mi cuenta de Cloudflare?",
  "marketplace.plugin.cloudflare.prompt.errors": "¿Qué Workers de Cloudflare registraron errores en la última hora?",
  "marketplace.plugin.cloudflare.prompt.dns": "Lista los registros DNS de cada zona de mi cuenta de Cloudflare.",
  "marketplace.plugin.supabase.tagline": "Bases de datos, registros y edge functions",
  "marketplace.plugin.supabase.description":
    "Supabase permite a los agentes listar proyectos, ejecutar SQL, leer esquemas de tablas y registros, revisar las recomendaciones de seguridad y rendimiento de los advisors, gestionar edge functions y ramas, y buscar en la documentación de Supabase. Cada usuario inicia sesión en su propia cuenta de Supabase desde el navegador y elige una organización. Los agentes tienen acceso completo: pueden ejecutar SQL que cambia o elimina datos, aplicar migraciones, desplegar edge functions y crear o pausar proyectos.",
  "marketplace.plugin.supabase.app":
    "Bases de datos, registros y edge functions, mediante el servidor MCP de Supabase con inicio de sesión en el navegador.",
  "marketplace.plugin.supabase.prompt.projects": "¿Qué proyectos hay en mi organización de Supabase?",
  "marketplace.plugin.supabase.prompt.tables": "Lista las tablas y columnas de mi base de datos de Supabase.",
  "marketplace.plugin.supabase.prompt.errors": "¿Qué errores registró mi proyecto de Supabase en la última hora?",
  "marketplace.plugin.context7.tagline": "Documentación actual de bibliotecas",
  "marketplace.plugin.context7.description":
    "Context7 obtiene la documentación y las referencias de API actuales de bibliotecas y frameworks, para que las respuestas usen la versión que el proyecto realmente ejecuta. No necesita cuenta ni clave.",
  "marketplace.plugin.context7.app":
    "Consulta de documentación actual de bibliotecas, mediante el servidor MCP de Context7 sin inicio de sesión.",
  "marketplace.plugin.context7.prompt.apiCheck": "¿Cuál es la API actual para listas virtualizadas en este framework?",
  "marketplace.plugin.context7.prompt.migrate": "¿Qué cambió entre la v2 y la v3 de este router?",
  "marketplace.plugin.context7.prompt.example": "Muestra un ejemplo actual de subida de archivos con autenticación.",
  "marketplace.plugin.stripe.tagline": "Revisión de pagos y facturación",
  "marketplace.plugin.stripe.description":
    "Stripe permite a los agentes consultar pagos, clientes y facturas, y redactar enlaces de pago, en la cuenta a la que puede acceder el usuario con sesión iniciada. Cada usuario inicia sesión en su propia cuenta de Stripe desde el navegador.",
  "marketplace.plugin.stripe.app":
    "Consulta de pagos, clientes y facturas, mediante el servidor MCP de Stripe con inicio de sesión en el navegador.",
  "marketplace.plugin.stripe.prompt.payment": "Busca este pago y explica por qué falló.",
  "marketplace.plugin.stripe.prompt.customer": "Resume las facturas de este cliente y su saldo pendiente.",
  "marketplace.plugin.stripe.prompt.link": "Redacta un enlace de pago para el plan Pro a 49 al mes.",
  "marketplace.plugin.revenuecat.tagline": "Suscripciones, productos y paywalls",
  "marketplace.plugin.revenuecat.description":
    "RevenueCat permite a los agentes leer y cambiar la configuración de tus suscripciones dentro de la app: apps, productos, entitlements, offerings, paquetes, paywalls y experimentos. Los agentes también pueden consultar clientes y sus compras, y leer gráficos y métricas. Una clave de API secreta de RevenueCat va en una cabecera Authorization. La clave da acceso a un proyecto. Con una clave de solo lectura, los agentes solo pueden leer. Con una clave de escritura, los agentes pueden enviar productos a revisión en la App Store, conceder entitlements a clientes y eliminar paquetes, reglas de segmentación y webhooks.",
  "marketplace.plugin.revenuecat.app":
    "Productos, entitlements, offerings, paywalls y métricas, a través del servidor MCP de RevenueCat con una clave de API secreta.",
  "marketplace.plugin.revenuecat.prompt.offerings": "¿Qué offerings y paquetes tiene mi proyecto de RevenueCat?",
  "marketplace.plugin.revenuecat.prompt.revenue":
    "¿Cómo cambiaron este mes mis ingresos y mis suscripciones activas en RevenueCat?",
  "marketplace.plugin.revenuecat.prompt.customer":
    "¿Qué entitlements tiene este cliente de RevenueCat y cuándo caducan?",
  "marketplace.plugin.revenuecat.hint.apiKey":
    "En el panel de RevenueCat, abre API keys en tu proyecto y crea una clave de API secreta. Una clave de solo lectura basta para ver datos.",
  "marketplace.plugin.posthog.tagline": "Analítica de producto y flags",
  "marketplace.plugin.posthog.description":
    "PostHog permite a los agentes consultar eventos y embudos, inspeccionar feature flags y resumir qué cambió tras una versión. Una clave de API personal de los ajustes del proyecto va en un único encabezado Authorization.",
  "marketplace.plugin.posthog.app":
    "Acceso a eventos, embudos y feature flags, mediante el servidor MCP de PostHog con una clave de API personal.",
  "marketplace.plugin.posthog.prompt.funnel": "¿Cómo se ve el embudo de registro de los últimos 14 días?",
  "marketplace.plugin.posthog.prompt.flag": "¿Qué feature flags están activados para este usuario?",
  "marketplace.plugin.posthog.prompt.release": "¿Cambió la activación después de la versión de la semana pasada?",
  "marketplace.plugin.airtable.tagline": "Bases y registros",
  "marketplace.plugin.airtable.description":
    "Airtable permite a los agentes listar bases, leer y actualizar registros y resumir el contenido de las tablas. Una clave de API de la página de la cuenta se pasa al servidor local como una variable de entorno.",
  "marketplace.plugin.airtable.app":
    "Listado de bases y acceso a registros, mediante un servidor MCP local con una clave de API de Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "¿A qué bases tengo acceso?",
  "marketplace.plugin.airtable.prompt.records": "Resume la tabla de seguimiento del lanzamiento.",
  "marketplace.plugin.airtable.prompt.update":
    "Marca como terminadas las funciones publicadas en la base de la hoja de ruta.",
  "marketplace.plugin.firecrawl.tagline": "Extracción y búsqueda web",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl permite a los agentes extraer el contenido de páginas, obtener datos estructurados y buscar en la web con una única API. Una clave de API del panel de Firecrawl se pasa al servidor local como una variable de entorno.",
  "marketplace.plugin.firecrawl.app":
    "Extracción de páginas y datos, y búsqueda web, mediante un servidor MCP local con una clave de API de Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Extrae la tabla de precios de esta página como datos estructurados.",
  "marketplace.plugin.firecrawl.prompt.research":
    "Investiga los precios de la competencia y cita cada página de origen.",
  "marketplace.plugin.firecrawl.prompt.monitor": "¿Qué cambió en nuestra página de cambios este mes?",
  "marketplace.plugin.braveSearch.tagline": "Búsqueda web privada",
  "marketplace.plugin.braveSearch.description":
    "Brave Search permite a los agentes buscar en la web y obtener resultados locales sin rastreo. Una clave de API del panel de Brave Search API se pasa al servidor local como una variable de entorno.",
  "marketplace.plugin.braveSearch.app":
    "Búsqueda web y local, mediante un servidor MCP local con una clave de API de Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "¿Qué dicen las reseñas sobre esta versión del framework?",
  "marketplace.plugin.braveSearch.prompt.news": "Busca los anuncios de hoy sobre esta área de producto.",
  "marketplace.plugin.braveSearch.prompt.compare": "Compara estos dos proveedores con fuentes citadas.",
  "marketplace.plugin.obsidian.tagline": "Notas de tu bóveda",
  "marketplace.plugin.obsidian.description":
    "Obsidian permite a los agentes buscar, leer y escribir las notas de tu bóveda, para que la bóveda sea su memoria. El servidor local se conecta al plugin Local REST API de la app Obsidian en este equipo. La clave de API del plugin se pasa al servidor local como una variable de entorno. Mantén Obsidian abierto mientras los agentes lo usan.",
  "marketplace.plugin.obsidian.app":
    "Búsqueda, lectura y edición de notas, mediante un servidor MCP local con la clave del plugin Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "¿Qué dicen mis notas sobre las decisiones de este proyecto?",
  "marketplace.plugin.obsidian.prompt.save": "Guarda esta decisión como una nota nueva en mi bóveda.",
  "marketplace.plugin.obsidian.prompt.log": "Añade un resumen del trabajo de hoy a mi nota Registro de trabajo.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'En Obsidian, abre Settings > Local REST API. Copia la clave de API y activa "Enable non-encrypted (HTTP) server".',
  "marketplace.plugin.resend.tagline": "Correo transaccional",
  "marketplace.plugin.resend.description":
    "Resend permite a los agentes enviar correo transaccional y comprobar la entrega con una única API. Una clave de API del panel de Resend se pasa al servidor local como una variable de entorno.",
  "marketplace.plugin.resend.app":
    "Envío de correo y comprobación de entrega, mediante un servidor MCP local con una clave de API de Resend.",
  "marketplace.plugin.resend.prompt.send": "Envía el borrador del anuncio de lanzamiento a la lista beta.",
  "marketplace.plugin.resend.prompt.status": "¿Llegó al cliente el correo de la factura?",
  "marketplace.plugin.resend.prompt.template":
    "Redacta un correo de restablecimiento de contraseña para el nuevo flujo.",
  "marketplace.plugin.omnisend.tagline": "Marketing por email y SMS",
  "marketplace.plugin.omnisend.description":
    "Omnisend permite a los agentes leer informes de campañas y formularios, buscar contactos y segmentos, y crear y editar campañas, automatizaciones, plantillas de email, formularios y productos. Cada usuario inicia sesión en su propia cuenta de Omnisend en el navegador y elige el nivel de acceso en la pantalla de consentimiento. Con acceso de escritura, los agentes también pueden enviar campañas y eliminar datos. Elige acceso de solo lectura cuando los agentes solo necesiten informes.",
  "marketplace.plugin.omnisend.app":
    "Campañas, automatizaciones, contactos, segmentos, formularios e informes, a través del servidor MCP de Omnisend con inicio de sesión en el navegador.",
  "marketplace.plugin.omnisend.prompt.lastCampaign":
    "¿Qué tal funcionaron las campañas de la semana pasada en comparación con la anterior?",
  "marketplace.plugin.omnisend.prompt.segment": "¿Cuántos contactos hay en el segmento VIP y cómo cambió este mes?",
  "marketplace.plugin.omnisend.prompt.draftCampaign":
    "Prepara un borrador de campaña para la nueva colección, pero no lo envíes.",
  "marketplace.plugin.postiz.tagline": "Programación de redes sociales",
  "marketplace.plugin.postiz.description":
    "Postiz permite a los agentes listar tus canales de redes sociales y redactar, programar y publicar posts en más de 30 redes, como X, LinkedIn, Instagram y TikTok. Los agentes también pueden subir archivos multimedia y crear imágenes y vídeos con IA. Inicia sesión en tu cuenta de Postiz en el navegador o pega la clave de API de Settings › Developers en Postiz. Todos los planes de Postiz en la nube incluyen acceso a la API. Los agentes pueden publicar un post al instante, así que revisa cada post antes de aprobarlo.",
  "marketplace.plugin.postiz.app":
    "Canales, borradores, posts programados y multimedia, mediante el servidor MCP de Postiz con inicio de sesión en el navegador o una clave de API.",
  "marketplace.plugin.postiz.prompt.channels": "¿Qué canales de redes sociales están conectados a Postiz?",
  "marketplace.plugin.postiz.prompt.week": "¿Qué posts están programados para la próxima semana?",
  "marketplace.plugin.postiz.prompt.draft":
    "Redacta un post de LinkedIn sobre nuestra nueva versión, pero no lo programes.",
  "marketplace.plugin.trypost.tagline": "Programación de redes sociales",
  "marketplace.plugin.trypost.description":
    "TryPost permite a los agentes listar tus canales conectados y redactar, programar, poner en cola y publicar posts en X, LinkedIn, Instagram, Facebook, TikTok, YouTube, Threads, Bluesky, Mastodon, Pinterest y más. Los agentes también pueden leer las analíticas, gestionar ideas y aprobaciones y definir los horarios de publicación. Inicia sesión en tu cuenta de TryPost en el navegador y elige un workspace. Los agentes pueden publicar un post al instante, así que revisa cada post antes de aprobarlo.",
  "marketplace.plugin.trypost.app":
    "Canales, posts, cola, ideas y analíticas, con el servidor MCP de TryPost e inicio de sesión en el navegador.",
  "marketplace.plugin.trypost.prompt.week": "¿Qué posts están programados para esta semana?",
  "marketplace.plugin.trypost.prompt.draft":
    "Redacta un post de LinkedIn sobre nuestra nueva versión, pero no lo programes.",
  "marketplace.plugin.trypost.prompt.analytics": "¿Cuáles de mis posts del mes pasado tuvieron más interacción?",
  "marketplace.plugin.composio.tagline": "Gmail, Slack, GitHub y más de 1000 aplicaciones",
  "marketplace.plugin.composio.description":
    "Composio conecta tus agentes con Gmail, Slack, GitHub y más de 1000 aplicaciones más mediante un único servidor MCP. Inicia sesión con tu cuenta de Composio. Cuando un agente necesita una aplicación, te pide que la conectes.",
  "marketplace.plugin.composio.app":
    "Las aplicaciones que conectas en tu cuenta de Composio. Un agente te pide que conectes una aplicación cuando la necesita.",
  "marketplace.plugin.composio.prompt.inbox": "Resume mi correo no leído y redacta respuestas a los urgentes.",
  "marketplace.plugin.composio.prompt.handoff":
    "Publica un resumen de este pull request en el canal de nuestro equipo.",
  "marketplace.plugin.composio.prompt.apps": "¿Qué aplicaciones y acciones puedes usar mediante Composio?",
  "marketplace.plugin.composio.hint.apiKey":
    "La encontrarás en tu cuenta de Composio, en Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Proyectos, ramas y migraciones de Postgres",
  "marketplace.plugin.neon.description":
    "Neon permite a los agentes listar proyectos y ramas, ejecutar SQL, leer esquemas de tablas, probar cambios de esquema en una rama temporal, encontrar consultas lentas y buscar en la documentación de Neon. Cada usuario inicia sesión en su propia cuenta de Neon desde el navegador y puede elegir acceso de solo lectura al autorizar. Con acceso completo, los agentes pueden ejecutar SQL que cambia o elimina datos, y crear, restablecer o eliminar ramas, bases de datos y proyectos. Neon recomienda su servidor MCP para desarrollo y pruebas, no para bases de datos de producción.",
  "marketplace.plugin.neon.app":
    "Proyectos, ramas, SQL y migraciones de Postgres, mediante el servidor MCP de Neon con inicio de sesión en el navegador.",
  "marketplace.plugin.neon.prompt.projects": "¿Qué proyectos y ramas hay en mi cuenta de Neon?",
  "marketplace.plugin.neon.prompt.slowQueries":
    "¿Qué consultas son las más lentas en mi base de datos de Neon y por qué?",
  "marketplace.plugin.neon.prompt.migration":
    "Añade un índice a la tabla orders en una rama temporal y muéstrame el resultado antes de aplicarlo.",
  "marketplace.plugin.prisma.tagline": "Bases de datos Postgres, copias de seguridad y apps de Compute",
  "marketplace.plugin.prisma.description":
    "Prisma permite a los agentes listar y crear bases de datos de Prisma Postgres, leer esquemas, ejecutar SQL, listar copias de seguridad y restaurarlas en una base de datos nueva, gestionar buckets de Object Storage, leer compilaciones y registros de Compute, y buscar en la documentación de Prisma. Cada usuario inicia sesión en su propia cuenta de Prisma desde el navegador y selecciona un workspace. Los agentes tienen acceso completo: pueden ejecutar SQL que cambia o elimina datos, actualizar esquemas, eliminar bases de datos y buckets, y detener, revertir o eliminar despliegues de Compute.",
  "marketplace.plugin.prisma.app":
    "Bases de datos, SQL, copias de seguridad y apps de Compute, mediante el servidor MCP de Prisma con inicio de sesión en el navegador.",
  "marketplace.plugin.prisma.prompt.databases": "¿Qué bases de datos hay en mi workspace de Prisma?",
  "marketplace.plugin.prisma.prompt.backups":
    "Muéstrame todas las copias de seguridad disponibles de mi base de datos.",
  "marketplace.plugin.prisma.prompt.logs": "Muestra los registros de ejecución de mi último despliegue de Compute.",
  "marketplace.plugin.netlify.tagline": "Proyectos, despliegues y registros de solicitudes",
  "marketplace.plugin.netlify.description":
    "Netlify permite a los agentes listar proyectos y despliegues, leer registros de solicitudes en el edge, crear proyectos y desplegar código en un proyecto existente. Cada usuario inicia sesión en su propia cuenta de Netlify desde el navegador. Los agentes tienen el mismo acceso que la cuenta del usuario: pueden cambiar variables de entorno, formularios y el acceso de visitantes, instalar o quitar extensiones, y eliminar envíos de formularios y variables de entorno.",
  "marketplace.plugin.netlify.app":
    "Proyectos, despliegues, registros de solicitudes y ajustes del sitio, mediante el servidor MCP de Netlify con inicio de sesión en el navegador.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "¿Cuál es el estado del último despliegue de cada uno de mis proyectos de Netlify?",
  "marketplace.plugin.netlify.prompt.errors": "¿Qué URL de mi sitio devolvieron errores del servidor en el último día?",
  "marketplace.plugin.netlify.prompt.deploy": "Despliega esta carpeta en mi proyecto existente de Netlify.",
  "marketplace.plugin.railway.tagline": "Proyectos, servicios y despliegues",
  "marketplace.plugin.railway.description":
    "Railway permite a los agentes listar proyectos y servicios, crear proyectos, volver a desplegar servicios y gestionar feature flags. Los agentes también pueden pasar trabajo de varios pasos al Railway Agent, que lee registros, averigua por qué falló un despliegue, crea servicios y define variables. Cada usuario inicia sesión en su propia cuenta de Railway desde el navegador y elige los espacios de trabajo y proyectos que pueden usar los agentes. En esos proyectos, los agentes tienen acceso completo: pueden desplegar cambios preparados, eliminar feature flags y cambiar servicios, variables, bases de datos y la red mediante el Railway Agent.",
  "marketplace.plugin.railway.app":
    "Proyectos, servicios y despliegues, mediante el servidor MCP de Railway con inicio de sesión en el navegador.",
  "marketplace.plugin.railway.prompt.projects": "¿Qué proyectos y servicios hay en mi espacio de trabajo de Railway?",
  "marketplace.plugin.railway.prompt.crash": "¿Por qué mi servicio de backend en Railway falla al desplegarse?",
  "marketplace.plugin.railway.prompt.redeploy": "Vuelve a desplegar el servicio de la API en mi proyecto de Railway.",
  "marketplace.plugin.render.tagline": "Servicios, despliegues y registros",
  "marketplace.plugin.render.description":
    "Render permite a los agentes listar espacios de trabajo y servicios, leer registros, eventos y métricas, ver el historial de despliegues, iniciar despliegues y ejecutar SQL de solo lectura en Render Postgres. Una clave de API de Render va en un encabezado Authorization. La clave llega a todos los espacios de trabajo de la cuenta de Render. Los agentes pueden crear servicios web, sitios estáticos, tareas cron, bases de datos Postgres e instancias Key Value, lo que puede tener coste, y pueden reemplazar las variables de entorno de un servicio. El servidor no puede eliminar ningún recurso.",
  "marketplace.plugin.render.app":
    "Servicios, despliegues, registros y métricas, mediante el servidor MCP de Render con una clave de API.",
  "marketplace.plugin.render.prompt.services": "¿Qué servicios hay en mi espacio de trabajo de Render?",
  "marketplace.plugin.render.prompt.logs": "¿Qué errores registró mi servicio web de Render en la última hora?",
  "marketplace.plugin.render.prompt.deploy": "¿Por qué falló el último despliegue de mi servicio de Render?",
  "marketplace.plugin.atlassian.tagline": "Elementos de trabajo de Jira y páginas de Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian permite a los agentes buscar y leer elementos de trabajo de Jira, páginas de Confluence y pull requests de Bitbucket, y crear o actualizar elementos de trabajo, páginas y comentarios. Cada usuario inicia sesión en su propia cuenta de Atlassian desde el navegador y aprueba el acceso en una pantalla de consentimiento. Los agentes tienen los mismos permisos que el usuario: pueden cambiar elementos de trabajo y páginas, cambiar los permisos de las páginas y fusionar pull requests. Las herramientas que eliminan datos de Jira siguen desactivadas hasta que un administrador de la organización las activa. Cada llamada a una herramienta consume créditos de Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence y Bitbucket, mediante el servidor MCP de Atlassian con inicio de sesión en el navegador.",
  "marketplace.plugin.atlassian.prompt.assigned": "¿Qué elementos de trabajo abiertos de Jira tengo asignados?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Busca la página de Confluence sobre nuestro proceso de lanzamiento y resúmela.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Crea un elemento de trabajo de Jira para el error de inicio de sesión con los pasos para reproducirlo.",
  "marketplace.plugin.todoist.tagline": "Tareas, proyectos y recordatorios",
  "marketplace.plugin.todoist.description":
    "Todoist permite a los agentes buscar tareas por fecha, texto, etiqueta o filtro, añadir y reprogramar tareas, y gestionar proyectos, secciones, etiquetas, comentarios y recordatorios. Cada usuario inicia sesión en su propia cuenta de Todoist desde el navegador. Los agentes tienen acceso de lectura y escritura: pueden cambiar, completar y eliminar tareas, proyectos y otros elementos.",
  "marketplace.plugin.todoist.app":
    "Tareas, proyectos y recordatorios, mediante el servidor MCP de Todoist con inicio de sesión en el navegador.",
  "marketplace.plugin.todoist.prompt.today": "¿Qué tareas de Todoist vencen hoy?",
  "marketplace.plugin.todoist.prompt.capture": "Añade estas tareas pendientes a mi bandeja de entrada de Todoist.",
  "marketplace.plugin.todoist.prompt.overdue": "Pasa mis tareas vencidas de Todoist a mañana.",
  "marketplace.plugin.ticktick.tagline": "Tareas, listas, hábitos y concentración",
  "marketplace.plugin.ticktick.description":
    "TickTick permite a los agentes buscar y filtrar tareas, añadir y cambiar tareas, y gestionar listas, secciones, carpetas, etiquetas y comentarios. Los agentes también pueden leer y cambiar hábitos y registros de concentración, y leer eventos de los calendarios conectados a TickTick. Cada usuario inicia sesión en su propia cuenta de TickTick en el navegador. Los agentes obtienen acceso de lectura y escritura: pueden completar, mover y eliminar tareas, y eliminar etiquetas y registros de concentración.",
  "marketplace.plugin.ticktick.app":
    "Tareas, listas, hábitos y registros de concentración, a través del servidor MCP de TickTick con inicio de sesión en el navegador.",
  "marketplace.plugin.ticktick.prompt.today": "¿Qué tareas de TickTick vencen hoy?",
  "marketplace.plugin.ticktick.prompt.capture": "Añade estos puntos de acción a mi bandeja de entrada de TickTick.",
  "marketplace.plugin.ticktick.prompt.week": "¿Qué tareas de TickTick completé la semana pasada?",
  "marketplace.plugin.trello.tagline": "Tableros, listas y tarjetas",
  "marketplace.plugin.trello.description":
    "Trello permite a los agentes buscar y leer tableros, listas, tarjetas, listas de comprobación y comentarios, crear tableros y tarjetas, mover listas y tarjetas, marcar tarjetas como completadas y añadir listas de comprobación, comentarios y etiquetas. Los agentes también pueden leer y añadir tarjetas en la Bandeja de entrada de Trello del usuario y leer los eventos del Planner, que pueden venir de un calendario de Google u Outlook conectado. Cada usuario inicia sesión en su propia cuenta de Trello desde el navegador y elige los espacios de trabajo en una pantalla de consentimiento. Los agentes tienen los mismos permisos que el usuario en esos espacios de trabajo. Pueden archivar tarjetas y listas, pero el servidor no puede eliminar nada de forma permanente.",
  "marketplace.plugin.trello.app":
    "Tableros, listas y tarjetas, a través del servidor MCP de Trello con inicio de sesión en el navegador.",
  "marketplace.plugin.trello.prompt.myCards": "¿Qué tarjetas de Trello tengo asignadas?",
  "marketplace.plugin.trello.prompt.board": "Resume lo que está en curso en mi tablero de Trello.",
  "marketplace.plugin.trello.prompt.newCards": "Añade estas tareas pendientes como tarjetas a mi tablero de Trello.",
  "marketplace.plugin.clickup.tagline": "Tareas, documentos y novedades del equipo",
  "marketplace.plugin.clickup.description":
    "ClickUp permite a los agentes buscar tareas, documentos, comentarios y chats, crear y actualizar tareas, listas y documentos, publicar comentarios, enviar mensajes de chat y registrar tiempo. Cada usuario inicia sesión en su propia cuenta de ClickUp desde el navegador. Los agentes tienen los mismos permisos que el usuario. Pueden mover tareas a la papelera y eliminar comentarios.",
  "marketplace.plugin.clickup.app":
    "Tareas, documentos, comentarios, chat y registro de tiempo, a través del servidor MCP de ClickUp con inicio de sesión en el navegador.",
  "marketplace.plugin.clickup.prompt.findTasks": "Busca mis tareas abiertas de ClickUp que vencen esta semana.",
  "marketplace.plugin.clickup.prompt.createTask": "Crea una tarea de ClickUp con estas tareas pendientes y asígnamela.",
  "marketplace.plugin.clickup.prompt.summarizeDoc":
    "Busca la última actualización del proyecto en ClickUp y resume las preguntas abiertas.",
  "marketplace.plugin.coinbase.tagline": "Precios cripto, carteras y trading",
  "marketplace.plugin.coinbase.description":
    "Coinbase permite a los agentes leer precios, saldos, carteras, órdenes y comisiones en Coinbase Advanced Trade, previsualizar y colocar órdenes, convertir entre activos y mover fondos entre carteras. Cada usuario inicia sesión en su propia cuenta de Coinbase desde el navegador. Los agentes tienen los mismos permisos que el usuario. Las órdenes y conversiones usan fondos reales, y los agentes pueden pagar solicitudes x402 con el saldo en USDC.",
  "marketplace.plugin.coinbase.app":
    "Precios, saldos, carteras, órdenes y conversiones, a través del servidor MCP de Coinbase con inicio de sesión en el navegador.",
  "marketplace.plugin.coinbase.prompt.balances": "¿Cuáles son mis saldos de Coinbase en cada cartera?",
  "marketplace.plugin.coinbase.prompt.price": "Muestra el precio de BTC-USD en Coinbase y cómo se movió esta semana.",
  "marketplace.plugin.coinbase.prompt.previewOrder":
    "Previsualiza una compra a mercado de ETH por 50 USD en Coinbase. No coloques la orden.",
  "marketplace.plugin.robinhood.tagline": "Cuentas de bolsa y trading con agentes",
  "marketplace.plugin.robinhood.description":
    "Robinhood permite a los agentes leer las cuentas, posiciones, saldos, historial de transacciones y listas de seguimiento de un cliente de Robinhood, leer datos de mercado y colocar órdenes de acciones, opciones y cripto. Cada usuario inicia sesión en su propia cuenta de Robinhood desde el navegador. En el primer inicio de sesión, Robinhood pide al usuario que abra una cuenta Agentic aparte. Los agentes solo pueden operar en esa cuenta y, por defecto, colocan órdenes sin pedir al usuario que apruebe cada una.",
  "marketplace.plugin.robinhood.app":
    "Cuentas, posiciones, datos de mercado y operaciones, a través del servidor MCP de Robinhood con inicio de sesión en el navegador.",
  "marketplace.plugin.robinhood.prompt.positions": "Resume mis posiciones en Robinhood y cómo se movieron hoy.",
  "marketplace.plugin.robinhood.prompt.watchlist":
    "¿Cómo se movió esta semana cada acción de mi lista de seguimiento de Robinhood?",
  "marketplace.plugin.robinhood.prompt.agenticCash": "¿Cuánto efectivo hay en mi cuenta Agentic de Robinhood?",
  "marketplace.plugin.huggingface.tagline": "Modelos, datasets y artículos en el Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face permite a los agentes buscar modelos, datasets, Spaces, colecciones y artículos en el Hugging Face Hub, leer model cards y archivos de repositorios, ver una vista previa de datasets y buscar en la documentación de Hugging Face. Usa datos públicos del Hub y no necesita cuenta ni clave. Las herramientas solo leen: los agentes no pueden crear repositorios ni ejecutar jobs.",
  "marketplace.plugin.huggingface.app":
    "Búsqueda de modelos, datasets, Spaces, artículos y documentación, mediante el servidor MCP de Hugging Face sin inicio de sesión.",
  "marketplace.plugin.huggingface.prompt.models":
    "Busca modelos abiertos pequeños de reconocimiento de voz en Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "¿Qué artículos son tendencia hoy en Hugging Face?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Busca un dataset de series temporales meteorológicas y muestra sus columnas.",
  "marketplace.auth.apiKey": "Clave de API",
  "marketplace.auth.personalApiKey": "Clave de API personal",
  "marketplace.auth.createKey": "Crear una clave",
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Probar en {name}",
  "marketplace.skills.yours": "Tus habilidades",
  "marketplace.skills.seeAll": "Ver todo",
  "marketplace.skills.seeAllName": "Ver todo: {name}",
  "marketplace.skills.none": "Ningún agente tiene una habilidad todavía.",
  "marketplace.skills.noneHint": "Una habilidad enseña una tarea a un agente. Añade una abajo o crea la tuya.",
  "marketplace.skills.sourceLabel": "Origen",
  "marketplace.skills.source.all": "Todas",
  "marketplace.skills.source.verified": "Verificadas",
  "marketplace.skills.source.public": "Públicas",
  "marketplace.skills.source.verifiedLong": "Verificada por OpenBot",
  "marketplace.skills.source.publicLong": "Revisada por OpenBot",
  "marketplace.skills.sortLabel": "Ordenar",
  "marketplace.skills.sortName": "Ordenar: {name}",
  "marketplace.skills.sort.installs": "Más usadas",
  "marketplace.skills.sort.updated": "Actualizadas recientemente",
  "marketplace.skills.sort.name": "Nombre",
  "marketplace.skills.featured": "Destacadas",
  "marketplace.skills.all": "Todas las habilidades",
  "marketplace.skills.count": { one: "{count} habilidad", other: "{count} habilidades" },
  "marketplace.skills.searchIn": "Buscar en {name}",
  "marketplace.skills.missing": "Esta habilidad no está en el Marketplace.",
  "marketplace.skills.state.off": "Desactivada",
  "marketplace.skills.state.repair": "Necesita reparación",
  "marketplace.skills.state.update": "Actualización disponible",
  "marketplace.skills.state.modified": "Cambiada por ti",
  "marketplace.skills.stateOn": "{state} en {agents}",
  "marketplace.skills.version": "Versión {version}",
  "marketplace.skills.origin.local": "Creada en este equipo",
  "marketplace.skills.origin.workspace": "En la carpeta de este agente",
  "marketplace.skills.origin.marketplace": "Del Marketplace · versión {version}",
  "marketplace.skills.origin.github": "De GitHub · {repository}",
  "marketplace.skills.github.search": "Busca o pega un enlace de GitHub",
  "marketplace.skills.github.reading": "Buscando habilidades en el repositorio",
  "marketplace.skills.github.trust":
    "OpenBot no revisó las habilidades de GitHub. Lee una habilidad antes de añadirla.",
  "marketplace.skills.github.source": "GitHub · {repository} en {commit}",
  "marketplace.skills.github.open": "GitHub",
  "marketplace.skills.github.openName": "Abrir {repository} en GitHub",
  "marketplace.skills.status.notAdded": "Sin añadir",
  "marketplace.skills.status.on": "Activada en {agents}",
  "marketplace.skills.agentCount": { one: "{count} agente", other: "{count} agentes" },
  "marketplace.skills.allAgents": "todos los agentes",
  "marketplace.skills.agentsTitle": "Agentes · {total}",
  "marketplace.skills.agents.search": "Buscar agentes",
  "marketplace.skills.agents.searchName": "Buscar los agentes con {name}",
  "marketplace.skills.agents.noMatch": "Ningún agente coincide con «{query}».",
  "marketplace.skills.agents.removeAll": "Quitar todo",
  "marketplace.skills.agents.removeAllName": {
    one: "Quitar {name} de {count} agente",
    other: "Quitar {name} de los {count} agentes",
  },
  "marketplace.skills.agent.toggle": "{name} para {agent}",
  "marketplace.skills.agent.remove": "Quitar",
  "marketplace.skills.agent.removeName": "Quitar {name} de {agent}",
  "marketplace.skills.add": "Añadir",
  "marketplace.skills.addName": "Añadir {name} a agentes",
  "marketplace.skills.addToAgents": "Añadir a agentes",
  "marketplace.skills.onOf": "Activada en {have} de {total}",
  "marketplace.skills.chooseAgents": "{name} está en {agents}. Elegir agentes",
  "marketplace.skills.dialog.list": "Agentes con {name}",
  "marketplace.skills.dialog.search": { one: "Buscar en {count} agente", other: "Buscar en {count} agentes" },
  "marketplace.skills.dialog.all": { one: "{count} agente", other: "Los {count} agentes" },
  "marketplace.skills.dialog.allMatches": { one: "{count} coincidencia", other: "Las {count} coincidencias" },
  "marketplace.skills.dialog.checked": "{checked} de {total}",
  "marketplace.skills.dialog.save": "Guardar",
  "marketplace.skills.dialog.saveBoth": "Guardar: añadir {added}, quitar {removed}",
  "marketplace.skills.dialog.addTo": "Añadir a {agents}",
  "marketplace.skills.dialog.removeFrom": "Quitar de {agents}",
  "marketplace.skills.dialog.full": "Límite de habilidades alcanzado",
  "marketplace.skills.dialog.unread": "Habilidades no leídas",
  "marketplace.skills.local.gone": "Ningún agente tiene esta habilidad ahora.",
  "marketplace.notice.agentAdded": "{name} añadido.",
  "marketplace.notice.agentUpdated": "{name} actualizado.",
  "marketplace.notice.appConnected": "{name} conectada.",
  "marketplace.notice.appDisconnected": "{name} desconectada.",
  "marketplace.notice.serverRemoved": "{name} eliminado.",
  "marketplace.notice.skillInstalled": {
    one: "{name} instalada en {count} agente.",
    other: "{name} instalada en {count} agentes.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} eliminada de {count} agente.",
    other: "{name} eliminada de {count} agentes.",
  },
  "marketplace.error.skillPartial": "{name} no cambió en estos agentes: {agents}. {reason}",
  "marketplace.error.openLink": "No se pudo abrir el enlace.",
  "marketplace.error.copyLink": "No se pudo copiar el enlace.",
  "marketplace.error.connectNoServer": "Selecciona un servidor local para conectar esta app.",
  "marketplace.error.installNoServer": "Selecciona un servidor local para instalar un plugin.",
  "marketplace.error.installNoAgent": "Elige un agente para instalar las habilidades de este plugin.",
  "marketplace.error.installLocalOnHost":
    "Instala {name} en el equipo donde se ejecutan estos agentes: su app ejecuta su servidor en ese equipo.",
  "marketplace.error.installOnHost":
    "Instala {name} en el equipo donde se ejecutan estos agentes: su app requiere iniciar sesión en un navegador.",
  "marketplace.error.appInvalid": "No se puede añadir {name}: {reason}",
  "marketplace.error.uninstallNoServer": "Selecciona un servidor local para desinstalar un plugin.",
  "marketplace.error.uninstallPartial": "No se pudieron eliminar algunas partes de {name}. {failures}",
  "marketplace.error.actionFailed": "No se pudo completar la acción del marketplace. Inténtalo de nuevo.",
  "marketplace.thisAgent": "este agente",
} as const satisfies PartialTranslation<typeof source>;
