import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Chaque agent de cet ordinateur peut utiliser vos dépôts, tickets et pull requests GitHub, ainsi que gh et git.",
  "connector.github.connect": "Connecter GitHub",
  "connector.github.pendingTitle": "Saisissez ce code sur GitHub",
  "connector.github.pendingDescription":
    "GitHub s’est ouvert dans votre navigateur. Saisissez-y le code pour vous connecter.",
  "connector.github.waiting": "En attente de GitHub",
  "connector.github.copyCode": "Copier le code",
  "connector.github.codeCopied": "Copié",
  "connector.github.openGitHub": "Ouvrir GitHub",
  "connector.github.cancel": "Annuler",
  "connector.github.connectedAs": "Connecté en tant que @{login}",
  "connector.github.repositoriesTitle": "Dépôts",
  "connector.github.repositoriesDescription":
    "Les agents peuvent utiliser uniquement les dépôts où l’app GitHub OpenBot est installée.",
  "connector.github.chooseRepositories": "Choisir les dépôts",
  "connector.github.repositoriesLoading": "Lecture des dépôts depuis GitHub",
  "connector.github.repositoriesFailed": "OpenBot n’a pas pu lire les dépôts depuis GitHub.",
  "connector.github.noRepositories": "L’app GitHub OpenBot n’est encore installée sur aucun dépôt.",
  "connector.github.moreRepositories": { one: "Et {count} autre dépôt", other: "Et {count} autres dépôts" },
  "connector.github.private": "Privé",
  "connector.github.disconnect": "Déconnecter",
  "connector.github.disconnectTitle": "Déconnecter GitHub",
  "connector.github.disconnectSummary":
    "Tous les agents perdent l’accès à GitHub. Vos discussions et vos fichiers sont conservés.",
  "connector.github.expiredTitle": "La connexion GitHub a expiré",
  "connector.github.expiredDescription": "Reconnectez-vous en tant que @{login} pour redonner GitHub aux agents.",
  "connector.github.reconnect": "Reconnecter",
  "connector.github.actionFailed": "OpenBot n’a pas pu modifier la connexion GitHub.",
  "connector.github.statusConnected": "Connecté",
  "connector.github.statusConnecting": "Connexion en cours",
  "connector.github.statusExpired": "Expiré",
  "connector.github.accountTitle": "Compte",
  "connector.github.filterPlaceholder": { one: "Filtrer {count} dépôt", other: "Filtrer {count} dépôts" },
  "connector.github.filterLabel": "Filtrer les dépôts",
  "connector.github.noMatch": "Aucun dépôt ne correspond à « {query} ».",
  "connector.github.stepSignIn": "Connexion",
  "connector.github.stepConnected": "Connecté",
  "connector.github.requestingCode": "OpenBot demande un code à GitHub.",
  "connector.github.codeLabel": "Code {code}",
  "connector.github.failedTitle": "GitHub ne s’est pas connecté",
  "connector.github.cancelConnecting": "Annuler la connexion à GitHub",
  "connector.github.connectedSummary": {
    one: "{count} dépôt · chaque agent de cet ordinateur",
    other: "{count} dépôts · chaque agent de cet ordinateur",
  },
  "connector.github.done": "Terminé",
  "connector.github.later": "Plus tard",
  "connector.github.disconnectConfirmTitle": "Déconnecter GitHub ?",
  "connector.github.disconnectConfirmDescription":
    "La déconnexion supprime la connexion de @{login} de cet ordinateur.",
  "connector.github.disconnectEffectTools": "Tous les agents perdent les outils GitHub, gh et git.",
  "connector.github.disconnectEffectRevoke": "GitHub s’ouvre ensuite, et vous pouvez y révoquer OpenBot.",
  "connector.github.disconnectEffectKept":
    "Les discussions, les fichiers et la mémoire des agents restent sur cet ordinateur.",
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "Chaque agent de {host} peut utiliser vos dépôts, tickets et pull requests GitHub, ainsi que gh et git.",
  "connector.github.connectedSummaryHost": {
    one: "{count} dépôt · chaque agent de {host}",
    other: "{count} dépôts · chaque agent de {host}",
  },
  "connector.github.disconnectConfirmDescriptionHost": "La déconnexion supprime la connexion de @{login} de {host}.",
  "connector.github.disconnectEffectKeptHost":
    "Les discussions, les fichiers et la mémoire des agents restent sur {host}.",
  "connector.github.keepConnected": "Rester connecté",
  "connector.github.close": "Fermer",
  "connector.dangerZone": "Zone de danger",
  "connector.statusUnknown": "Inconnu",
  "connector.readFailed": "OpenBot n'a pas pu lire l'état de cette connexion.",

  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Les utilisateurs mentionnent @OpenBot dans Slack ou lui envoient un message direct. Le Slack Orchestrator sollicite le bon agent et répond.",
  "connector.slack.statusConnected": "Connecté",
  "connector.slack.statusAttention": "Action requise",
  "connector.slack.summaryConnected": "{workspace} · Le Slack Orchestrator répond",
  "connector.slack.summaryNoAgent": "{workspace} · Aucun agent ne répond encore",
  "connector.slack.attentionTitle": {
    one: "{count} espace de travail demande votre attention",
    other: "{count} espaces de travail demandent votre attention",
  },
  "connector.slack.attentionDescription": "L’état ci-dessous indique quoi faire.",
  "connector.slack.connect": "Connecter Slack",
  "connector.slack.addAgent": "Ajouter un agent",
  "connector.slack.actionFailed": "Slack n’a pas accepté la modification",
  "connector.slack.workspaceTitle": "Espaces de travail",
  "connector.slack.workspaceDescription": "Les utilisateurs mentionnent @OpenBot ou lui envoient un message direct.",
  "connector.slack.disconnectWorkspace": "Déconnecter",
  "connector.slack.disconnectAllTitle": "Déconnecter Slack",
  "connector.slack.disconnectAllSummary":
    "Tous les espaces de travail sont déconnectés. Personne ne peut plus joindre vos agents via @OpenBot.",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "Tous les espaces de travail sont déconnectés. Le Slack Orchestrator et ses conversations sont supprimés d’OpenBot.",
  "connector.slack.missingScopes":
    "OpenBot n’a pas ces autorisations dans Slack : {scopes}. Déconnectez l’espace de travail, puis connectez-le à nouveau.",
  "connector.slack.retryAt": "Slack a demandé à OpenBot de patienter. Nouvel essai à {time}.",
  "connector.slack.reconnect": "Reconnecter",
  "connector.slack.pause": "Mettre en pause",
  "connector.slack.resume": "Reprendre",
  "connector.slack.rowAction": "{action} : {name}",
  "connector.slack.orchestratorTitle": "Slack Orchestrator",
  "connector.slack.orchestratorDescription":
    "Cet agent reçoit chaque demande venant de Slack. Il répond lui-même aux demandes courtes, confie les autres tâches au bon agent et publie la réponse dans le fil.",
  "connector.slack.orchestratorNone": "Aucun agent ne répond encore",
  "connector.slack.orchestratorNoneDescription": "Ajoutez le Slack Orchestrator, sinon Slack ne reçoit aucune réponse.",
  "connector.slack.inviteNote":
    "OpenBot rejoint seul chaque canal public, et chaque nouveau canal. Pour un canal privé, invitez-le : /invite @OpenBot.",
  "connector.slack.stepWorkspace": "Espace de travail",
  "connector.slack.stepAgent": "Agent",
  "connector.slack.connectTitle": "Connecter un espace de travail Slack",
  "connector.slack.connectDescription":
    "OpenBot installe une app nommée OpenBot dans l’espace de travail, et elle rejoint chaque canal public.",
  "connector.slack.connectStepBrowser": "Slack s’ouvre dans votre navigateur",
  "connector.slack.connectStepAllow": "Sélectionnez l’espace de travail en haut à droite, puis Autoriser",
  "connector.slack.connectStepReturn": "Cette boîte de dialogue continue quand Slack a terminé",
  "connector.slack.connectInSlack": "Se connecter dans Slack",
  "connector.slack.connectWaiting": "En attente de Slack. Terminez l’installation dans votre navigateur.",
  "connector.slack.agentStepTitle": "Ajouter le Slack Orchestrator",
  "connector.slack.agentStepDescription":
    "Ce nouvel agent répond à tout ce que les utilisateurs envoient à @OpenBot dans {workspace}.",
  "connector.slack.orchestratorName": "Slack Orchestrator",
  "connector.slack.orchestratorRole": "Répond dans Slack et sollicite l’équipe",
  "connector.slack.orchestratorDoesReceive": "Reçoit en premier chaque demande Slack",
  "connector.slack.orchestratorDoesDelegate": "Confie chaque tâche à l’agent le plus adapté",
  "connector.slack.orchestratorDoesAnswer": "Publie la réponse dans le fil Slack",
  "connector.slack.orchestratorModel": "Modèle",
  "connector.slack.doneTitle": "OpenBot est dans {workspace}",
  "connector.slack.doneDescription":
    "Mentionnez @OpenBot dans n’importe quel canal public, ou envoyez-lui un message direct.",
  "connector.slack.done": "Terminé",
  "connector.slack.disconnectTitle": "Déconnecter {workspace} ?",
  "connector.slack.disconnectDescription":
    "OpenBot cesse de répondre dans {workspace} et supprime son jeton Slack de cet ordinateur.",
  "connector.slack.disconnectDescriptionHost":
    "OpenBot cesse de répondre dans {workspace} et supprime son jeton Slack de {host}.",
  "connector.slack.disconnectEffect": "Les membres de {workspace} ne peuvent plus joindre vos agents via @OpenBot.",
  "connector.slack.removeEffectKept": "Les conversations et le Slack Orchestrator restent dans OpenBot.",
  "connector.slack.removeEffectDeleted": "Le Slack Orchestrator et ses conversations sont supprimés d’OpenBot.",
  "connector.slack.keep": "Rester connecté",
  "connector.slack.close": "Fermer",
  "connector.slack.addWorkspace": "Ajouter un espace de travail",
  "connector.slack.limitReached": {
    one: "Vous pouvez connecter au maximum {count} espace de travail.",
    other: "Vous pouvez connecter au maximum {count} espaces de travail.",
  },
  "connector.slack.summaryMany": {
    one: "{count} espace de travail · Le Slack Orchestrator répond",
    other: "{count} espaces de travail · Le Slack Orchestrator répond",
  },

  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Les utilisateurs mentionnent @OpenBot dans un canal d’un serveur Discord. Le Discord Orchestrator sollicite le bon agent et répond.",
  "connector.discord.statusConnected": "Connecté",
  "connector.discord.statusAttention": "Action requise",
  "connector.discord.summaryConnected": "{workspace} · Le Discord Orchestrator répond",
  "connector.discord.summaryNoAgent": "{workspace} · Aucun agent ne répond encore",
  "connector.discord.attentionTitle": {
    one: "{count} serveur Discord demande votre attention",
    other: "{count} serveurs Discord demandent votre attention",
  },
  "connector.discord.attentionDescription": "L’état ci-dessous indique quoi faire.",
  "connector.discord.connect": "Connecter Discord",
  "connector.discord.addAgent": "Ajouter un agent",
  "connector.discord.actionFailed": "Discord n’a pas accepté la modification",
  "connector.discord.workspaceTitle": "Serveurs Discord",
  "connector.discord.workspaceDescription": "Mentionnez @OpenBot dans un canal. Répondez à OpenBot pour continuer.",
  "connector.discord.disconnectWorkspace": "Déconnecter",
  "connector.discord.disconnectAllTitle": "Déconnecter Discord",
  "connector.discord.disconnectAllSummary":
    "Tous les serveurs sont déconnectés. Personne ne peut plus joindre vos agents via @OpenBot.",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "Tous les serveurs sont déconnectés. Le Discord Orchestrator et ses conversations sont supprimés d’OpenBot.",
  "connector.discord.missingScopes":
    "OpenBot n’a pas ces autorisations dans Discord : {scopes}. Déconnectez le serveur Discord, puis connectez-le à nouveau.",
  "connector.discord.retryAt": "Discord a demandé à OpenBot de patienter. Nouvel essai à {time}.",
  "connector.discord.reconnect": "Reconnecter",
  "connector.discord.pause": "Mettre en pause",
  "connector.discord.resume": "Reprendre",
  "connector.discord.rowAction": "{action} : {name}",
  "connector.discord.orchestratorTitle": "Discord Orchestrator",
  "connector.discord.orchestratorDescription":
    "Cet agent reçoit chaque demande venant de Discord. Il répond lui-même aux demandes courtes, confie les autres tâches au bon agent et répond dans le canal.",
  "connector.discord.orchestratorNone": "Aucun agent ne répond encore",
  "connector.discord.orchestratorNoneDescription":
    "Ajoutez le Discord Orchestrator, sinon Discord ne reçoit aucune réponse.",
  "connector.discord.channelsNote": "OpenBot voit les canaux que son rôle peut afficher.",
  "connector.discord.stepWorkspace": "Serveur Discord",
  "connector.discord.stepAgent": "Agent",
  "connector.discord.connectTitle": "Connecter un serveur Discord",
  "connector.discord.connectDescription": "OpenBot ajoute un bot nommé OpenBot au serveur Discord.",
  "connector.discord.connectStepBrowser": "Discord s’ouvre dans votre navigateur",
  "connector.discord.connectStepAllow": "Sélectionnez le serveur, puis Autoriser",
  "connector.discord.connectStepReturn": "Cette boîte de dialogue continue quand Discord a terminé",
  "connector.discord.connectInDiscord": "Se connecter dans Discord",
  "connector.discord.connectWaiting": "En attente de Discord. Terminez l’autorisation dans votre navigateur.",
  "connector.discord.agentStepTitle": "Ajouter le Discord Orchestrator",
  "connector.discord.agentStepDescription":
    "Ce nouvel agent répond à tout ce que les utilisateurs envoient à @OpenBot dans {workspace}.",
  "connector.discord.orchestratorName": "Discord Orchestrator",
  "connector.discord.orchestratorRole": "Répond dans Discord et sollicite l’équipe",
  "connector.discord.orchestratorDoesReceive": "Reçoit en premier chaque demande Discord",
  "connector.discord.orchestratorDoesDelegate": "Confie chaque tâche à l’agent le plus adapté",
  "connector.discord.orchestratorDoesAnswer": "Répond dans le canal Discord",
  "connector.discord.orchestratorModel": "Modèle",
  "connector.discord.doneTitle": "OpenBot est dans {workspace}",
  "connector.discord.doneDescription": "Mentionnez @OpenBot dans un canal. Répondez à OpenBot pour continuer.",
  "connector.discord.done": "Terminé",
  "connector.discord.disconnectTitle": "Déconnecter {workspace} ?",
  "connector.discord.disconnectDescription":
    "OpenBot cesse de répondre dans {workspace} et supprime la connexion Discord de cet ordinateur.",
  "connector.discord.disconnectDescriptionHost":
    "OpenBot cesse de répondre dans {workspace} et supprime la connexion Discord de {host}.",
  "connector.discord.disconnectEffect": "Les membres de {workspace} ne peuvent plus joindre vos agents via @OpenBot.",
  "connector.discord.removeEffectKept": "Les conversations et le Discord Orchestrator restent dans OpenBot.",
  "connector.discord.removeEffectDeleted": "Le Discord Orchestrator et ses conversations sont supprimés d’OpenBot.",
  "connector.discord.keep": "Rester connecté",
  "connector.discord.close": "Fermer",
  "connector.discord.addWorkspace": "Ajouter un serveur Discord",
  "connector.discord.limitReached": {
    one: "Vous pouvez connecter au maximum {count} serveur Discord.",
    other: "Vous pouvez connecter au maximum {count} serveurs Discord.",
  },
  "connector.discord.summaryMany": {
    one: "{count} serveur Discord · Le Discord Orchestrator répond",
    other: "{count} serveurs Discord · Le Discord Orchestrator répond",
  },
  "connector.discord.accessTitle": "Qui peut utiliser OpenBot",
  "connector.discord.accessDescription":
    "OpenBot répond uniquement à ces personnes. Il ignore les mentions des autres.",
  "connector.discord.accessEveryone": "Tout le monde sur le serveur",
  "connector.discord.accessEveryoneDescription":
    "Toute personne qui peut publier dans un canal visible par OpenBot peut le mentionner.",
  "connector.discord.accessRoles": "Membres avec {roles}",
  "connector.discord.accessChoose": "Choisir des rôles",
  "connector.discord.accessDialogTitle": "Qui peut utiliser OpenBot dans {workspace} ?",
  "connector.discord.accessDialogDescription": "Sans rôle sélectionné, tout le monde peut mentionner OpenBot.",
  "connector.discord.accessLoading": "Chargement des rôles…",
  "connector.discord.accessLoadFailed": "Les rôles Discord ne se sont pas chargés",
  "connector.discord.accessNoRoles": "Ce serveur n’a aucun rôle à choisir.",
  "connector.discord.accessRoleDeleted": "{role} (supprimé)",
  "connector.discord.accessSave": "Enregistrer",
  "connector.discord.accessHostUpdate": "Mettez à jour OpenBot sur {host} pour choisir des rôles.",

  "connector.telegram.title": "Telegram Bot",
  "connector.telegram.developer": "Telegram",
  "connector.telegram.description":
    "Ajoutez le bot OpenBot à un groupe Telegram ou ouvrez une discussion directe avec lui. Le Telegram Orchestrator sollicite le bon agent et répond.",
  "connector.telegram.statusConnected": "Connecté",
  "connector.telegram.statusAttention": "Action requise",
  "connector.telegram.summaryConnected": {
    one: "{count} discussion · Le Telegram Orchestrator répond",
    other: "{count} discussions · Le Telegram Orchestrator répond",
  },
  "connector.telegram.summaryNoAgent": {
    one: "{count} discussion · Aucun agent ne répond encore",
    other: "{count} discussions · Aucun agent ne répond encore",
  },
  "connector.telegram.attentionTitle": {
    one: "{count} discussion demande votre attention",
    other: "{count} discussions demandent votre attention",
  },
  "connector.telegram.attentionDescription": "L’état ci-dessous indique quoi faire.",
  "connector.telegram.connect": "Connecter Telegram",
  "connector.telegram.addAgent": "Ajouter un agent",
  "connector.telegram.actionFailed": "Telegram n’a pas accepté la modification",
  "connector.telegram.chatsTitle": "Discussions",
  "connector.telegram.groupDescription": "Les utilisateurs mentionnent le bot ou répondent à ses messages.",
  "connector.telegram.directDescription": "Chaque message de cette discussion va au Telegram Orchestrator.",
  "connector.telegram.helpRemoved":
    "Le bot OpenBot n’est plus dans cette discussion. Déconnectez la discussion, puis ajoutez à nouveau le bot.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot ne peut pas recevoir de messages Telegram sur cet ordinateur. Connectez-vous, donnez un nom à cet ordinateur dans les Réglages du serveur et gardez OpenBot ouvert.",
  "connector.telegram.helpRelayUnavailableHost":
    "OpenBot sur {host} ne peut pas recevoir de messages Telegram. Sur {host}, connectez-vous, donnez un nom au serveur dans les Réglages du serveur et gardez OpenBot ouvert.",
  "connector.telegram.helpError": "OpenBot ne peut pas joindre cette discussion. Reconnectez-la ou déconnectez-la.",
  "connector.telegram.retryAt": "Telegram a demandé à OpenBot de patienter. Nouvel essai à {time}.",
  "connector.telegram.pause": "Mettre en pause",
  "connector.telegram.resume": "Reprendre",
  "connector.telegram.reconnect": "Reconnecter",
  "connector.telegram.disconnectChat": "Déconnecter",
  "connector.telegram.disconnectAllTitle": "Déconnecter Telegram",
  "connector.telegram.disconnectAllSummary":
    "Toutes les discussions sont déconnectées. Personne ne peut plus joindre vos agents via le bot OpenBot.",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "Toutes les discussions sont déconnectées. Le Telegram Orchestrator et ses conversations sont supprimés d’OpenBot.",
  "connector.telegram.rowAction": "{action} : {name}",
  "connector.telegram.linkChat": "Associer une discussion",
  "connector.telegram.addToGroup": "Ajouter à un groupe",
  "connector.telegram.openDirectChat": "Discuter en privé",
  "connector.telegram.orchestratorTitle": "Telegram Orchestrator",
  "connector.telegram.orchestratorDescription":
    "Cet agent reçoit les messages destinés à OpenBot depuis toutes vos discussions Telegram. Il répond lui-même aux messages courts, confie les autres tâches au bon agent et publie la réponse dans la discussion.",
  "connector.telegram.orchestratorNone": "Aucun agent ne répond encore",
  "connector.telegram.orchestratorNoneDescription":
    "Ajoutez le Telegram Orchestrator, sinon Telegram ne reçoit aucune réponse.",
  "connector.telegram.mentionNote":
    "Dans un groupe, mentionnez le bot ou répondez à ses messages. Dans une discussion directe, chaque message va au bot.",
  "connector.telegram.stepChat": "Discussion",
  "connector.telegram.stepAgent": "Agent",
  "connector.telegram.connectTitle": "Associer une discussion Telegram",
  "connector.telegram.connectDescription":
    "Ajoutez le bot OpenBot à un groupe, ou ouvrez une discussion directe avec lui. Un seul bot sert toutes vos discussions.",
  "connector.telegram.connectStepBrowser": "Telegram s’ouvre dans votre navigateur",
  "connector.telegram.connectStepPick": "Sélectionnez le groupe, ou appuyez sur Démarrer dans la discussion directe",
  "connector.telegram.connectStepReturn": "Cette boîte de dialogue continue quand la discussion est associée",
  "connector.telegram.connectWaiting": "En attente de Telegram. Sélectionnez la discussion dans Telegram.",
  "connector.telegram.agentStepTitle": "Ajouter le Telegram Orchestrator",
  "connector.telegram.agentStepDescription":
    "Ce nouvel agent répond aux messages destinés à OpenBot dans {chat} et dans chaque discussion que vous associerez plus tard.",
  "connector.telegram.orchestratorName": "Telegram Orchestrator",
  "connector.telegram.orchestratorRole": "Répond dans Telegram et sollicite l’équipe",
  "connector.telegram.orchestratorDoesReceive": "Reçoit en premier chaque message Telegram destiné à OpenBot",
  "connector.telegram.orchestratorDoesDelegate": "Confie chaque tâche à l’agent le plus adapté",
  "connector.telegram.orchestratorDoesAnswer": "Publie la réponse dans la discussion Telegram",
  "connector.telegram.orchestratorModel": "Modèle",
  "connector.telegram.doneTitle": "OpenBot est dans {chat}",
  "connector.telegram.done": "Terminé",
  "connector.telegram.disconnectTitle": "Déconnecter {chat} ?",
  "connector.telegram.leaveDescription": "Le bot OpenBot quitte {chat}, et OpenBot cesse d’y répondre.",
  "connector.telegram.disconnectEffect": "Les membres de {chat} ne peuvent plus joindre vos agents via le bot OpenBot.",
  "connector.telegram.removeEffectKept": "Les conversations et le Telegram Orchestrator restent dans OpenBot.",
  "connector.telegram.removeEffectDeleted":
    "C’est la dernière discussion : le Telegram Orchestrator et ses conversations sont supprimés d’OpenBot.",
  "connector.telegram.keep": "Rester connecté",
  "connector.telegram.close": "Fermer",
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "Partagez un coffre 1Password dédié avec OpenBot via un compte de service, pour que les agents puissent se connecter aux sites dans le navigateur d’OpenBot.",
  "connector.onePassword.howItWorks":
    "La connexion crée un coffre « Shared with OpenBot » dans votre compte 1Password et un compte de service qui peut lire uniquement ce coffre. OpenBot remplit les identifiants enregistrés dans son navigateur sur cet ordinateur : seuls les éléments que vous déplacez dans ce coffre sont partagés. Les agents ne voient jamais de mot de passe.",
  "connector.onePassword.connect": "Connecter 1Password",
  "connector.onePassword.setupTitle": "Configuration",
  "connector.onePassword.stepCliTitle": "Installer la CLI 1Password",
  "connector.onePassword.stepCliChecking": "Recherche de la CLI 1Password sur cet ordinateur",
  "connector.onePassword.stepCliInstalling": "Téléchargement de la CLI 1Password depuis 1Password",
  "connector.onePassword.stepCliReady": "La version {version} est installée.",
  "connector.onePassword.stepCliMissing":
    "OpenBot la télécharge depuis 1Password dans son propre dossier. Aucun mot de passe administrateur n’est nécessaire.",
  "connector.onePassword.stepCliManual":
    "OpenBot ne peut pas l’installer sur cet ordinateur. Installez-la depuis 1Password, puis revenez sur cette page.",
  "connector.onePassword.installCli": "Installer",
  "connector.onePassword.stepAppTitle": "Activer l’intégration CLI",
  "connector.onePassword.stepAppDescription":
    "Dans l’app 1Password, ouvrez Réglages > Développeur et activez « Intégrer avec 1Password CLI ».",
  "connector.onePassword.stepAppReady": "L’app 1Password permet à la CLI de créer le coffre partagé.",
  "connector.onePassword.openApp": "Ouvrir 1Password",
  "connector.onePassword.openAppFailed": "OpenBot n'a pas pu ouvrir 1Password.",
  "connector.onePassword.checkAgain": "Revérifier",
  "connector.onePassword.stepVaultTitle": "Créer le coffre partagé",
  "connector.onePassword.stepVaultDescription":
    "OpenBot crée le coffre « Shared with OpenBot » et un compte de service qui peut seulement le lire. 1Password vous demande votre approbation.",
  "connector.onePassword.useTokenDescription":
    "Au lieu de ces étapes, collez un jeton de compte de service de 1Password.com.",
  "connector.onePassword.useTokenAction": "Utiliser un jeton",
  "connector.onePassword.tokenLabel": "Jeton de compte de service",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "Connecter",
  "connector.onePassword.approveInApp": "Approuvez la demande dans l’app 1Password",
  "connector.onePassword.cancel": "Annuler",
  "connector.onePassword.chooseAccountTitle": "Choisir un compte",
  "connector.onePassword.chooseAccountDescription":
    "OpenBot crée le coffre partagé dans le compte que vous choisissez.",
  "connector.onePassword.useAccount": "Utiliser ce compte",
  "connector.onePassword.vaultTitle": "Coffre partagé",
  "connector.onePassword.vaultDescription":
    "Déplacez un identifiant dans ce coffre dans 1Password pour permettre aux agents de se connecter avec. Retirez-le pour arrêter.",
  "connector.onePassword.loginsLoading": "Lecture des identifiants depuis 1Password",
  "connector.onePassword.loginCount": { one: "{count} identifiant", other: "{count} identifiants" },
  "connector.onePassword.disconnect": "Déconnecter",
  "connector.onePassword.disconnectTitle": "Déconnecter 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot oublie le jeton. Le coffre et le compte de service restent dans 1Password ; supprimez-les là-bas si vous n’en avez plus besoin.",
  "connector.onePassword.actionFailed": "OpenBot n’a pas pu modifier la connexion 1Password.",
  "connector.onePassword.statusConnected": "Connecté",
  "connector.onePassword.statusConnecting": "Connexion en cours",
  "connector.onePassword.descriptionHost":
    "Partagez un coffre 1Password dédié avec OpenBot sur {host} via un compte de service, pour que les agents de {host} puissent se connecter aux sites dans son navigateur.",
  "connector.onePassword.howItWorksHost":
    "{host} se connecte avec un jeton de compte de service. Sur 1Password.com, créez un compte de service qui ne peut lire que le coffre que vous partagez avec OpenBot, puis collez son jeton ici. {host} vérifie le jeton et le conserve ; cet ordinateur ne le conserve pas. Les agents ne voient jamais de mot de passe.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} oublie le jeton. Le coffre et le compte de service restent dans 1Password ; supprimez-les là-bas si vous n’en avez plus besoin.",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Remplir les identifiants du navigateur depuis Bitwarden.",
  "connector.bitwarden.setup":
    "Installez la CLI Bitwarden et connectez-vous avec bw login. Créez un dossier nommé Shared with OpenBot et placez-y uniquement les identifiants que les agents peuvent utiliser. Exécutez bw unlock --raw et collez la clé de session ci-dessous. Ne collez pas votre mot de passe principal.",
  "connector.bitwarden.scope":
    "Tous les agents de cet ordinateur peuvent utiliser les identifiants correspondants dans Shared with OpenBot. OpenBot utilise des origines HTTPS exactes. Il n’utilise pas les éléments qui demandent une invite de mot de passe principal ou une règle de correspondance d’URI personnalisée.",
  "connector.bitwarden.session":
    "La clé de session reste en mémoire. Reconnectez-vous après 8 heures sans utilisation du coffre ou après la fermeture d’OpenBot. La déconnexion arrête l’accès d’OpenBot ; elle ne verrouille pas les autres clients Bitwarden.",
  "connector.bitwarden.sessionKey": "Clé de session Bitwarden",
  "connector.bitwarden.connect": "Connecter Bitwarden",
  "connector.bitwarden.disconnect": "Déconnecter Bitwarden",
  "connector.bitwarden.disconnectAction": "Déconnecter",
  "connector.bitwarden.disconnectSummary":
    "OpenBot oublie la clé de session. Les agents ne peuvent plus remplir les identifiants depuis Bitwarden. Les autres clients Bitwarden restent déverrouillés.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} supprime la clé d’API et le mot de passe principal. Les agents de {host} ne peuvent plus remplir les identifiants depuis Bitwarden.",
  "connector.bitwarden.connected": "Connecté",
  "connector.bitwarden.actionFailed": "OpenBot n’a pas pu modifier la connexion Bitwarden.",
  "connector.bitwarden.descriptionHost":
    "Remplir les identifiants du navigateur sur {host} depuis Bitwarden ou Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} se connecte avec sa propre CLI Bitwarden. Dans votre coffre, créez un dossier nommé « Shared with OpenBot » et placez-y uniquement les identifiants que les agents peuvent utiliser. Dans le coffre web, ouvrez Paramètres › Sécurité › Clés et affichez votre clé d’API. Saisissez ci-dessous l’adresse du serveur, client_id, client_secret et votre mot de passe principal.",
  "connector.bitwarden.scopeHost":
    "Tous les agents de {host} peuvent utiliser les identifiants correspondants de « Shared with OpenBot ». OpenBot utilise des origines HTTPS exactes. Il n’utilise pas les éléments qui demandent le mot de passe principal ni ceux qui ont une règle de correspondance d’URI personnalisée.",
  "connector.bitwarden.sessionHost":
    "{host} conserve la clé d’API et le mot de passe principal chiffrés, pour pouvoir déverrouiller à nouveau après un redémarrage. Cet ordinateur ne les conserve pas. Déconnecter les supprime de {host}. {host} doit joindre l’adresse du serveur en HTTPS.",
  "connector.bitwarden.serverUrl": "Adresse du serveur",
  "connector.bitwarden.folderTitle": "Dossier partagé",
  "connector.bitwarden.folderDescription":
    "Déplacez un identifiant dans ce dossier dans Bitwarden pour permettre aux agents de se connecter avec. Retirez-le pour arrêter.",
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Dossier dans Bitwarden",
  "connector.bitwarden.clientId": "client_id de la clé d’API",
  "connector.bitwarden.clientSecret": "client_secret de la clé d’API",
  "connector.bitwarden.masterPassword": "Mot de passe principal",
  "connector.bitwarden.connecting": "Connexion",
  "connector.telegramAccount.title": "Compte Telegram",
  "connector.telegramAccount.description":
    "Les agents peuvent lire vos discussions Telegram et, si vous l’autorisez, envoyer des messages en votre nom.",
  "connector.telegramAccount.descriptionHost":
    "Les agents de {host} peuvent lire vos discussions Telegram et, si vous l’autorisez, envoyer des messages en votre nom.",
  "connector.telegramAccount.statusConnecting": "Connexion",
  "connector.telegramAccount.statusConnected": "Connecté",
  "connector.telegramAccount.actionFailed": "OpenBot n’a pas pu modifier la connexion du compte Telegram.",
  "connector.telegramAccount.disconnectTitle": "Déconnecter le compte Telegram",
  "connector.telegramAccount.disconnectSummary":
    "OpenBot ferme cette session. Les agents ne peuvent plus lire ni envoyer de messages, et l’envoi est désactivé.",
  "connector.telegramAccount.disconnectSummaryHost":
    "{host} ferme cette session. Les agents de {host} ne peuvent plus lire ni envoyer de messages, et l’envoi est désactivé.",
  "connector.telegramAccount.disconnect": "Déconnecter",
  "connector.telegramAccount.signInTitle": "Connexion",
  "connector.telegramAccount.howItWorks":
    "OpenBot se connecte à votre propre compte Telegram, comme Telegram Desktop. La session reste chiffrée sur cet ordinateur. Telegram l’affiche dans Paramètres › Appareils sous le nom OpenBot.",
  "connector.telegramAccount.howItWorksHost":
    "{host} se connecte à votre propre compte Telegram, comme Telegram Desktop. La session reste chiffrée sur {host}. Telegram l’affiche dans Paramètres › Appareils sous le nom OpenBot.",
  "connector.telegramAccount.signInProgress":
    "Suivez l’étape ci-dessous pour vous connecter. Annuler arrête la connexion.",
  "connector.telegramAccount.methodTitle": "Se connecter avec",
  "connector.telegramAccount.methodQrDescription": "Scannez un code avec Telegram sur votre téléphone.",
  "connector.telegramAccount.methodPhoneDescription":
    "Saisissez votre numéro de téléphone et le code que Telegram vous envoie.",
  "connector.telegramAccount.methodQr": "Code QR",
  "connector.telegramAccount.methodPhone": "Téléphone",
  "connector.telegramAccount.credentialsTitle": "api_id et api_hash",
  "connector.telegramAccount.credentialsStored":
    "OpenBot utilise votre propre application Telegram de my.telegram.org. Après la première connexion, cet ordinateur garde son api_id et son api_hash.",
  "connector.telegramAccount.credentialsStoredHost":
    "OpenBot utilise votre propre application Telegram de my.telegram.org. Après la première connexion, {host} garde son api_id et son api_hash.",
  "connector.telegramAccount.credentialsOpen": "Saisir",
  "connector.telegramAccount.credentialsHelp":
    "Connectez-vous à my.telegram.org, ouvrez API development tools et créez une application. Copiez ici son api_id et son api_hash.",
  "connector.telegramAccount.apiId": "api_id",
  "connector.telegramAccount.apiHash": "api_hash",
  "connector.telegramAccount.openApps": "Ouvrir my.telegram.org",
  "connector.telegramAccount.openAppsFailed": "OpenBot n’a pas pu ouvrir my.telegram.org.",
  "connector.telegramAccount.connect": "Connecter",
  "connector.telegramAccount.sendingOffNote":
    "Les agents peuvent seulement lire vos discussions tant que vous n’activez pas l’envoi.",
  "connector.telegramAccount.devicesNote":
    "Telegram affiche cette session dans Paramètres › Appareils sous le nom OpenBot. Si vous la fermez là, OpenBot se déconnecte.",
  "connector.telegramAccount.devicesNoteHost":
    "Telegram affiche cette session dans Paramètres › Appareils sous le nom OpenBot. Si vous la fermez là, {host} se déconnecte.",
  "connector.telegramAccount.connecting": "Connexion à Telegram",
  "connector.telegramAccount.connectingDescription":
    "Cet ordinateur communique avec Telegram. Cela peut prendre quelques secondes.",
  "connector.telegramAccount.connectingHost": "{host} communique avec Telegram. Cela peut prendre quelques secondes.",
  "connector.telegramAccount.qrLabel": "Code QR pour se connecter à Telegram",
  "connector.telegramAccount.qrTitle": "Scannez ce code avec Telegram sur votre téléphone",
  "connector.telegramAccount.qrStepOpen": "Ouvrez Telegram sur votre téléphone.",
  "connector.telegramAccount.qrStepDevices": "Allez dans Paramètres › Appareils › Associer un appareil de bureau.",
  "connector.telegramAccount.qrStepScan": "Pointez votre téléphone vers ce code.",
  "connector.telegramAccount.qrRefresh": "Le code change environ toutes les 30 secondes. Scannez le plus récent.",
  "connector.telegramAccount.usePhone": "Utiliser le téléphone",
  "connector.telegramAccount.phoneDescription":
    "Saisissez le numéro de téléphone de votre compte Telegram, avec l’indicatif du pays.",
  "connector.telegramAccount.phoneLabel": "Numéro de téléphone",
  "connector.telegramAccount.sendCode": "Envoyer le code",
  "connector.telegramAccount.phonePlaceholder": "+48 600 100 200",
  "connector.telegramAccount.useQr": "Utiliser un code QR",
  "connector.telegramAccount.codeViaApp":
    "Telegram a envoyé un code dans l’application Telegram de vos autres appareils.",
  "connector.telegramAccount.codeViaSms": "Telegram a envoyé un code par SMS.",
  "connector.telegramAccount.codeDescription": "Saisissez le code que Telegram vous a envoyé.",
  "connector.telegramAccount.codeLabel": "Code",
  "connector.telegramAccount.signIn": "Se connecter",
  "connector.telegramAccount.passwordDescription":
    "Votre compte utilise la validation en deux étapes. Saisissez son mot de passe.",
  "connector.telegramAccount.passwordHint": "Indice : {hint}",
  "connector.telegramAccount.passwordLabel": "Mot de passe de la validation en deux étapes",
  "connector.telegramAccount.accountTitle": "Compte",
  "connector.telegramAccount.accountDescription": "Les agents de cet ordinateur utilisent ce compte Telegram.",
  "connector.telegramAccount.accountDescriptionHost": "Les agents de {host} utilisent ce compte Telegram.",
  "connector.telegramAccount.sendingLabel":
    "Autoriser les agents à envoyer des messages et à marquer les discussions comme lues",
  "connector.telegramAccount.sendingDescription":
    "Si cette option est désactivée, les agents peuvent seulement lire vos discussions.",
} as const satisfies PartialTranslation<typeof source>;
