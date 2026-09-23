import type { Translation } from "../message";
import type { AppMessages } from "./en";

/**
 * French. Written from the English source: read it as a complete first draft, not as final copy.
 *
 * Notes for a reviewer. The English source addresses the user directly, so the text uses the
 * vouvoiement (vous) throughout and never the familiar tu. Typography follows French convention:
 * a narrow no-break space is not used here, but the ellipsis is the single character … and the
 * apostrophe is the typographic ’ used by the other catalogs. Product names stay in Latin script:
 * OpenBot is the application name, and ZIP and JSON are the file formats a picker shows.
 */
export const fr = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "Arrêter tous les agents",
  "menu.checkForUpdates": "Rechercher des mises à jour…",
  "menu.preferences": "Réglages…",

  // Desktop notifications, raised by the main process while the window may be closed.
  "notification.needsInput": "Nécessite votre réponse.",
  "notification.needsApproval": "Nécessite votre approbation.",
  "notification.finished": "Travail terminé.",
  "notification.failed": "Arrêté à cause d’une erreur.",
  "notification.test": "Les notifications fonctionnent.",
  "notification.welcome": "OpenBot vous préviendra ici quand un agent aura besoin de vous.",

  // Native file pickers.
  "dialog.chooseSiteDirectory": "Choisir un dossier de site statique",
  "dialog.chooseSkill": "Choisir un dossier ou un fichier ZIP de compétence",
  "dialog.filter.skillPackages": "Paquets de compétences",
  "dialog.filter.images": "Images",
  "dialog.filter.supportedFiles": "Fichiers pris en charge",
  "dialog.filter.attachment": "Pièce jointe",
  "dialog.filter.zipArchive": "Archive ZIP",
  "dialog.filter.jsonDocument": "Document JSON",

  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot n’a pas pu démarrer",
  "startup.failedBody":
    "{message}\n\nVos données locales n’ont pas été réinitialisées ni écrasées. Consultez le guide de dépannage pour savoir comment récupérer la situation.",

  // Updater state the user reads.
  "update.unsupported": "Les mises à jour sont disponibles dans les versions installées de l’application de bureau.",
  "update.notReady": "Une mise à jour n’est pas prête à être installée.",
  "update.restartFailed": "OpenBot n’a pas pu redémarrer pour installer la mise à jour.",
  "update.downloadStalled": "Le téléchargement de la mise à jour ne répond plus. Réessayez.",
  "update.installFailed": "Impossible d’installer la mise à jour. Quittez puis rouvrez OpenBot, et réessayez.",
  "update.downloadFailed": "Impossible de télécharger la mise à jour. Réessayez.",
  "update.checkFailed": "Impossible de rechercher des mises à jour. Réessayez.",
  "update.checkStalled": "La recherche de mise à jour ne répond plus. Réessayez.",
  "update.checkOffline":
    "Impossible de joindre le service de mise à jour. Vérifiez votre connexion Internet, puis réessayez.",
  "update.checkUnavailable":
    "Le service de mise à jour n’a pas répondu. OpenBot réessaiera de lui-même dans quelques minutes.",
  "update.checkNoRelease":
    "Aucune mise à jour publiée n’a été trouvée pour cette plateforme. OpenBot réessaiera de lui-même dans quelques minutes.",

  // The language setting itself.
  "settings.language.title": "Langue",
  "settings.language.description": "OpenBot affiche les menus, les boutons et les messages dans cette langue.",
  "settings.language.system": "Langue du système",
  // The Settings window, General tab.
  "settings.providers.title": "Fournisseurs d’IA",
  "settings.appBehavior.title": "Comportement de l’application",
  "settings.launchAtLogin.title": "Lancer OpenBot à l’ouverture de session",
  "settings.launchAtLogin.description": "Ouvrir l’application lorsque vous vous connectez à cet ordinateur.",
  "settings.keepRunning.title": "Garder OpenBot actif en arrière-plan",
  "settings.keepRunning.description": "Poursuivre les tâches en cours après la fermeture de la fenêtre.",
  "settings.workspace.title": "Espace de travail",
  "settings.restoreWorkspace.title": "Restaurer le dernier espace de travail au lancement",
  "settings.restoreWorkspace.description": "Rouvrir l’espace de travail et les tâches de votre session précédente.",
  "settings.externalLinks.title": "Ouvrir les liens externes dans",
  "settings.externalLinks.description": "Choisir où s’ouvrent les liens provenant des conversations.",
  // The two link targets. The saved value stays in English; only the label is translated.
  "settings.externalLinks.defaultBrowser": "Navigateur par défaut",
  "settings.externalLinks.openbot": "OpenBot",
  "settings.autonomy.title": "Autonomie de l’agent",
  "settings.turbo.title": "Mode Turbo",
  "settings.turbo.description":
    "Autoriser chaque agent à exécuter des commandes, modifier des fichiers, élargir son propre accès au système de fichiers et au réseau, et publier, mettre à jour ou supprimer des sites publics sans demander.",
  "settings.turbo.confirmTitle": "Activer le mode Turbo ?",
  "settings.turbo.confirmDescription":
    "Les agents exécuteront des commandes, modifieront des fichiers, élargiront leur propre accès sur cet ordinateur, et publieront, mettront à jour ou supprimeront des sites publics sans vous demander d’abord. Vous pouvez le désactiver ici à tout moment.",
  "settings.turbo.confirmCancel": "Annuler",
  "settings.turbo.confirmAccept": "Activer",
  "settings.autoApprove.revokeFailed":
    "Impossible de révoquer l’approbation permanente pour {name}. Elle est toujours active. Réessayez.",
  "settings.notifications.title": "Notifications",
  "settings.desktopNotifications.title": "Notifications du bureau",
  "settings.desktopNotifications.description": "Afficher une notification lorsqu’un agent a besoin d’attention.",
  "settings.testNotification.title": "Notification de test",
  "settings.testNotification.description":
    "En afficher une maintenant. Si elle n’apparaît pas, autorisez les notifications d’OpenBot dans les réglages du système.",
  "settings.testNotification.action": "Envoyer un test",
  "settings.testNotification.failed": "Impossible d’afficher une notification.",
  "settings.testNotification.openSettings": "Ouvrir les réglages du système",
  "settings.testNotification.openSettingsFailed": "Impossible d’ouvrir les réglages du système.",
  "settings.taskSound.title": "Émettre un son à la fin d’une tâche",
  "settings.taskSound.description": "Utiliser un son court pour les tâches terminées.",
  "settings.notch.title": "Comportement",
  "settings.notch.show.title": "Afficher l’état dans l’encoche du MacBook",
  "settings.notch.show.description":
    "Afficher l’activité des agents et les éléments nécessitant votre attention en haut de chaque écran.",
  "settings.notch.idle.title": "Afficher l’îlot au repos",
  "settings.notch.idle.description": "Afficher le logo OpenBot et un message d’accueil lorsqu’aucun état n’est actif.",
  "settings.notch.displays.title": "Afficher sur les écrans supplémentaires",
  "settings.notch.displays.description": "Afficher l’îlot dynamique sur les écrans externes connectés.",
  "settings.notch.haptics.title": "Retour haptique",
  "settings.notch.haptics.description":
    "Utiliser le trackpad Force Touch pour confirmer les interactions avec l’îlot dynamique.",
  "settings.notch.size.title": "Taille",
  "settings.notch.size.description": "Sur un écran avec encoche, l’îlot n’est jamais plus petit que l’encoche.",
  "settings.notch.size.reset": "Rétablir la valeur par défaut",
  "settings.notch.size.width": "Largeur",
  "settings.notch.size.height": "Hauteur",
  "settings.notch.size.previewNotch": "Écran intégré",
  "settings.notch.size.previewIsland": "Écran externe",
  "settings.privacy.title": "Confidentialité",
  "settings.analytics.title": "Partager les données analytiques du produit",
  "settings.analytics.description":
    "Envoyer des métadonnées d’utilisation et de fiabilité, avec l’identifiant et l’e-mail de votre compte, aux services analytiques auto-hébergés d’OpenBot.",
  // The Settings window shell: its tab list, headers and save bar.
  "settings.tab.general.title": "Général",
  "settings.tab.general.description": "Contrôler le comportement d’OpenBot sur cet ordinateur.",
  "settings.tab.computerUse.title": "Utilisation de l’ordinateur",
  "settings.tab.computerUse.description":
    "Autoriser OpenBot à voir et à interagir avec les applications de cet ordinateur.",
  "settings.tab.profile.title": "Profil",
  "settings.tab.profile.description": "Gérer votre apparence dans OpenBot.",
  "settings.tab.mobileConnect.title": "Connexion mobile",
  "settings.tab.mobileConnect.description": "Se connecter en toute sécurité depuis votre téléphone.",
  "settings.tab.dynamicIsland.title": "Îlot dynamique",
  "settings.tab.dynamicIsland.description": "Choisir quand l’îlot s’affiche et sa taille.",
  "settings.tab.updates.title": "Mises à jour",
  "settings.tab.updates.description": "Garder OpenBot à jour sur cet ordinateur.",
  "settings.tab.hostedSites.title": "Sites hébergés",
  "settings.tab.hostedSites.description": "Consulter et gérer les sites statiques publiés par vos agents.",
  "settings.sections.label": "Sections des réglages",
  "settings.save.region": "Modifications non enregistrées",
  "settings.save.notSaved": "Modifications non enregistrées",
  "settings.save.reset": "Réinitialiser",
  "settings.save.saving": "Enregistrement…",
  "settings.save.save": "Enregistrer",
  // The provider list, shown in Settings and during onboarding.
  "provider.availableHere": "Disponible sur cet ordinateur",
  "provider.custom.name": "Fournisseur personnalisé",
  "provider.custom.description": "Votre propre point de terminaison de modèle",
  "provider.custom.addLabel": "Ajouter un fournisseur personnalisé",
  "provider.custom.installLabel": "Installer un fournisseur personnalisé",
  "provider.endpointCount": { one: "{count} point de terminaison", other: "{count} points de terminaison" },
  "provider.manageEndpoints": {
    one: "Gérer {count} point de terminaison",
    other: "Gérer {count} points de terminaison",
  },
  "provider.refresh": "Actualiser",
  "provider.refreshLabel": "Actualiser les fournisseurs",
  "provider.refreshingLabel": "Vérification des fournisseurs",
  "provider.refreshing": "Vérification…",

  // What a provider row reports about itself. A percentage while downloading is a number, not a
  // message, so it has no key.
  "provider.status.connecting": "Connexion",
  "provider.status.updateAvailable": "Mise à jour disponible",
  "provider.status.settingUp": "Configuration",
  "provider.status.downloadFailed": "Échec du téléchargement",
  "provider.status.connected": "Connecté",
  "provider.status.notDownloaded": "Non téléchargé",
  "provider.status.ready": "Prêt",
  "provider.status.notConnected": "Non connecté",
  "provider.status.notInstalled": "Non installé",
  "provider.status.updateRequired": "Mise à jour requise",
  "provider.status.unavailable": "Indisponible",
  "provider.status.checking": "Vérification",

  // Which account tier the OpenCode row runs on. It shows only while it adds to the runtime
  // badge: a saved key leaves the runtime "Connected" to speak for the row.
  "provider.key.free": "Gratuit",

  // The buttons on a provider row, and the name a screen reader reads for each. The name repeats
  // the provider, because a list of rows all saying "Connect" tells a screen reader user nothing.
  "provider.action.download": "Télécharger",
  "provider.action.cancel": "Annuler",
  "provider.action.connect": "Se connecter",
  "provider.action.reconnect": "Se reconnecter",
  "provider.action.restart": "Redémarrer",
  "provider.action.retry": "Réessayer",
  "provider.action.updateTo": "Mettre à jour vers {version}",
  "provider.action.checkForUpdates": "Rechercher des mises à jour",
  "provider.action.install": "Installer",
  "provider.action.signIn": "Se connecter",
  "provider.action.signInWithCode": "Se connecter avec un code",
  "provider.action.add": "Ajouter",
  "provider.aria.download": "Télécharger {name}",
  "provider.aria.cancel": "Annuler {name}",
  "provider.aria.connect": "Connecter {name}",
  "provider.aria.reconnect": "Reconnecter {name}",
  "provider.aria.restart": "Redémarrer {name}",
  "provider.aria.retry": "Réessayer {name}",
  "provider.aria.install": "Installer {name}",
  "provider.aria.signIn": "Se connecter à {name}",
  "provider.aria.moreActions": "Autres actions pour {name}",
  "provider.aria.signInWithCode": "Se connecter à {name} avec un code sur un autre appareil",
} as const satisfies Translation<AppMessages>;
