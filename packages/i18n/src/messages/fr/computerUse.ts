import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Enregistrement de l’écran",
  "computerUse.permission.screenRecording.description": "Permet à OpenBot de voir les fenêtres des apps.",
  "computerUse.permission.screenRecording.pane": "Enregistrement de l’écran et de l’audio du système",
  "computerUse.permission.accessibility.title": "Accessibilité",
  "computerUse.permission.accessibility.description": "Permet à OpenBot de cliquer et de saisir du texte.",
  "computerUse.permission.accessibility.pane": "Accessibilité",
  "computerUse.error.check": "OpenBot n’a pas pu vérifier Computer Use.",
  "computerUse.error.openSettings": "OpenBot n’a pas pu ouvrir Réglages Système.",
  "computerUse.error.startDriver": "OpenBot n’a pas pu démarrer le pilote de Computer Use.",
  "computerUse.checkAgain": "Revérifier",
  "computerUse.checking": "Vérification de Computer Use",
  "computerUse.unavailable.title": "Computer Use n’est pas encore disponible",
  "computerUse.permissions.title": "Autorisations du système",
  "computerUse.permissions.description": "macOS gère les autorisations.",
  "computerUse.ready.title": "Computer Use est prêt",
  "computerUse.ready.description":
    "OpenBot peut voir les apps de cet ordinateur et interagir avec elles. Ce système ne demande aucune autorisation supplémentaire.",
  "computerUse.limited.title": "Computer Use est limité sur ce bureau",
  "computerUse.openSettingsFailed.title": "Impossible d’ouvrir Réglages Système",
  "computerUse.restartRequired.title": "Redémarrage nécessaire",
  "computerUse.restartRequired.description":
    "macOS bloque toujours les clics et la saisie. Si cela revient après un redémarrage, retirez OpenBot d’Accessibilité, puis ajoutez-le de nouveau.",
  "computerUse.restartRequired.action": "Redémarrer OpenBot",
  "computerUse.compact.title": "Activer Computer Use",
  "computerUse.compact.description":
    "Permettez à OpenBot de voir les apps de cet ordinateur et d’interagir avec elles.",
  "computerUse.granted": "Accordée",
  "computerUse.opening": "Ouverture…",
  "computerUse.manage": "Gérer",
  "computerUse.grant": "Accorder",
  "computerUse.manageLabel": "Gérer {permission}",
  "computerUse.grantLabel": "Accorder {permission}",
  "computerUse.help.title": "Activer {permission}",
  "computerUse.help.paneOpen": "Réglages Système est ouvert sur {pane}.",
  "computerUse.help.dragLabel":
    "Faites glisser {name} dans Réglages Système, ou appuyez pour l’afficher dans le Finder",
  "computerUse.help.dragToAdd": "Glisser pour ajouter",
  "computerUse.help.findInList": "Trouvez {name} dans la liste.",
  "computerUse.help.dragIntoList": "Faites glisser {name}.app dans la liste.",
  "computerUse.help.turnOn": "Activez l’interrupteur.",
  "computerUse.help.showInFinder": "Afficher dans le Finder",
  "computerUse.help.revealFailed": "Impossible d’afficher l’application dans le Finder.",
  "computerUse.help.dragFailed": "Impossible de faire glisser l’application.",
  "computerUse.highlight.working": "OpenBot travaille dans {title}",
} as const satisfies PartialTranslation<typeof source>;
