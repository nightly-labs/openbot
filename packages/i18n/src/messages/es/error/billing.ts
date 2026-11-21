import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "No se pudo cambiar el plan del servidor. Actualiza Facturación e inténtalo de nuevo.",
  "error.billing.confirmMismatch": "Escribe el nombre del servidor para eliminarlo.",
  "error.billing.restartBusy": "El servidor no puede reiniciarse ahora. Inténtalo de nuevo en un minuto.",
  "error.billing.restartUnavailable": "Este servidor no puede reiniciarse desde aquí. Contacta con soporte.",
  "error.billing.planRequired": "El plan de este servidor terminó. Renuévalo para iniciar el servidor.",
  "error.billing.planSoldOut": "Este plan está agotado. Elige otro plan.",
  "error.billing.storageUnavailable": "Este almacenamiento no está disponible para este servidor.",
  "error.billing.storagePaymentFailed":
    "El pago del almacenamiento falló. Actualiza el método de pago e inténtalo de nuevo.",
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
  "error.billing.countryRequired":
    "Indica tu país de facturación antes de pagar. Actualiza OpenBot para hacerlo y vuelve a intentarlo.",
  "error.billing.detailsInvalid": "Revisa el país y el NIF-IVA. El NIF-IVA debe ser del país elegido.",
  "error.billing.vatIdInvalid":
    "El sistema de IVA de la UE no reconoce este NIF-IVA. Revisa el número o continúa sin NIF-IVA.",
  "error.billing.vatIdUnverified":
    "El sistema de IVA de la UE no puede comprobar el NIF-IVA ahora. Inténtalo más tarde o continúa sin NIF-IVA.",
  "error.billing.vatUnavailable": "El pago no está disponible ahora. Inténtalo más tarde.",
  "error.billing.invalidRequest": "La solicitud de facturación no es válida.",
  "error.billing.invalidResponse": "La respuesta de facturación no es válida.",
  "error.billing.notStripePage": "La página de facturación no es una página de Stripe.",
  "error.billing.customServerOfferMissing": "Este servidor no tiene un plan que pagar.",
} as const satisfies PartialTranslation<typeof source>;
