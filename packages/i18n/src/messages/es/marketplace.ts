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
  "marketplace.close": "Cerrar marketplace",
  "marketplace.kinds": "Tipos de contenido del marketplace",
  "marketplace.tab.agents": "Agentes",
  "marketplace.tab.skills": "Habilidades",
  "marketplace.plugins.missing": "Este plugin no está en el catálogo de OpenBot.",
  "marketplace.agents.loadingDetail": "Cargando detalles del agente…",
  "marketplace.agents.skills": "Habilidades",
  "marketplace.agents.routines": "Rutinas",
  "marketplace.agents.routineActive": "Activa",
  "marketplace.agents.routineInactive": "Inactiva",
  "marketplace.skill.loading": "Cargando habilidad",
  "marketplace.skill.update": "Actualizar habilidad",
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
  "marketplace.filter": "Filtrar",
  "marketplace.filter.on": "Filtro: {filters}",
  "marketplace.filter.all": "Todos",
  "marketplace.filter.status": "Estado",
  "marketplace.filter.category": "Categoría",
  "marketplace.filter.added": "Añadidos",
  "marketplace.filter.notAdded": "Sin añadir",
  "marketplace.filter.installed": "Instalados",
  "marketplace.filter.notInstalled": "Sin instalar",
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
  "marketplace.properties.agent": "Acerca de este agente",
  "marketplace.properties.skill": "Acerca de esta habilidad",
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
  "marketplace.app.reconnect": "Volver a conectar",
  "marketplace.app.connectNamed": "Conectar {name}",
  "marketplace.app.reconnectNamed": "Volver a conectar {name}",
  "marketplace.app.connected": "Conectada",
  "marketplace.app.attention": "Requiere atención",
  "marketplace.app.notConnected": "Sin conectar",
  "marketplace.app.custom": "Servidor MCP",
  "marketplace.app.githubTagline": "Repositorios, incidencias y pull requests",
  "marketplace.app.onePasswordTagline": "Inicia sesión en sitios con las credenciales que compartes",
  "marketplace.app.onePasswordCategory": "Gestión de inicios de sesión y credenciales",
  "marketplace.app.yourApps": "Tus apps",
  "marketplace.app.moreApps": "Más apps",
  "marketplace.app.server": "Servidor",
  "marketplace.app.command": "Comando",
  "marketplace.app.address": "Dirección",
  "marketplace.app.disconnect.title": "Desconectar",
  "marketplace.app.disconnect.description":
    "Elimina {name} y sus habilidades de este equipo. Puedes volver a conectarla más adelante.",
  "marketplace.app.disconnect.action": "Desconectar",
  "marketplace.app.remove.title": "Eliminar servidor",
  "marketplace.app.remove.description": "Tus agentes ya no podrán usar este servidor. Se eliminarán sus ajustes.",
  "marketplace.app.remove.action": "Eliminar",
  "marketplace.app.remove.confirmTitle": "¿Eliminar {name}?",
  "marketplace.app.remove.keep": "Conservar",
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
  "marketplace.plugin.sentry.tagline": "Triaje de errores y fallos",
  "marketplace.plugin.sentry.description":
    "Sentry permite a los agentes buscar errores recientes, inspeccionar trazas de pila y versiones afectadas, y resumir qué se rompió tras un despliegue. Cada usuario inicia sesión en su propia cuenta de Sentry desde el navegador.",
  "marketplace.plugin.sentry.app":
    "Búsqueda de errores, inspección de incidencias y estado de las versiones, mediante el servidor MCP de Sentry con inicio de sesión en el navegador.",
  "marketplace.plugin.sentry.prompt.newErrors": "¿Qué errores nuevos aparecieron desde el despliegue de ayer?",
  "marketplace.plugin.sentry.prompt.topCrash": "Explica el fallo más frecuente del proyecto móvil y su causa probable.",
  "marketplace.plugin.sentry.prompt.releaseHealth":
    "¿Qué tan estable es la versión actual en comparación con la anterior?",
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
  "marketplace.plugin.braveSearch.prompt.search": "¿Qué dicen los analistas sobre esta versión del framework?",
  "marketplace.plugin.braveSearch.prompt.news": "Busca los anuncios de hoy sobre esta área de producto.",
  "marketplace.plugin.braveSearch.prompt.compare": "Compara estos dos proveedores con fuentes citadas.",
  "marketplace.plugin.resend.tagline": "Correo transaccional",
  "marketplace.plugin.resend.description":
    "Resend permite a los agentes enviar correo transaccional y comprobar la entrega con una única API. Una clave de API del panel de Resend se pasa al servidor local como una variable de entorno.",
  "marketplace.plugin.resend.app":
    "Envío de correo y comprobación de entrega, mediante un servidor MCP local con una clave de API de Resend.",
  "marketplace.plugin.resend.prompt.send": "Envía el borrador del anuncio de lanzamiento a la lista beta.",
  "marketplace.plugin.resend.prompt.status": "¿Llegó al cliente el correo de la factura?",
  "marketplace.plugin.resend.prompt.template":
    "Redacta un correo de restablecimiento de contraseña para el nuevo flujo.",
  "marketplace.plugin.composio.tagline": "Muchas aplicaciones con tu propio enlace de Composio",
  "marketplace.plugin.composio.description":
    "Composio conecta los agentes con Gmail, Slack, GitHub y cientos de aplicaciones más mediante un único servidor MCP. Crea el servidor en tu cuenta de Composio, añádele las aplicaciones que quieras y pega aquí su enlace. Añade una clave de API solo si tu servidor la necesita.",
  "marketplace.plugin.composio.app":
    "Las aplicaciones que añadas a tu servidor MCP de Composio, mediante el enlace de tu cuenta de Composio.",
  "marketplace.plugin.composio.prompt.inbox": "Resume mi correo no leído y redacta respuestas a los urgentes.",
  "marketplace.plugin.composio.prompt.handoff":
    "Publica un resumen de esta solicitud de incorporación en el canal de nuestro equipo.",
  "marketplace.plugin.composio.prompt.apps": "¿Qué aplicaciones y acciones puedes usar mediante Composio?",
  "marketplace.skill.installMenu.install": "Instalar",
  "marketplace.skill.installMenu.installNamed": "Instalar {name}",
  "marketplace.skill.installMenu.allAgents": "Todos los agentes",
  "marketplace.skill.installMenu.agents": {
    one: "{count} agente",
    other: "{count} agentes",
  },
  "marketplace.skill.installMenu.here": "Estás aquí",
  "marketplace.skill.installMenu.change": {
    one: "{label} tiene {name}. Cambiar",
    other: "{label} tienen {name}. Cambiar",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Probar en {name}",
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
