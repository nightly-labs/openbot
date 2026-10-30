import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Les événements ne sont pas disponibles sur cet hôte.",
  "error.backend.databaseIntegrity": "La base de données OpenBot a échoué à la vérification d’intégrité.",
  "error.backend.webhookRouteLimit": "Un hôte peut avoir au plus {limit} routines webhook.",
  "error.backend.webhookSettingsInvalid": "Vérifiez les réglages du webhook et réessayez.",
  "error.backend.webhookRouteUnavailable":
    "La route publique du webhook n’est pas prête. Vérifiez la connexion à l’hôte et réessayez.",
  "error.backend.browserViewRemoteOnly": "Une vue de navigateur en direct est réservée à un hôte distant.",
  "error.backend.browserViewUnsupported": "Cet hôte distant ne prend pas en charge la vue de navigateur en direct.",
  "error.backend.browserViewLimit": "Trop de vues de navigateur sont ouvertes sur cet hôte.",
  "error.backend.browserViewEnded": "La vue en direct de cette page est terminée.",
  "error.backend.browserViewFailed": "La vue en direct de cette page a échoué.",
  "error.backend.windowTemporarilyUnavailable": "La fenêtre OpenBot est temporairement indisponible.",
  "error.backend.windowUnavailable": "La fenêtre OpenBot est indisponible.",
  "error.backend.sunshineApiHttp": "L’API Sunshine a échoué avec HTTP {status}.",
  "error.backend.sunshinePortsUnavailable":
    "Impossible de réserver une famille de ports Sunshine libre pour le Bureau à distance.",
  "error.backend.moonlightPortsUnavailable":
    "Impossible de réserver une plage de ports WebRTC Moonlight libre pour le Bureau à distance.",
  "error.backend.iceServerNoPort": "Le serveur ICE du Bureau à distance n’a pas obtenu de port.",
  "error.backend.remoteDesktopStoppedWhileStarting":
    "L’environnement du bureau à distance a été arrêté pendant son démarrage.",
  "error.backend.sunshineNotStarted": "Sunshine n’a pas démarré sur une famille de ports réservée.",
  "error.backend.moonlightNoHost": "Moonlight n’a aucun hôte local appairé.",
  "error.backend.sunshineNoDesktop": "Sunshine n’a pas publié l’application Desktop.",
  "error.backend.sunshineAmbiguousPairing": "Sunshine a renvoyé des demandes d’appairage local ambiguës.",
  "error.backend.sunshineNoPairingRequest": "Sunshine n’a pas reçu la demande d’appairage local attendue.",
  "error.backend.moonlightPairingHttp": "L’appairage Moonlight a échoué avec HTTP {status}.",
  "error.backend.moonlightRejectedPairing": "Moonlight a refusé l’appairage avec Sunshine.",
  "error.backend.moonlightNoPin": "Moonlight n’a pas renvoyé de code PIN d’appairage.",
  "error.backend.moonlightPairingIncomplete": "L’appairage Moonlight ne s’est pas terminé.",
  "error.backend.moonlightWebNotEmbedded": "Moonlight Web n’est pas une version intégrée d’OpenBot.",
  "error.backend.moonlightEmptyResponse": "Moonlight a renvoyé une réponse vide.",
  "error.backend.remoteDesktopTimeout": "La demande de bureau à distance a expiré.",
  "error.backend.moonlightApiHttp": "L’API Moonlight a échoué avec HTTP {status}.",
  "error.backend.sunshineExited": "Sunshine s’est arrêté avant que son API HTTPS sur le port {port} soit prête.",
  "error.backend.sunshineNoAnswer": "Sunshine n’a pas répondu.",
  "error.backend.sunshineTlsUnexpected": "Sunshine a renvoyé un certificat TLS inattendu.",
  "error.backend.moonlightWebExited": "Moonlight Web s’est arrêté avant que {url} soit prêt.",
  "error.backend.moonlightWebNotReady": "Moonlight Web n’est pas devenu prêt.",
  "error.backend.channelDeleteUnsupported": "Ce serveur ne prend pas en charge la suppression de canaux.",
  "error.backend.browserNavigateUnsupported":
    "Cet hôte distant ne prend pas en charge la navigation par la barre d’adresse dans un onglet existant.",
  "error.backend.browserUserControlBusy":
    "Cet onglet du navigateur attend un secret. Répondez d’abord à la demande de secret.",
  "error.backend.browserUserControlUnsupported":
    "Cet hôte distant ne permet pas de prendre le contrôle d’un onglet du navigateur.",
  "error.backend.browserSignInUnsupported":
    "Cet hôte distant ne peut pas recevoir une connexion depuis cet ordinateur.",
  "error.backend.browserSignInOpenFailed": "OpenBot n’a pas pu ouvrir la fenêtre de connexion.",
  "error.backend.browserSignInReadFailed": "OpenBot n’a pas pu lire la connexion dans la fenêtre.",
  "error.backend.browserStopUnsupported": "Cet hôte distant ne peut pas arrêter le chargement d’une page.",
  "error.backend.sharedDataLocalOnly": "Les données partagées sont gérées sur l’ordinateur qui exécute ces agents.",
  "error.backend.browserUrlProtocol": "Seules les URL de navigateur HTTP(S) sont autorisées.",
  "error.backend.sunshineNotReady": "Sunshine n’est pas devenu prêt.",
  "error.backend.sunshineNotReadyReason": "Sunshine n’est pas devenu prêt. {reason}",
  "error.backend.channelLeadModelUnavailable": "Le modèle du responsable du canal est indisponible.",
  "error.backend.sharedDataUnavailable": "Les données partagées sont indisponibles.",
  "error.backend.shuttingDown": "OpenBot est en cours d’arrêt.",
  "error.backend.channelUnconfirmedStart":
    "Le canal a un démarrage de tâche non confirmé. Vérifiez son résultat avant de le supprimer.",
  "error.backend.channelNotFound": "Canal introuvable.",
  "error.backend.channelMemberUnavailable": "Un membre du canal est indisponible.",
  "error.backend.channelArchived": "Restaurez ce canal avant d’envoyer des messages ou de modifier des tâches.",
  "error.backend.channelReferenceUnavailable": "Le message de canal référencé est indisponible.",
  "error.backend.channelTaskNotFound": "Tâche de canal introuvable.",
  "error.backend.channelTaskComplete": "Cette tâche est déjà terminée.",
  "error.backend.channelSelectAgent": "Sélectionnez un agent.",
  "error.backend.channelLeadRequired":
    "Choisissez un responsable de canal disponible ou attribuez cette tâche à un membre.",
  "error.backend.channelRoutingTooLong":
    "Cette demande dépasse la limite de contexte de routage. Sélectionnez un membre ou envoyez une demande plus courte.",
  "error.backend.channelTaskMemberRequired": "Choisissez un membre pour cette tâche.",
  "error.backend.channelTaskStopped": "Arrêtée. Continuez ou réassignez cette tâche.",
  "error.backend.channelRoutingUnreadable":
    "Le responsable n'a pas pu acheminer ce message. Réassignez-le à un membre.",
  "error.backend.channelRoutingFailed": "Le routage a échoué. Choisissez un membre ou réessayez.",
  "error.backend.channelLeadTimedOut":
    "Le responsable du canal n'a pas répondu à temps. Choisissez un membre ou réessayez.",
  "error.backend.channelLeadFailed":
    "Le responsable du canal n'a pas pu router ce message. Choisissez un membre ou réessayez.",
  "error.backend.channelRequestMemberRequired": "Choisissez un membre pour cette demande.",
  "error.backend.channelDeliveryNotCreated": "La distribution dans le canal n’a pas été créée.",
  "error.backend.channelAssignmentStopped": "Cette tâche de canal a été arrêtée ou remplacée.",
  "error.backend.channelAssigneeUnavailable": "L’agent assigné est indisponible.",
  "error.backend.channelAssigneeRemoved": "Le membre assigné a été retiré.",
  "error.backend.channelAssigneeReassign": "Le membre assigné est indisponible. Réassignez cette tâche.",
  "error.backend.channelAssignmentChanged": "Cette tâche de canal a changé.",
  "error.backend.channelMemberRequired": "Sélectionnez un membre disponible de ce canal.",
  "error.backend.memoryEssentialBudget":
    "Les souvenirs essentiels dépassent la limite du prompt. Réglez une entrée sur « Rechercher au besoin », puis réessayez.",
  "error.backend.memorySelectionConflict": "Le souvenir a changé. Rechargez-le et réessayez.",
  "error.backend.memorySelectionUserControlled":
    "L’utilisateur contrôle la sélection de ce souvenir. Conservez le choix de l’utilisateur.",
  "error.backend.memorySearchQuery": "Saisissez un ou plusieurs mots de recherche, jusqu’à 256 caractères.",
  "error.backend.memoryOperationFailed": "L’opération sur le souvenir a échoué. Réessayez.",
  "error.backend.memoryGone": "Ce souvenir n’existe plus.",
  "error.backend.routineGone": "Cette routine n’existe plus.",
  "error.backend.turnNotStarted": "Le fournisseur n’a pas démarré ce tour.",
  "error.backend.routineResultConnectionOff":
    "Cette connexion de messagerie est désactivée ou supprimée. Choisissez un autre emplacement.",
  "error.backend.routineResultNoDelivery": "Cette exécution n’a aucune réponse à renvoyer.",
  "error.backend.channelMemoryLimit": "Un canal peut avoir jusqu’à {limit} souvenirs.",
  "error.backend.channelRoutineLimit": "Un canal peut avoir au maximum {limit} routines.",
  "error.backend.agentRoutineLimit": "Un agent peut avoir au maximum {limit} routines.",
  "error.backend.agentMemoryLimit": "Un agent peut avoir jusqu’à {limit} souvenirs.",
  "error.backend.agentMemoryLimitReached":
    "Vous avez {saved} souvenirs sur {limit}. Pour faire de la place, mettez à jour un souvenir par son memoryId avec le texte combiné de deux souvenirs liés, puis oubliez l’autre, ou oubliez un souvenir qui n’est plus vrai. Puis réessayez.",
  "error.backend.agentMemoryLimitExceeded":
    "Vous avez {saved} souvenirs, et la limite est de {limit}. L’utilisateur a fixé la limite sous le nombre de souvenirs enregistrés. N’oubliez aucun souvenir pour faire de la place. Dites à l’utilisateur que ce souvenir n’a pas été enregistré.",
  "error.backend.channelHistoryLeadRequired": "Choisissez un responsable de canal pour préparer l’historique partagé.",
  "error.backend.channelHistoryArriving":
    "Un message partagé est encore en cours de réception. Reprenez quand il sera complet.",
  "error.backend.channelHistoryInvalid": "Le résumé de l’historique n’est pas valide. Reprenez pour réessayer.",
  "error.backend.channelContextTooLong":
    "Cette tâche dépasse la limite du contexte partagé. Envoyez une demande plus courte ou réattribuez-la.",
  "error.backend.draftAttachmentLimit": "Gardez au maximum {limit} pièces jointes en brouillon.",
  "error.backend.recipientRequired": "Au moins un destinataire est requis.",
  "error.backend.recipientLimit": "Un message peut avoir au maximum {limit} destinataires.",
  "error.backend.attachmentDraftGone": "Le brouillon de pièce jointe n’existe plus : {id}",
  "error.backend.attachmentInQueueEdit": "Une pièce jointe appartient à une modification de la file d’attente.",
  "error.backend.messageEmpty": "Le message ne peut pas être vide.",
  "error.backend.attachLimit": "Joignez au maximum {limit} fichiers.",
  "error.backend.queuedMessageNotFound": "Message en file d’attente introuvable.",
  "error.backend.cancelQueuedOnly": "Seuls les messages en file d’attente peuvent être annulés.",
  "error.backend.messageBeingEdited":
    "Ce message est en cours de modification. Enregistrez ou annulez d’abord la modification.",
  "error.backend.queuedMessageUnavailable": "Ce message en file d’attente n’est plus disponible.",
  "error.backend.editedOnOtherDevice": "Ce message est en cours de modification sur un autre appareil.",
  "error.backend.editUnavailable": "Cette modification n’est plus disponible.",
  "error.backend.attachmentInOtherEdit": "Une pièce jointe appartient à une autre modification.",
  "error.backend.messageBeingSaved": "Ce message est en cours d’enregistrement. Réessayez quand il sera terminé.",
  "error.backend.editQueuedOnly": "Seuls les messages en file d’attente peuvent être modifiés.",
  "error.backend.attachmentNotInMessage": "Une pièce jointe n’appartient pas au message en file d’attente.",
  "error.backend.queueOrderStale":
    "L’ordre de la file d’attente n’est plus à jour. Actualisez la file d’attente et réessayez.",
  "error.backend.fileGone": "Le fichier n’existe pas ou a déjà été supprimé.",
  "error.backend.managedAttachmentChanged": "La pièce jointe gérée est manquante ou a changé : {name}",
  "error.backend.mailboxStateCorrupt":
    "L’état de la messagerie est corrompu ou provient d’une version plus récente d’OpenBot ; il ne sera pas écrasé.",
  "error.backend.recipientDeleting":
    "Le destinataire est en cours de suppression. Réessayez une fois la suppression terminée.",
  "error.backend.recipientHidden": "Cet agent est masqué. Restaurez-le pour envoyer des messages.",
  "error.backend.attachBetween": "Joignez entre 1 et {limit} fichiers.",
  "error.backend.attachmentNotFile": "La pièce jointe n’est pas un fichier : {path}",
  "error.backend.generatedImageTooLarge": "L’image générée dépasse la limite de 100 Mo.",
  "error.backend.attachmentNotRegularFile": "Seuls les fichiers ordinaires peuvent être joints : {name}",
  "error.backend.attachmentCopyFailed": "OpenBot n’a pas pu copier {name}.",
  "error.backend.routineNameRequired": "Un nom de routine est requis.",
  "error.backend.routineNameTooLong": "Le nom de la routine est trop long.",
  "error.backend.routineInstructionRequired": "Une instruction de routine est requise.",
  "error.backend.routineInstructionTooLong": "L’instruction de la routine est trop longue.",
  "error.backend.routineScheduleInvalid": "La planification de la routine n’est pas valide.",
  "error.backend.routineIntervalTooShort":
    "Les intervalles de routine doivent être d’au moins {minutes} minutes. Utilisez {minutes} minutes ou plus, ou une planification quotidienne, hebdomadaire ou cron.",
  "error.backend.routineIntervalTooShortFixed":
    "Les intervalles de routine doivent être d’au moins {minutes} minutes. Utilisez {minutes} minutes ou plus, ou une heure fixe.",
  "error.backend.routineCronTooOften":
    "Les planifications personnalisées ne doivent pas s’exécuter plus souvent que toutes les {minutes} minutes.",
  "error.backend.routineAnchorInvalid": "Le point de départ de l’intervalle de la routine n’est pas valide.",
  "error.backend.routineNoOccurrence": "La planification n’a aucune occurrence dans les cinq prochaines années.",
  "error.backend.routineOncePassed":
    "L’heure de cette routine unique est passée. Choisissez une date ou une heure ultérieure.",
  "error.backend.routineTimezoneInvalid": "Le fuseau horaire de la routine n’est pas valide.",
  "error.backend.routineCronFields": "Les planifications personnalisées doivent utiliser cinq champs cron.",
  "error.backend.routineCronValueInvalid": "La valeur cron {field} n’est pas valide.",
  "error.backend.routineCronFieldEmpty": "Le champ cron {field} est vide.",
  "error.backend.routineDeletionBusy": "Une autre suppression de routine est déjà en cours pour cet agent.",
  "error.backend.routineWaitForAgent": "Attendez la fin de l’opération de l’agent avant d’exécuter une routine.",
  "error.backend.routineRunStarting":
    "Cette exécution de routine est encore en cours de démarrage. Réessayez après le début de son tour.",
  "error.backend.routineRunNoSession":
    "OpenBot ne peut pas interrompre l’exécution de routine active, car sa session de fournisseur est indisponible.",
  "error.backend.interruptSelf": "Un agent ne peut pas s’interrompre lui-même.",
  "error.backend.interruptOtherWork":
    "Cet agent travaille sur une tâche que votre message n’a pas lancée. Seul l’utilisateur ou l’expéditeur de cette tâche peut l’arrêter.",
  "error.backend.interruptStarting": "Cet agent démarre encore un tour. Réessayez après le début du tour.",
  "error.backend.interruptNoSession":
    "OpenBot ne peut pas interrompre cet agent, car sa session de fournisseur est indisponible.",
  "error.backend.memoryTextRequired": "Le texte du souvenir est requis.",
  "error.backend.memoryTextTooLong": "Le texte du souvenir est trop long.",
  "error.backend.mcpServerGone": "Ce serveur MCP n’existe plus.",
  "error.backend.routineFlowLinkGone": "Cette liaison n’existe plus.",
  "error.backend.routineFlowSameAgent": "Un agent ne peut pas se confier du travail à lui-même.",
  "error.backend.routineFlowIntoOwner":
    "La routine démarre avec son propre agent, donc cet agent ne peut pas reprendre le travail d’un autre.",
  "error.backend.routineFlowNotOnPath":
    "Cet agent ne fait pas encore partie de la routine. Reliez-le d’abord à la routine.",
  "error.backend.routineFlowDuplicate": "Ces agents sont déjà reliés dans cette routine.",
  "error.backend.routineFlowCycle": "Cette liaison créerait une boucle.",
  "error.backend.routineFlowLinkLimit": "Une routine peut avoir au plus {limit} liaisons.",
  "error.backend.agentWaitLimit":
    "Cet agent a déjà {count} attentes ouvertes. Fermez une attente avec openbot.close_wait avant d’en ouvrir une autre.",
  "error.backend.agentWaitGone": "Cette attente n’est pas ouverte. L’agent l’a fermée, ou quelqu’un l’a annulée.",
  "error.backend.agentWaitNoRequest": "Une attente a besoin d’un message pour continuer. Ce tour n’a pas de message.",
  "error.backend.agentWaitOwnChatOnly":
    "Ouvrez une attente uniquement dans votre propre discussion. Une tâche de canal ou de messagerie ne peut pas attendre.",
  "error.backend.agentWaitNoteRequired": "Indiquez une courte note qui précise l’objet de l’attente.",
  "error.backend.agentWaitRoutineGone": "Cet agent n’a pas de routine avec cet identifiant.",
  "error.backend.agentWaitNoRoutine":
    "Seule une exécution de l’une de vos routines réveille une attente, et vous n’avez aucune routine. Créez-en une avec openbot.create_routine, puis ouvrez l’attente.",
  "error.backend.agentWaitRemoteUnsupported":
    "Les attentes ouvertes ne sont disponibles que pour les agents de cet ordinateur.",
  "error.backend.markUnreadRemoteUnsupported":
    "Marquer un message comme non lu n’est disponible que pour les agents de cet ordinateur.",
  "error.backend.routineFlowHandoffFailed": "La routine n’a pas pu transmettre le travail à cet agent.",
  "error.backend.mcpServerLimit": "OpenBot garde jusqu’à {limit} serveurs MCP.",
  "error.backend.mcpServerNameTaken": "Un serveur MCP nommé {name} existe déjà.",
  "error.backend.mcpServerInvalid": "OpenBot ne peut pas enregistrer cette configuration de serveur MCP.",
  "error.backend.mcpServerNoAnswer": "Le serveur n’a pas répondu en {seconds} secondes.",
  "error.backend.mcpSignInNotAccepted": "Le serveur n’a pas accepté cette connexion.",
  "error.backend.mcpSignInClientRefused":
    "Le serveur de connexion n’a pas accepté OpenBot à la fin de la connexion. Connectez-vous à nouveau : OpenBot s’enregistre de nouveau auprès du serveur.",
  "error.backend.mcpCommandNotFound": "Commande introuvable : {command}",
  "error.backend.mcpRegistrationRefused":
    "Le serveur de connexion n’accepte pas encore OpenBot comme application. Votre compte n’en est pas la cause. Utilisez un autre moyen de connexion, par exemple un serveur MCP local.",
  "error.backend.mcpSignInAbandonedGeneric": "La connexion a été abandonnée.",
  "error.backend.mcpSignInForgotten": "La connexion MCP a été oubliée pendant son exécution.",
  "error.backend.mcpSignInAbandoned": "La connexion MCP a été abandonnée.",
  "error.backend.mcpSignInNoBrowser": "Cette connexion MCP ne peut pas ouvrir de navigateur.",
  "error.backend.mcpSignInNotWebPage": "L’adresse de connexion n’est pas une page web.",
  "error.backend.mcpSignInRequired":
    "Ce serveur demande une connexion. Choisissez « Se connecter » pour continuer dans votre navigateur.",
  "error.backend.mcpSignInOnHost":
    "Ce serveur demande une connexion. Connectez-vous-y dans OpenBot sur l’ordinateur hôte.",
  "error.backend.mcpSignInNeedsHttps":
    "Ce serveur demande une connexion, et OpenBot ne se connecte qu’en https. Remplacez l’URL par {url}.",
  "error.backend.mcpSignInCancelled": "La connexion a été annulée.",
  "error.backend.mcpSignInTimedOut": "La connexion n’a pas été terminée dans le navigateur.",
  "error.backend.mcpSignInResponseTimedOut": "La réponse à la connexion n’est pas arrivée à temps.",
  "error.backend.mcpSignInMetadataUnreadable":
    "OpenBot n’a pas pu lire les informations de connexion de ce serveur. Vérifiez l’adresse du serveur et réessayez.",
  "error.backend.mcpServerExited":
    "Le serveur s’est arrêté avant de répondre. Exécutez la commande dans un terminal pour voir son erreur.",
  "error.backend.mcpServerFailedToStart": "Le serveur n’a pas démarré : {reason}",
  "error.backend.mcpOAuthProxyUnavailable":
    "OpenBot n’a pas pu démarrer sa connexion locale de connexion pour ce serveur. Redémarrez OpenBot, puis réessayez.",
  "error.backend.mcpOAuthSignInNeeded":
    "La connexion à ce serveur MCP a pris fin. L’utilisateur doit se reconnecter dans OpenBot.",
  "error.backend.mcpServerUnreachable": "OpenBot n’a pas pu joindre le serveur. Vérifiez l’URL et votre réseau.",
  "error.backend.mcpLocalServerOff":
    "Aucun serveur ne répond à {address} sur cet ordinateur. Démarrez le serveur ou activez-le dans l’app qui l’exécute, puis réessayez.",
  "error.backend.mcpServerBlocked":
    "Cet ordinateur a bloqué la connexion au serveur. Vérifiez votre pare-feu ou votre logiciel de sécurité, puis réessayez.",
  "error.backend.mcpServerIncompatible":
    "Quelque chose a répondu à cette adresse, mais pas comme un serveur MCP en Streamable HTTP. Vérifiez l’URL et mettez à jour l’app qui exécute le serveur.",
  "error.backend.mcpRemoteBridge":
    "{reason} Cette commande lance la passerelle mcp-remote. Choisissez plutôt Streamable HTTP avec l’URL {url}, et OpenBot vous connecte.",
  "error.backend.oauthNotHttps":
    "Le point de terminaison OAuth {origin} n’utilise pas https : les identifiants n’ont pas été envoyés.",
  "error.backend.oauthTooManyRedirects": "Le point de terminaison OAuth a effectué trop de redirections.",
  "error.backend.oauthRedirectOrigin":
    "Le point de terminaison OAuth a redirigé vers {origin} : les identifiants n’ont pas été transmis.",
  "error.backend.oauthTimedOut": "Le point de terminaison OAuth {origin} n’a pas répondu à temps.",
  "error.backend.oauthResponseTooLarge":
    "Le point de terminaison OAuth {origin} a envoyé une réponse trop volumineuse.",
  "error.backend.oauthResponseUnreadable": "La réponse du point de terminaison OAuth {origin} n’a pas pu être lue.",
  "error.backend.mcpOAuthPrivateEndpoint":
    "Le point de terminaison OAuth {origin} est sur un réseau privé, mais le serveur MCP est public : les identifiants n’ont pas été envoyés.",
  "error.backend.sidebarSectionLimit": "Un serveur peut avoir jusqu’à {limit} sections de barre latérale.",
  "error.backend.sectionNameRequired": "Le nom de la section est requis.",
  "error.backend.sectionNameTooLong": "Le nom de la section est trop long.",
  "error.backend.sectionNameDuplicate": "Les noms de section doivent être uniques.",
  "error.backend.directMessageRequired": "Écrivez d’abord un message.",
  "error.backend.directMessageTooLong": "Un message direct peut contenir jusqu’à {limit} caractères.",
  "error.backend.directMessageSelf": "Vous ne pouvez pas vous envoyer un message direct.",
  "error.backend.readBoundaryUnavailable": "La limite de lecture n’est plus disponible.",
  "error.backend.sharedFileOutside": "Le fichier partagé doit se trouver dans le dossier partagé.",
  "error.backend.sharedPathIsFolder": "Le chemin partagé est un dossier, pas un fichier.",
  "error.backend.sharedPathNotFile": "Le chemin partagé n’est pas un fichier.",
  "error.backend.workspaceFileOutside": "Le fichier doit se trouver dans l’espace de travail de l’agent.",
  "error.backend.workspacePathNotFile": "Le chemin de l’espace de travail n’est pas un fichier.",
  "error.backend.workspacePathNotDirectory": "Le chemin de l’espace de travail n’est pas un dossier.",
  "error.backend.workspacePathMissing":
    "Il n’y a rien à l’emplacement {path} dans l’espace de travail de l’agent {root}.",
  "error.backend.workspacePathMissingForMember":
    "Il n’y a rien à l’emplacement {path} dans l’espace de travail de l’agent.",
  "error.backend.useChannelTaskControls": "Utilisez les commandes de tâche du canal pour cette tâche.",
  "error.backend.editFinished": "Cette modification est déjà terminée.",
  "error.backend.editCancelled": "Cette modification a été annulée : le message garde son texte d’origine.",
  "error.backend.editSaved": "Cette modification a déjà été enregistrée.",
  "error.backend.editSavedDifferent":
    "Cette modification a déjà été enregistrée avec un autre contenu. Vos changements n’ont pas été enregistrés.",
  "error.backend.useChannelTaskControlsWork": "Utilisez les commandes de tâche du canal pour le travail du canal.",
  "error.backend.steerTurnChanged": "Le tour actif a changé avant que ce message puisse l’orienter.",
  "error.backend.steerUnsupported":
    "Ce fournisseur ne peut pas orienter un tour en cours. Votre message reste dans la file.",
  "error.backend.steerRoutineRun":
    "Une routine est en cours. Votre message reste dans la file et démarre après la routine.",
  "error.backend.steerQueuedOnly": "Seuls les messages en file d’attente peuvent orienter le tour.",
  "error.backend.promptInactive": "Cette question n’est plus active.",
  "error.backend.promptAnswerMismatch": "Une réponse ne correspond à aucune question active.",
  "error.backend.approvalInactive": "Cette approbation n’est plus active.",
  "error.backend.takeoverInactive": "Cette prise de contrôle du navigateur n’est plus active.",
  "error.backend.authSubmitting": "L’envoi de l’authentification est déjà en cours.",
  "error.backend.apiKeySaveFailed": "OpenBot n’a pas pu enregistrer la clé d’API. Réessayez.",
  "error.backend.apiKeyNotAllowed": "Seul le propriétaire du serveur ou un administrateur peut saisir une clé d’API.",
  "error.backend.apiKeySaving": "La clé d’API est déjà en cours d’enregistrement.",
  "error.backend.authRequestInactive": "Cette demande d’authentification sécurisée n’est plus active.",
  "error.backend.secureAuthUnavailable": "L’authentification sécurisée est indisponible.",
  "error.backend.browserUrlRequired": "Une URL de navigateur est requise.",
  "error.backend.browserUrlTooLong": "L’URL du navigateur est trop longue.",
  "error.backend.browserTabLimit": "Le navigateur peut avoir jusqu’à {limit} onglets ouverts.",
  "error.backend.browserProfileMissing":
    "Le profil de navigateur de cet agent n’existe plus. Choisissez un autre profil dans les réglages de l’agent.",
  "error.backend.browserProfileNotFound": "Ce profil de navigateur n’existe plus.",
  "error.backend.browserProfileNameTaken": "Un profil de navigateur porte déjà ce nom.",
  "error.backend.browserSessionInUse": "Un onglet utilise encore cette session de navigateur. Réessayez.",
  "error.backend.browserProfileLimit": "Vous pouvez avoir jusqu’à {limit} profils de navigateur.",
  "error.backend.browserLowMemory":
    "Ce serveur manque de mémoire : le navigateur ne peut pas ouvrir un autre onglet. Fermez un onglet, ou attendez la fin du travail des autres agents.",
  "error.backend.browserOpenFailed": "Impossible d’ouvrir {url} : {reason}",
  "error.backend.popupSecureInput":
    "Les fenêtres contextuelles sont bloquées pendant une saisie sécurisée. Terminez ou annulez la saisie sécurisée, puis réessayez depuis la page.",
  "error.backend.popupUnsupportedType":
    "Ce type de fenêtre contextuelle n’est pas pris en charge. Utilisez un lien normal ou un bouton de connexion de la page.",
  "error.backend.popupUnsupportedAddress":
    "Cette fenêtre contextuelle utilise une adresse non prise en charge. Utilisez une option de connexion HTTP ou HTTPS de la page.",
  "error.backend.popupTabLimit":
    "La limite d’onglets du navigateur est atteinte. Fermez un onglet, puis réessayez depuis la page.",
  "error.backend.popupLoadFailed":
    "La fenêtre contextuelle n’a pas pu se charger. Réessayez la connexion depuis la page d’origine.",
  "error.backend.browserTabNotFound": "Onglet de navigateur introuvable.",
  "error.backend.authActive": "L’authentification est déjà active.",
  "error.backend.authHttpsRequired": "L’authentification sécurisée nécessite HTTPS.",
  "error.backend.authDigitsRange": "Les codes d’authentification doivent comporter de 4 à 12 chiffres.",
  "error.backend.authExpired": "La demande d’authentification a expiré.",
  "error.backend.authDigitsRequired": "Saisissez le nombre de chiffres demandé.",
  "error.backend.browserViewProtected": "La vue du navigateur est protégée pendant l’authentification.",
  "error.backend.browserPreviewPageChanged": "La page du navigateur a changé pendant l’aperçu. Réessayez.",
  "error.backend.browserInputProtected": "La saisie du navigateur est protégée pendant l’authentification.",
  "error.backend.mcpServerHttpCredentials":
    "Le serveur a répondu {status}. Vérifiez la clé d’API ou les autres identifiants.",
  "error.backend.mcpServerHttpUrl":
    "Le serveur a répondu {status}. Vérifiez l’URL. Le lien est peut-être erroné, expiré ou supprimé.",
  "error.backend.mcpSignInAppUrl": "L’app de connexion nécessite une URL de serveur valide.",
  "error.backend.mcpSignInAppClientId": "Saisissez l’ID client de l’app de connexion.",
  "error.backend.mcpSignInAppIssuerChanged":
    "Le serveur de connexion de ce serveur MCP a changé : OpenBot ne lui a pas envoyé l’app de connexion. Si ce changement est correct, supprimez l’app de connexion et ajoutez-la à nouveau.",
  "error.backend.mcpSignInAppNoServer":
    "Enregistrez ce serveur MCP comme serveur URL avant d’ajouter une app de connexion.",
  "error.backend.mcpSignInAppUnavailable": "Cet ordinateur ne peut pas conserver d’app de connexion.",
  "error.backend.taskMoveRefused": "Seul un message envoyé uniquement à cet agent peut s’exécuter comme tâche.",
  "error.backend.taskNotFound": "Cette tâche n’est pas disponible.",
  "error.backend.taskClosed": "Cette tâche est fermée. Rouvrez-la pour envoyer un message.",
  "error.backend.taskStillRunning": "Cette tâche est toujours en cours. Attendez qu’elle s’arrête, puis fermez-la.",
  "error.backend.threadNotFound": "Ce fil n’est pas disponible.",
  "error.backend.threadStillRunning": "Ce fil est toujours en cours. Arrêtez-le, puis réessayez.",
  "error.backend.threadArchived": "Ce fil est archivé. Restaurez-le pour envoyer un message.",
  "error.backend.threadTitleRequired": "Donnez un titre court au fil.",
  "error.backend.threadOpenLimitReached":
    "Cet agent a {count} fils ouverts. Archivez un fil, puis lancez-en ou restaurez-en un autre.",
  "error.backend.threadRemoteUnsupported": "Les fils sont disponibles uniquement pour les agents de cet ordinateur.",
  "error.backend.threadMoveRefused":
    "Seul un message envoyé uniquement à cet agent peut s’exécuter dans un nouveau fil.",
  "error.backend.taskTitleRequired": "Donnez un titre court à la tâche.",
  "error.backend.taskToolInvalid":
    "Donnez à la tâche un titre de 120 caractères au plus et des consignes qui disent quoi faire.",
  "error.backend.taskOwnChatOnly":
    "Lancez une tâche uniquement depuis votre propre discussion. Un canal, une conversation de messagerie ou une autre tâche ne peut pas en lancer.",
  "error.backend.taskOpenLimit":
    "Cet agent a déjà {count} tâches ouvertes. Attendez que l’utilisateur en ferme une avant de lancer une autre tâche.",
  "error.backend.taskOpenLimitReached":
    "Cet agent a {count} tâches ouvertes. Fermez une tâche, puis lancez-en ou ouvrez-en une autre.",
  "error.backend.taskRemoteUnsupported": "Les tâches sont disponibles uniquement pour les agents de cet ordinateur.",
  "error.backend.taskStartFailed": "OpenBot n’a pas pu lancer la tâche. Faites plutôt le travail dans ce tour.",
} as const satisfies PartialTranslation<typeof source>;
