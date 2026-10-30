import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Écrire {path}, hors de l’espace de travail de l’agent, du dossier partagé et des dossiers temporaires.",
  "status.agent.contextCleared": "Contexte effacé. Une nouvelle discussion commence ici.",
  "status.agent.modelSwitchedForLimit": "Limite d’utilisation atteinte. Passage à {model}.",
  "status.agent.modelReturnedAfterLimit": "Limite d’utilisation terminée. Retour à {model}.",
  "status.agent.modelSwitchedForError": "Erreur du fournisseur. Passage à {model}.",
  "status.agent.modelReturnedAfterError": "Retour à {model} après l’erreur du fournisseur.",
  "status.agent.marketplaceSuggested": "Application de la Marketplace suggérée : {app}.",
  "status.agent.channelMemberAdded": "{agent} a ajouté {member} au canal. {person} l’a demandé.",
  "status.agent.channelMemberRemoved": "{agent} a retiré {member} du canal. {person} l’a demandé.",
  "status.agent.channelInstructionsChanged": "{agent} a modifié les instructions du canal. {person} l’a demandé.",
  "status.agent.channelRoutineCreated": "{agent} a créé la routine {routine}. {person} l’a demandé.",
  "status.agent.channelRoutineUpdated": "{agent} a modifié la routine {routine}. {person} l’a demandé.",
  "status.agent.channelRoutineDeleted": "{agent} a supprimé la routine {routine}. {person} l’a demandé.",
  "status.agent.screenCaptureScreen": "Capturer l’écran principal et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureChannel":
    "L’image s’affiche dans le canal {channel}, et chaque membre de ce serveur qui lit le canal peut la voir.",
  "status.agent.screenCaptureDisplay": "Capturer l’écran {name} et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureWindow": "Capturer la fenêtre {name} et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureRegion":
    "Capturer la zone de l’écran à {x}, {y}, {width} × {height} points et envoyer l’image au modèle de l’agent.",
  "status.agent.screenCaptureProgress": "Demande de capture d’écran…",
  "status.agent.screenCaptureReviewing": "Analyse de la capture d’écran…",
  "status.agent.browserOpening": "Ouverture d’une page web…",
  "status.agent.browserReading": "Lecture de la page web…",
  "status.agent.browserClicking": "Clic sur la page web…",
  "status.agent.browserTyping": "Saisie sur la page web…",
  "status.agent.browserActing": "Utilisation de la page web…",
  "status.agent.browserReviewing": "Analyse de la page web…",
  "status.agent.memoriesSearching": "Recherche dans ses souvenirs…",
  "status.agent.memoriesSearched": {
    one: "Souvenirs consultés : {count} trouvé",
    other: "Souvenirs consultés : {count} trouvés",
  },
  "status.agent.memoriesUpdating": "Mise à jour de ses souvenirs…",
  "status.agent.skillUsing": "Utilisation de la compétence {name}…",
  "status.agent.skillReading": "Lecture d’une compétence…",
  "status.agent.memoryChanges": "Souvenirs : {saved} enregistrés, {updated} mis à jour, {forgotten} oubliés.",
  "status.agent.memoryChangesWithConflicts":
    "Souvenirs : {saved} enregistrés, {updated} mis à jour, {forgotten} oubliés, {notChanged} non modifiés, car un autre fil les a modifiés avant.",
  "status.agent.planContinues": "Le plan a des étapes en cours. L’agent continue ({current} sur {limit}).",
} as const satisfies PartialTranslation<typeof source>;
