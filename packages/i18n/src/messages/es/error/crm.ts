import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Este servidor no admite el CRM. Actualiza OpenBot en el ordenador que lo ejecuta.",
  "error.crm.tooLargeToSend": "Esta página del CRM es demasiado grande para enviarla a esta aplicación.",
  "error.crm.customerMissing": "Este cliente ya no existe.",
  "error.crm.planMissing": "Este plan ya no existe.",
  "error.crm.paymentMissing": "Este pago ya no existe.",
  "error.crm.tagMissing": "Esta etiqueta ya no existe.",
  "error.crm.statusMissing": "Este estado ya no existe.",
  "error.crm.proposalMissing": "Esta sugerencia ya no existe o ya se decidió.",
  "error.crm.tagExists": "Ya existe una etiqueta con este nombre.",
  "error.crm.statusExists": "Ya existe un estado con este nombre.",
  "error.crm.builtinStatus": "No puedes renombrar ni eliminar un estado predefinido.",
  "error.crm.tooManyStatuses": "El CRM tiene el número máximo de estados. Elimina primero un estado.",
  "error.crm.tooManyTags": "El CRM tiene el número máximo de etiquetas. Elimina primero una etiqueta.",
  "error.crm.tooManyPlans": "Este cliente tiene el número máximo de planes. Elimina primero un plan.",
  "error.crm.paymentPaid": "Este pago está pagado. Márcalo primero como no pagado.",
  "error.crm.splitTotal": "Las partes deben sumar el importe del pago.",
  "error.crm.planEndsBeforeStart": "Un plan no puede terminar antes de empezar.",
  "error.crm.currencyInUse": "No puedes cambiar la moneda de un cliente que tiene planes o pagos.",
  "error.crm.badCursor": "Esta página ya no es válida. Vuelve a cargar la lista.",
  "error.crm.invalidChange": "Este cambio no es válido.",
  "error.crm.agentNotAllowed":
    "Este agente no puede usar el CRM. Un propietario o administrador puede darle acceso: abre la página del CRM, haz clic en Sugerencias, haz clic en el botón con el número de agentes y activa este agente.",
  "error.crm.tooManyProposals":
    "Hay demasiadas sugerencias pendientes de decisión. Espera a que una persona las decida.",
  "error.crm.amountInvalid": "Escribe el importe como un número, por ejemplo 129.00.",
  "error.crm.amountDecimals": "El importe tiene demasiados decimales para {currency}.",
  "error.crm.fieldPrivate": "Este campo es privado. Los agentes no pueden leerlo ni filtrar por él.",
  "error.crm.sourceOwned":
    "Stripe gestiona esta fila. Cámbiala en Stripe; el CRM recibirá el cambio en la próxima sincronización.",
  "error.crm.sourceConnected": "Stripe ya está conectado a este CRM.",
  "error.crm.sourceMissing": "Esta conexión de Stripe ya no existe.",
  "error.crm.sourceSecretKey":
    "Esta es una clave secreta, que puede modificar tu cuenta de Stripe. Crea una clave restringida solo con acceso de lectura.",
  "error.crm.sourceInvalidKey": "Stripe no acepta esta clave. Copia otra vez la clave restringida.",
  "error.crm.sourcePermission":
    "Esta clave no puede leer clientes, facturas, suscripciones, eventos ni productos. Dale acceso de lectura a todos.",
  "error.crm.sourceRateLimited": "Stripe recibió demasiadas solicitudes. Inténtalo de nuevo en un minuto.",
  "error.crm.sourceNetwork": "OpenBot no puede conectarse a Stripe. Comprueba la conexión a internet.",
  "error.crm.sourceFailed": "Stripe envió una respuesta que OpenBot no puede leer. Inténtalo de nuevo más tarde.",
  "error.crm.sourceKeySaveFailed": "OpenBot no puede guardar la clave de Stripe en este equipo.",
  "error.crm.off":
    "El CRM está desactivado. Un propietario o administrador puede activarlo en Ajustes del servidor > Experimental.",
  "error.crm.settingsSaveFailed": "OpenBot no puede guardar el ajuste del CRM en este servidor.",
} as const satisfies PartialTranslation<typeof source>;
