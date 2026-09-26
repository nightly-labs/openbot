import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable":
    "OpenBot n’a pas pu joindre le service de compte. Vérifiez que l’API fonctionne, puis réessayez.",
  "error.auth.signInFirst": "Connectez-vous d’abord à OpenBot.",
  "error.auth.signInRequired": "Une connexion est requise.",
  "error.auth.accountChangedDuringRegister": "Le compte connecté a changé pendant l’enregistrement de ce serveur.",
  "error.auth.hostCredentialUnavailable":
    "L’identifiant de l’hôte distant n’est pas disponible. Enregistrez à nouveau l’hôte.",
  "error.auth.codeNotVerified": "Impossible de vérifier le code de connexion.",
  "error.auth.serviceError": "Le service de compte a renvoyé une erreur.",
  "error.auth.codeNotSent": "OpenBot n’a pas pu envoyer le code de connexion.",
  "error.auth.deliveryTimeout":
    "OpenBot n’a pas pu confirmer l’envoi à temps. Le code peut encore arriver ; vérifiez sa réception avant de le renvoyer.",
  "error.auth.deliveryInterrupted":
    "La connexion s’est terminée avant qu’OpenBot confirme l’envoi. Vérifiez la réception pour ne pas envoyer un autre code.",
  "error.auth.deliveryUnknown":
    "OpenBot n’a pas pu confirmer si le code de connexion a été envoyé. Vérifiez sa réception avant de le renvoyer.",
} as const satisfies PartialTranslation<typeof source>;
