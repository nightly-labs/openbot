import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld":
    "Ce serveur ne prend pas en charge le CRM. Mettez à jour OpenBot sur l’ordinateur qui l’exécute.",
  "error.crm.tooLargeToSend": "Cette page du CRM est trop volumineuse pour être envoyée à cette application.",
  "error.crm.customerMissing": "Ce client n’existe plus.",
  "error.crm.planMissing": "Cette offre n’existe plus.",
  "error.crm.paymentMissing": "Ce paiement n’existe plus.",
  "error.crm.tagMissing": "Cette étiquette n’existe plus.",
  "error.crm.statusMissing": "Ce statut n’existe plus.",
  "error.crm.proposalMissing": "Cette suggestion n’existe plus ou a déjà été traitée.",
  "error.crm.tagExists": "Une étiquette porte déjà ce nom.",
  "error.crm.statusExists": "Un statut porte déjà ce nom.",
  "error.crm.builtinStatus": "Vous ne pouvez pas renommer ni supprimer un statut intégré.",
  "error.crm.tooManyStatuses": "Le CRM a atteint le nombre maximal de statuts. Supprimez d’abord un statut.",
  "error.crm.tooManyTags": "Le CRM a atteint le nombre maximal d’étiquettes. Supprimez d’abord une étiquette.",
  "error.crm.tooManyPlans": "Ce client a atteint le nombre maximal d’offres. Supprimez d’abord une offre.",
  "error.crm.paymentPaid": "Ce paiement est marqué comme payé. Marquez-le d’abord comme non payé.",
  "error.crm.splitTotal": "La somme des parts doit être égale au montant du paiement.",
  "error.crm.planEndsBeforeStart": "Une offre ne peut pas se terminer avant de commencer.",
  "error.crm.currencyInUse": "Vous ne pouvez pas changer la devise d’un client qui a des offres ou des paiements.",
  "error.crm.badCursor": "Cette page n’est plus valide. Rechargez la liste.",
  "error.crm.invalidChange": "Cette modification n’est pas valide.",
  "error.crm.agentNotAllowed":
    "Cet agent ne peut pas utiliser le CRM. Un propriétaire ou un admin peut l’autoriser : ouvrez la page CRM, cliquez sur Suggestions, cliquez sur le bouton qui indique le nombre d’agents, puis activez cet agent.",
  "error.crm.tooManyProposals": "Trop de suggestions attendent une décision. Attendez qu’une personne les traite.",
  "error.crm.amountInvalid": "Saisissez le montant sous forme de nombre, par exemple 129.00.",
  "error.crm.amountDecimals": "Le montant a trop de décimales pour {currency}.",
  "error.crm.fieldPrivate": "Ce champ est privé. Les agents ne peuvent pas le lire ni filtrer par ce champ.",
  "error.crm.sourceOwned":
    "Stripe gère cette ligne. Modifiez-la dans Stripe ; le CRM reçoit la modification à la prochaine synchronisation.",
  "error.crm.sourceConnected": "Stripe est déjà connecté à ce CRM.",
  "error.crm.sourceMissing": "Cette connexion Stripe n'existe plus.",
  "error.crm.sourceSecretKey":
    "Il s'agit d'une clé secrète, qui peut modifier votre compte Stripe. Créez une clé restreinte avec un accès en lecture seule.",
  "error.crm.sourceInvalidKey": "Stripe n'accepte pas cette clé. Copiez à nouveau la clé restreinte.",
  "error.crm.sourcePermission":
    "Cette clé ne peut pas lire les clients, les factures, les abonnements, les événements ni les produits. Donnez-lui l'accès en lecture.",
  "error.crm.sourceRateLimited": "Stripe a reçu trop de requêtes. Réessayez dans une minute.",
  "error.crm.sourceNetwork": "OpenBot ne peut pas se connecter à Stripe. Vérifiez la connexion internet.",
  "error.crm.sourceFailed": "Stripe a envoyé une réponse qu'OpenBot ne peut pas lire. Réessayez plus tard.",
  "error.crm.sourceKeySaveFailed": "OpenBot ne peut pas enregistrer la clé Stripe sur cet ordinateur.",
  "error.crm.off":
    "Le CRM est désactivé. Un propriétaire ou un administrateur peut l’activer dans Réglages du serveur > Expérimental.",
  "error.crm.settingsSaveFailed": "OpenBot ne peut pas enregistrer le réglage du CRM sur ce serveur.",
} as const satisfies PartialTranslation<typeof source>;
