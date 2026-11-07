import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "No se pudo cambiar el plan del servidor. Actualiza Facturación e inténtalo de nuevo.",
  "error.billing.confirmMismatch": "Escribe el nombre del servidor para eliminarlo.",
  "error.billing.restartBusy": "El servidor no puede reiniciarse ahora. Inténtalo de nuevo en un minuto.",
  "error.billing.planRequired": "El plan de este servidor terminó. Renuévalo para iniciar el servidor.",
  "error.billing.planSoldOut": "Este plan está agotado. Elige otro plan.",
  "error.billing.licenseExists": "Esta cuenta ya tiene una licencia. Cambia sus usuarios en su lugar.",
  "error.billing.licenseCurrency": "La licencia debe usar la moneda de tus otros planes.",
  "error.billing.planCurrency": "Un plan nuevo debe usar la moneda de tus otros planes.",
  "error.billing.licenseUsersInUse": "La licencia no puede tener menos usuarios que las personas que la usan ahora.",
  "error.billing.licensePaymentFailed":
    "El pago de los usuarios añadidos falló. Actualiza el método de pago e inténtalo de nuevo.",
  "error.billing.licenseUnavailable": "Las licencias no están disponibles ahora.",
  "error.billing.licenseOneUser": "Esta licencia es para 1 usuario. Cámbiala a Team para añadir usuarios.",
  "error.billing.licensePlanChange": "Esta licencia no puede cambiar a ese plan. Cancélala y compra el plan nuevo.",
  "error.billing.noLicense": "Esta cuenta no tiene licencia.",
  "error.billing.invalidRequest": "La solicitud de facturación no es válida.",
  "error.billing.invalidResponse": "La respuesta de facturación no es válida.",
  "error.billing.notStripePage": "La página de facturación no es una página de Stripe.",
} as const satisfies PartialTranslation<typeof source>;
