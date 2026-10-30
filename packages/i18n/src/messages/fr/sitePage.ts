import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Impossible de charger cette page",
  "sitePage.error.body":
    "Vérifiez votre connexion et rechargez la page. Si elle ne se charge toujours pas, revenez à la page d’accueil.",
  "sitePage.error.reload": "Recharger la page",
  "sitePage.error.home": "Retour à l’accueil",
  "sitePage.join.title": "Rejoindre un serveur OpenBot",
  "sitePage.join.description": "Ouvrez une invitation privée à un serveur dans OpenBot.",
  "sitePage.join.eyebrow": "Invitation privée",
  "sitePage.join.intro":
    "Ouvrez cette invitation dans OpenBot. L’app vérifie le serveur et vous demande de confirmer avant de se connecter.",
  "sitePage.join.invalid":
    "Ce lien d’invitation n’est pas valide ou est incomplet. Demandez une nouvelle invitation au propriétaire du serveur.",
  "sitePage.join.open": "Ouvrir OpenBot",
  "sitePage.join.browser": "Ouvrir dans le navigateur",
  "sitePage.join.download": "Télécharger OpenBot",
  "sitePage.join.notOpened":
    "Si OpenBot ne s’est pas ouvert, installez-le avec {download}, ou lancez OpenBot une fois pour qu’il puisse ouvrir les liens d’invitation. Vous pouvez aussi utiliser {browser}.",
  "sitePage.join.mobile":
    "Si OpenBot est installé, touchez {open}. Vous pouvez aussi coller ce lien dans Ajouter un serveur dans l’app.",
  "sitePage.join.singleUse":
    "Un lien à usage unique fonctionne une fois puis expire. Un lien permanent fonctionne jusqu’à ce que le propriétaire le révoque. OpenBot affiche l’expiration avant que vous ne rejoigniez.",
  "sitePage.join.email": "Si l’invitation est arrivée par e-mail, connectez-vous à OpenBot avec cette adresse e-mail.",
  "sitePage.join.share":
    "Ce lien donne accès à un serveur. Partagez-le uniquement avec les personnes que vous voulez inviter.",
  "sitePage.connect.title": "Revenir à OpenBot",
  "sitePage.connect.failedTitle": "La connexion n’a pas abouti",
  "sitePage.connect.openApp": "Ouvrir OpenBot",
  "sitePage.connect.tryAgainApp": "Réessayer dans OpenBot",
  "sitePage.connect.tryAgainBrowser": "Réessayer dans le navigateur",
  "sitePage.connect.doneInWebClient":
    "Votre onglet OpenBot termine la connexion à {name}. Vous pouvez fermer cet onglet.",
  "sitePage.connect.doneInApp": "OpenBot termine la connexion à {name} sur votre ordinateur.",
  "sitePage.connect.failure.cancelled": "La connexion à {name} a été annulée. Rien n’a changé.",
  "sitePage.connect.failure.expired": "La connexion à {name} a expiré. Relancez la connexion.",
  "sitePage.connect.failure.exchange": "{name} n’a pas confirmé la connexion. Réessayez.",
  "sitePage.connect.failure.enterprise": "Connectez un espace de travail Slack, pas une organisation entière.",
  "sitePage.connect.failure.takenSlack":
    "Un autre serveur OpenBot répond déjà dans cet espace de travail Slack. Déconnectez-le sur ce serveur, puis réessayez.",
  "sitePage.connect.failure.takenDiscord":
    "Un autre serveur OpenBot répond déjà sur ce serveur Discord. Déconnectez-le sur ce serveur, puis réessayez.",
  "sitePage.connect.failure.unavailable":
    "OpenBot ne peut pas se connecter à {name} pour le moment. Réessayez plus tard.",
  "sitePage.connect.failure.tabClosed":
    "L’onglet OpenBot qui a lancé la connexion à {name} n’a pas répondu. Ouvrez OpenBot dans votre navigateur et connectez de nouveau {name}.",
  "sitePage.connect.failure.failed": "{name} n’a pas terminé la connexion. Réessayez.",
  "sitePage.connect.restartHint":
    "Dans OpenBot, ouvrez {marketplace}, puis {apps}, puis {name}, et sélectionnez {connect}.",
  "sitePage.connect.notOpened":
    "Lancez OpenBot, puis réessayez. Si OpenBot n’est pas sur cet ordinateur, téléchargez-le et connectez {name} depuis l’app.",
  "sitePage.openApp.title": "Rien ne s’est ouvert ?",
  "sitePage.openApp.dismiss": "Plus tard",
  "sitePage.billing.pageTitle": "Facturation OpenBot",
  "sitePage.billing.updatedTitle": "Facturation mise à jour",
  "sitePage.billing.updatedBody": "Revenez à OpenBot. Vous pouvez fermer cette page.",
  "sitePage.billing.cancelledTitle": "Paiement annulé",
  "sitePage.billing.cancelledBody": "Rien n’a été facturé. Revenez à OpenBot.",
  "sitePage.report.pageTitle": "Signaler un site hébergé — OpenBot",
  "sitePage.report.title": "Signaler un site hébergé",
  "sitePage.report.intro": "Envoyez un signalement sur un contenu nuisible ou illégal à une adresse openbot.site.",
  "sitePage.report.hostnameLabel": "Adresse du site",
  "sitePage.report.hostnameMissing": "Saisissez l’adresse du site",
  "sitePage.report.reasonLabel": "Motif",
  "sitePage.report.reason.phishing": "Hameçonnage",
  "sitePage.report.reason.malware": "Logiciel malveillant",
  "sitePage.report.reason.abuse": "Abus",
  "sitePage.report.reason.copyright": "Droit d’auteur",
  "sitePage.report.reason.other": "Autre",
  "sitePage.report.detailsLabel": "Détails",
  "sitePage.report.optional": "Facultatif",
  "sitePage.report.detailsPlaceholder": "Quel est le problème avec ce site ?",
  "sitePage.report.send": "Envoyer",
  "sitePage.report.sending": "Envoi…",
  "sitePage.report.tooMany": "Trop de signalements. Réessayez plus tard.",
  "sitePage.report.sendFailed": "Impossible d’envoyer le signalement. Réessayez.",
  "sitePage.report.writeTo": "Vous pouvez aussi écrire à {email}.",
  "sitePage.report.sentTitle": "Signalement envoyé",
  "sitePage.report.sentBody": "Merci. Nous avons reçu votre signalement.",
  "sitePage.report.home": "Aller à la page d’accueil",
  "sitePage.pricing.title": "Tarifs d’OpenBot",
  "sitePage.pricing.description":
    "Des serveurs hébergés et une licence pour les équipes. OpenBot est gratuit pour un usage personnel sur votre propre ordinateur.",
  "sitePage.pricing.heading": "Tarifs",
  "sitePage.pricing.enterprise.title": "Entreprise",
  "sitePage.pricing.enterprise.body":
    "Des serveurs plus grands, plus de {count} membres ou tout autre besoin. Avec un support entreprise.",
  "sitePage.pricing.enterprise.contact": "Contacter les ventes",
} as const satisfies PartialTranslation<typeof source>;
