import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "L’offre du serveur n’a pas pu être modifiée. Actualisez « Facturation » et réessayez.",
  "error.billing.confirmMismatch": "Saisissez le nom du serveur pour le supprimer.",
  "error.billing.restartBusy": "Le serveur ne peut pas redémarrer maintenant. Réessayez dans une minute.",
  "error.billing.planRequired": "L’offre de ce serveur a pris fin. Renouvelez-la pour démarrer le serveur.",
  "error.billing.planSoldOut": "Cette offre est épuisée. Choisissez une autre offre.",
  // Billing errors.
  "error.billing.licenseExists": "Ce compte a déjà une licence. Modifiez plutôt son nombre d'utilisateurs.",
  "error.billing.licenseCurrency": "La licence doit utiliser la devise de vos autres forfaits.",
  "error.billing.planCurrency": "Un nouveau forfait doit utiliser la devise de vos autres forfaits.",
  "error.billing.licenseUsersInUse":
    "La licence ne peut pas avoir moins d'utilisateurs que les personnes qui l'utilisent maintenant.",
  "error.billing.licensePaymentFailed":
    "Le paiement des utilisateurs ajoutés a échoué. Mettez à jour le moyen de paiement et réessayez.",
  "error.billing.licenseUnavailable": "Les licences ne sont pas disponibles pour le moment.",
  "error.billing.licenseOneUser":
    "Cette licence est prévue pour 1 utilisateur. Passez à Team pour ajouter des utilisateurs.",
  "error.billing.licensePlanChange":
    "Cette licence ne peut pas passer à cette offre. Résiliez-la et achetez la nouvelle offre.",
  "error.billing.noLicense": "Ce compte n'a pas de licence.",
  "error.billing.invalidRequest": "La demande de facturation n’est pas valide.",
  "error.billing.invalidResponse": "La réponse de facturation n’est pas valide.",
  "error.billing.notStripePage": "La page de facturation n’est pas une page Stripe.",
} as const satisfies PartialTranslation<typeof source>;
