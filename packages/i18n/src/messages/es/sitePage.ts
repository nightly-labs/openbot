import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "No se pudo cargar esta página",
  "sitePage.error.body":
    "Comprueba tu conexión y vuelve a cargar la página. Si sigue sin cargar, vuelve a la página de inicio.",
  "sitePage.error.reload": "Recargar página",
  "sitePage.error.home": "Volver al inicio",
  "sitePage.join.title": "Unirse a un servidor de OpenBot",
  "sitePage.join.description": "Abre una invitación privada a un servidor en OpenBot.",
  "sitePage.join.eyebrow": "Invitación privada",
  "sitePage.join.intro":
    "Abre esta invitación en OpenBot. La app comprueba el servidor y te pide confirmación antes de conectarse.",
  "sitePage.join.invalid":
    "Este enlace de invitación no es válido o está incompleto. Pide una nueva invitación al propietario del servidor.",
  "sitePage.join.open": "Abrir OpenBot",
  "sitePage.join.browser": "Abrir en el navegador",
  "sitePage.join.download": "Descargar OpenBot",
  "sitePage.join.notOpened":
    "Si OpenBot no se abrió, instálalo con {download} o inicia OpenBot una vez para que pueda abrir enlaces de invitación. También puedes usar {browser}.",
  "sitePage.join.mobile":
    "Si OpenBot está instalado, toca {open}. También puedes pegar este enlace en Añadir servidor dentro de la app.",
  "sitePage.join.singleUse":
    "Un enlace de un solo uso funciona una vez y luego caduca. Un enlace permanente funciona hasta que el propietario lo revoca. OpenBot muestra la caducidad antes de que te unas.",
  "sitePage.join.email": "Si la invitación llegó por correo, inicia sesión en OpenBot con esa dirección de correo.",
  "sitePage.join.share": "Este enlace da acceso a un servidor. Compártelo solo con las personas que quieras invitar.",
  "sitePage.connect.title": "Volver a OpenBot",
  "sitePage.connect.failedTitle": "La conexión no terminó",
  "sitePage.connect.openApp": "Abrir OpenBot",
  "sitePage.connect.tryAgainApp": "Reintentar en OpenBot",
  "sitePage.connect.tryAgainBrowser": "Reintentar en el navegador",
  "sitePage.connect.doneInWebClient":
    "Tu pestaña de OpenBot termina la conexión con {name}. Puedes cerrar esta pestaña.",
  "sitePage.connect.doneInApp": "OpenBot termina la conexión con {name} en tu ordenador.",
  "sitePage.connect.failure.cancelled": "Se canceló la conexión con {name}. No cambió nada.",
  "sitePage.connect.failure.expired": "El inicio de sesión en {name} caducó. Vuelve a iniciar la conexión.",
  "sitePage.connect.failure.exchange": "{name} no confirmó la conexión. Inténtalo de nuevo.",
  "sitePage.connect.failure.enterprise": "Conecta un espacio de trabajo de Slack, no una organización completa.",
  "sitePage.connect.failure.takenSlack":
    "Otro servidor de OpenBot ya responde en este espacio de trabajo de Slack. Desconéctalo en ese servidor y vuelve a intentarlo.",
  "sitePage.connect.failure.takenDiscord":
    "Otro servidor de OpenBot ya responde en este servidor de Discord. Desconéctalo en ese servidor y vuelve a intentarlo.",
  "sitePage.connect.failure.unavailable": "OpenBot no puede conectarse a {name} ahora. Inténtalo más tarde.",
  "sitePage.connect.failure.tabClosed":
    "La pestaña de OpenBot que inició la conexión con {name} no respondió. Abre OpenBot en tu navegador y vuelve a conectar {name}.",
  "sitePage.connect.failure.failed": "{name} no terminó la conexión. Inténtalo de nuevo.",
  "sitePage.connect.restartHint": "En OpenBot, abre {marketplace}, luego {apps}, luego {name}, y selecciona {connect}.",
  "sitePage.connect.notOpened":
    "Inicia OpenBot y vuelve a intentarlo. Si OpenBot no está en este ordenador, descárgalo y conecta {name} desde la app.",
  "sitePage.openApp.title": "¿No se abrió nada?",
  "sitePage.openApp.dismiss": "Ahora no",
  "sitePage.billing.pageTitle": "Facturación de OpenBot",
  "sitePage.billing.updatedTitle": "Facturación actualizada",
  "sitePage.billing.updatedBody": "Vuelve a OpenBot. Puedes cerrar esta página.",
  "sitePage.billing.cancelledTitle": "Pago cancelado",
  "sitePage.billing.cancelledBody": "No se cobró nada. Vuelve a OpenBot.",
  "sitePage.report.pageTitle": "Denunciar un sitio alojado — OpenBot",
  "sitePage.report.title": "Denunciar un sitio alojado",
  "sitePage.report.intro": "Envía una denuncia sobre contenido dañino o ilegal en una dirección de openbot.site.",
  "sitePage.report.hostnameLabel": "Dirección del sitio",
  "sitePage.report.hostnameMissing": "Introduce la dirección del sitio",
  "sitePage.report.reasonLabel": "Motivo",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuso",
  "sitePage.report.reason.copyright": "Derechos de autor",
  "sitePage.report.reason.other": "Otros",
  "sitePage.report.detailsLabel": "Detalles",
  "sitePage.report.optional": "Opcional",
  "sitePage.report.detailsPlaceholder": "¿Qué problema tiene este sitio?",
  "sitePage.report.send": "Enviar denuncia",
  "sitePage.report.sending": "Enviando…",
  "sitePage.report.tooMany": "Demasiadas denuncias. Inténtalo más tarde.",
  "sitePage.report.sendFailed": "No se pudo enviar la denuncia. Inténtalo de nuevo.",
  "sitePage.report.writeTo": "También puedes escribir a {email}.",
  "sitePage.report.sentTitle": "Denuncia enviada",
  "sitePage.report.sentBody": "Gracias. Hemos recibido tu denuncia.",
  "sitePage.report.home": "Ir a la página de inicio",
  "sitePage.pricing.title": "Precios de OpenBot",
  "sitePage.pricing.description":
    "Servidores alojados y una licencia para equipos. OpenBot es gratis para uso personal en tu propio equipo.",
  "sitePage.pricing.heading": "Precios",
  "sitePage.pricing.enterprise.title": "Empresas",
  "sitePage.pricing.enterprise.body":
    "Servidores más grandes, más de {count} miembros o cualquier otra cosa que necesites. Con soporte empresarial.",
  "sitePage.pricing.enterprise.contact": "Contactar con ventas",
} as const satisfies PartialTranslation<typeof source>;
