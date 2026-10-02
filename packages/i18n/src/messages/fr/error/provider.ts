import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.endpointsReadOnly":
    "Les points de terminaison enregistrés ont été écrits par une version plus récente d’OpenBot, ou le fichier est illisible. Mettez à jour OpenBot pour les modifier.",
  "error.provider.endpointNoSecureStorage":
    "Cet ordinateur n’a pas de stockage sécurisé : impossible d’enregistrer une clé d’API ou un en-tête. Supprimez-les, ou utilisez un point de terminaison sans identifiants.",
  "error.provider.endpointDuplicate":
    "Un point de terminaison avec cet ID de fournisseur est déjà enregistré. Supprimez-le d’abord, ou utilisez un autre ID.",
  "error.provider.endpointNotSaved": "Ce point de terminaison n’est pas enregistré. Actualisez la liste et réessayez.",
  "error.provider.endpointKeyForNewAddress":
    "L’adresse a un nouvel hôte ou un nouveau port. Saisissez de nouveau la clé d’API et les en-têtes, pour que ceux enregistrés ne lui soient pas envoyés.",
  "error.provider.endpointSecretUnreadable":
    "Cet ordinateur ne peut pas lire la clé d’API et les en-têtes enregistrés. Saisissez de nouveau la clé d’API et les en-têtes, pour qu’aucun ne soit perdu.",
  "error.provider.discoveryTimeout": "{host} n’a pas répondu à temps.",
  "error.provider.discoveryUnreachable": "OpenBot n’a pas pu se connecter à {host}.",
  "error.provider.discoveryRedirect": "{host} a envoyé une redirection. Saisissez l’adresse finale du serveur.",
  "error.provider.discoveryRefused": "{host} a refusé la requête. Vérifiez la clé d’API et les en-têtes.",
  "error.provider.discoveryHttp": "{host} a répondu avec HTTP {status}.",
  "error.provider.discoveryTooLarge": "La liste des modèles de {host} est trop volumineuse.",
  "error.provider.discoveryInvalid": "{host} n’a pas envoyé de liste de modèles compatible OpenAI.",
  "error.provider.detectionSettingsReadOnly":
    "Les réglages de détection ont été écrits par une version plus récente d’OpenBot, ou le fichier est illisible. Mettez à jour OpenBot pour les modifier.",
  "error.provider.detectionEntryInvalid":
    "Une adresse doit être une URL http:// ou https:// sans mot de passe, et un dossier doit être un chemin absolu.",
  "error.provider.detectionEntriesTooMany": "Il y a trop d’adresses ou de dossiers.",
  "error.provider.credentialFileUnreadable": "Le fichier d’identifiants du fournisseur est illisible.",
  "error.provider.credentialFileTooLarge": "Le fichier d’identifiants du fournisseur est trop volumineux.",
  "error.provider.archiveSpecialFile":
    "L’archive de l’environnement d’exécution contient un lien ou un fichier spécial.",
  "error.provider.archiveUnsafePath": "L’archive de l’environnement d’exécution contient un chemin non sûr.",
  "error.provider.runtimeSpecialFile": "L’environnement d’exécution contient un lien ou un fichier spécial.",
  "error.provider.codexArchivePath": "L’archive Codex contient un chemin inattendu.",
  "error.provider.codexVersionUnexpected": "Version inattendue de l’environnement d’exécution Codex.",
  "error.provider.claudeArchivePath": "L’archive Claude contient un chemin inattendu.",
  "error.provider.claudePackageMismatch":
    "Le paquet Claude ne correspond pas au catalogue des environnements d’exécution.",
  "error.provider.claudeChecksum": "La somme de contrôle de l’environnement d’exécution Claude ne correspond pas.",
  "error.provider.claudeLicenseChecksum": "La somme de contrôle de la licence Claude ne correspond pas.",
  "error.provider.opencodeArchivePath": "L’archive OpenCode contient un chemin inattendu.",
  "error.provider.opencodePackageMismatch":
    "Le paquet OpenCode ne correspond pas au catalogue des environnements d’exécution.",
  "error.provider.opencodeChecksum": "La somme de contrôle de l’environnement d’exécution OpenCode ne correspond pas.",
  "error.provider.opencodeLicenseChecksum": "La somme de contrôle de la licence OpenCode ne correspond pas.",
  "error.provider.grokChecksum": "La somme de contrôle de l’environnement d’exécution Grok ne correspond pas.",
  "error.provider.grokLicenseChecksum": "La somme de contrôle de la licence Grok ne correspond pas.",
  "error.provider.grokNoticesChecksum": "La somme de contrôle des mentions Grok ne correspond pas.",
  "error.provider.bunArchivePath": "L’archive Bun contient un chemin inattendu.",
  "error.provider.bunPackageMismatch": "Le paquet Bun ne correspond pas au catalogue des environnements d’exécution.",
  "error.provider.bunChecksum": "La somme de contrôle de l’environnement d’exécution Bun ne correspond pas.",
  "error.provider.bunLicenseChecksum": "La somme de contrôle de la licence Bun ne correspond pas.",
  "error.provider.bunxDamaged": "L’exécuteur du gestionnaire de paquets Bun est manquant ou endommagé.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot n’a pas pu joindre les sources de versions du fournisseur. Vérifiez la connexion et réessayez.",
  "error.provider.runtimesUnsupported":
    "Les environnements d’exécution des fournisseurs ne sont pas disponibles sur cette plateforme.",
  "error.provider.closing": "OpenBot se ferme.",
  "error.provider.cliOverride": "Supprimez le chemin CLI explicite avant de mettre à jour dans OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "La mise à jour de l’environnement d’exécution ne s’est pas terminée.",
  "error.provider.downloadHttp": "Le téléchargement de l’environnement d’exécution a échoué avec HTTP {status}.",
  "error.provider.downloadNoData": "Le téléchargement de l’environnement d’exécution n’a renvoyé aucune donnée.",
  "error.provider.downloadSize": "Le téléchargement de l’environnement d’exécution a une taille inattendue.",
  "error.provider.downloadIntegrity":
    "Le téléchargement de l’environnement d’exécution a échoué au contrôle d’intégrité.",
  "error.provider.runtimeReplacing":
    "Impossible d’installer l’environnement d’exécution, car une autre instance le remplace.",
  "error.provider.runtimeFilesInUse":
    "Impossible d’installer l’environnement d’exécution, car un autre programme a ses fichiers ouverts. Fermez-le et réessayez.",
  "error.provider.metadataHttp":
    "Le téléchargement des métadonnées de l’environnement d’exécution a échoué avec HTTP {status}.",
  "error.provider.metadataIntegrity":
    "Les métadonnées de l’environnement d’exécution ont échoué au contrôle d’intégrité.",
  "error.provider.diskSpace": "L’espace disque libre est insuffisant pour ce fournisseur.",
  "error.provider.unexpectedVersion": "L’environnement d’exécution du fournisseur a renvoyé une version inattendue.",
  "error.provider.metadataNoData":
    "Le téléchargement des métadonnées de l’environnement d’exécution n’a renvoyé aucune donnée.",
  "error.provider.metadataTooLarge": "Les métadonnées de l’environnement d’exécution sont trop volumineuses.",
  "error.provider.installRecordMismatch":
    "L’enregistrement d’installation de l’environnement d’exécution ne correspond pas.",
  "error.provider.runtimeChecksum":
    "La somme de contrôle de l’environnement d’exécution du fournisseur ne correspond pas.",
  "error.provider.codexReleaseShape": "La version Codex a une structure inattendue.",
  "error.provider.codexReleaseNoDownload": "La version Codex n’a aucun téléchargement vérifiable pour cet ordinateur.",
  "error.provider.claudeReleaseShape": "La version Claude a une structure inattendue.",
  "error.provider.grokReleaseVersion": "La version Grok a un numéro inattendu.",
  "error.provider.blockedListShape": "La liste des versions bloquées a une structure inattendue.",
  "error.provider.releaseNoDownload": "La version {name} n’a aucun téléchargement vérifiable.",
  "error.provider.releaseSizeUnknown": "Le téléchargement de la version n’a pas de taille connue.",
  "error.provider.releaseMetadataNotObject": "Les métadonnées de la version ne sont pas un objet JSON.",
  "error.provider.releaseCheckHttp": "La vérification des versions a échoué avec HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "Les métadonnées de la version sont trop volumineuses.",
  "error.provider.idInvalid":
    "Un ID de fournisseur ne peut contenir que des lettres minuscules, des chiffres, `-` ou `_`.",
  "error.provider.baseUrlInvalid": "L’URL de base n’est pas une URL.",
  "error.provider.baseUrlProtocol": "L’URL de base doit commencer par http:// ou https://.",
  "error.provider.baseUrlCredentials":
    "L’URL de base ne doit contenir ni nom d’utilisateur ni mot de passe. Mettez l’identifiant dans un en-tête.",
  "error.provider.modelsRequired": "Au moins un modèle est requis.",
  "error.provider.modelsTooMany": "Il y a trop de modèles.",
  "error.provider.modelIdCharacter": "Un ID de modèle contient un caractère inutilisable.",
  "error.provider.modelIdDuplicate": "Deux modèles ont le même ID.",
  "error.provider.headersTooMany": "Il y a trop d’en-têtes.",
  "error.provider.headerNameCharacter": "Un nom d’en-tête contient un caractère que HTTP n’autorise pas.",
  "error.provider.headerNameTooLong": "Un nom d’en-tête est trop long.",
  "error.provider.headerNameDuplicate": "Deux en-têtes ont le même nom.",
  "error.provider.headerValueInvalid": "Une valeur d’en-tête est manquante ou trop longue.",
  "error.provider.apiKeyTooLong": "La clé d’API est trop longue.",
  "error.provider.localOnly": "Les fournisseurs ne peuvent être modifiés que sur l’ordinateur qui exécute les agents.",
  "error.provider.keyRequired": "Une clé de fournisseur est requise.",
  "error.provider.keyTooLong": "La clé de fournisseur est trop longue.",
  "error.provider.noModel": "Le fournisseur sélectionné n’a aucun modèle disponible.",
  "error.provider.noModelNamed": "{provider} n’a aucun modèle disponible.",
  "error.provider.acpNoModels":
    "La CLI ACP n’a annoncé aucun modèle ACP. OpenBot ne choisira pas de modèle de secours au hasard.",
  "error.provider.endpointRemoveBusy":
    "Attendez la fin du tour actif et de la file d’attente avant de supprimer ce point de terminaison.",
  "error.provider.codexOutdated":
    "La CLI Codex {version} est trop ancienne. OpenBot nécessite la version 0.144.1 ou plus récente.",
  "error.provider.codexNotStarted": "La CLI Codex a été trouvée mais n’a pas pu démarrer.",
  "error.provider.codexNotStartedHint":
    "La CLI Codex a été trouvée mais n’a pas pu démarrer. Exécutez `codex --version` dans un nouveau terminal.",
  "error.provider.codexMissing": "ChatGPT n’est pas téléchargé. Téléchargez-le dans OpenBot pour continuer.",
  "error.provider.codexConfigIgnored": {
    one: "Codex a ignoré {count} paramètre de sa configuration : {settings}. Corrigez-le ou supprimez-le, ou mettez Codex à jour.",
    other:
      "Codex a ignoré {count} paramètres de sa configuration : {settings}. Corrigez-les ou supprimez-les, ou mettez Codex à jour.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    one: "Codex a ignoré {count} paramètre de sa configuration. Corrigez-le ou supprimez-le, ou mettez Codex à jour.",
    other:
      "Codex a ignoré {count} paramètres de sa configuration. Corrigez-les ou supprimez-les, ou mettez Codex à jour.",
  },
  "error.provider.claudeOutdated":
    "Claude Code {version} est trop ancien. OpenBot nécessite la version 2.1.232 ou plus récente.",
  "error.provider.claudeNotStarted": "La CLI Claude a été trouvée mais n’a pas pu démarrer.",
  "error.provider.claudeNotStartedHint":
    "La CLI Claude a été trouvée mais n’a pas pu démarrer. Exécutez `claude --version` dans un nouveau terminal.",
  "error.provider.claudeMissing": "Claude n’est pas téléchargé. Téléchargez-le dans OpenBot pour continuer.",
  "error.provider.grokOutdated":
    "La CLI Grok {version} est trop ancienne. OpenBot nécessite la version 1.0.5 ou plus récente.",
  "error.provider.grokNotStarted": "La CLI Grok a été trouvée mais n’a pas pu démarrer.",
  "error.provider.grokNotStartedHint":
    "La CLI Grok a été trouvée mais n’a pas pu démarrer. Exécutez `grok --version` dans un nouveau terminal.",
  "error.provider.grokMissing": "Grok n’est pas téléchargé. Téléchargez-le dans OpenBot pour continuer.",
  "error.provider.opencodeNotStarted": "OpenCode n’a pas pu démarrer. Exécutez `opencode --version` dans un terminal.",
  "error.provider.opencodeMissing": "OpenCode n’est pas téléchargé. Téléchargez-le dans OpenBot pour continuer.",
  "error.provider.codexVersionUnreadable": "Impossible de lire la version de la CLI Codex.",
  "error.provider.claudeVersionUnreadable": "Impossible de lire la version de la CLI Claude.",
  "error.provider.grokVersionUnreadable": "Impossible de lire la version de la CLI Grok.",
  "error.provider.opencodeVersionUnreadable": "Impossible de lire la version de la CLI OpenCode.",
  "error.provider.bunVersionUnreadable": "Impossible de lire la version de l’environnement d’exécution Bun.",
  "error.provider.connectBeforeProfile": "Connectez le fournisseur sélectionné avant de générer un profil.",
  "error.provider.cliNotReady": "La CLI {provider} n’est pas prête ou n’est pas connectée.",
  "error.provider.noCodeSignIn": "{provider} ne permet pas de se connecter avec un code.",
  "error.provider.codeLoginNoLink": "Le fournisseur n’a pas affiché de lien de connexion. Réessayez.",
  "error.provider.codeLoginNotWaiting": "Aucune connexion n’attend de code. Relancez la connexion.",
  "error.provider.codeLoginBadCode": "Collez le code affiché par la page de connexion.",
  "error.provider.codeLoginRefused": "Le fournisseur n’a pas accepté le code. Relancez la connexion.",
  "error.provider.codeLoginUnsupported":
    "Ce serveur ne peut pas se connecter avec un code collé. Connectez-vous sur l’ordinateur du serveur, dans son navigateur.",
  "error.provider.cliBusyRetry": "La CLI {provider} traite un tour. Attendez la fin, puis réessayez.",
  "error.provider.cliSigningIn":
    "La CLI {provider} est en cours de connexion. Terminez ou annulez la connexion, puis mettez à jour.",
  "error.provider.cliBusyUpdate": "La CLI {provider} traite un tour. Attendez la fin, puis mettez à jour.",
  "error.provider.cliSelectFailed": "OpenBot n’a pas pu sélectionner la CLI gérée installée.",
  "error.provider.noAuthenticatedAccount": "{provider} n’a renvoyé aucun compte authentifié.",
  "error.provider.cliActivateFailed": "OpenBot n’a pas pu activer la CLI gérée.",
  "error.provider.cliBusyReconnect": "La CLI {provider} traite un tour. Attendez la fin, puis reconnectez-vous.",
  "error.provider.opencodeServiceFailure":
    "OpenCode n’a pas pu terminer ce tour, car son service local a échoué. Réessayez. Si l’erreur continue, reconnectez OpenCode dans les réglages.",
  "error.provider.opencodeRateLimited":
    "Le fournisseur du modèle a refusé la requête à cause de sa limite de débit. Attendez quelques minutes ou choisissez un autre modèle, puis réessayez.\n{detail}",
  "error.provider.opencodeBilling":
    "Le fournisseur du modèle a refusé la requête à cause de la facturation du compte. Attendre ne corrige pas ce problème. Ajoutez un moyen de paiement ou des fonds dans le compte du fournisseur, ou choisissez un autre modèle.\n{detail}",
  "error.provider.opencodeProviderFailed":
    "Le fournisseur du modèle a échoué de son côté. Votre connexion n’en est pas la cause. Réessayez plus tard ou choisissez un autre modèle.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode n’a pas pu se connecter au fournisseur du modèle. Vérifiez la connexion réseau de l’ordinateur qui exécute OpenBot, puis réessayez.\n{detail}",
  "error.provider.chatgptPageFailed": "OpenBot n’a pas pu ouvrir la page de connexion ChatGPT.",
  "error.provider.noneReady": "Aucun fournisseur d’agent n’est prêt.",
  "error.provider.claudeTurnActive": "Attendez la fin du tour Claude actif avant d’actualiser son contexte.",
  "error.provider.codexLoginRequired":
    "Codex nécessite une connexion avec un abonnement ChatGPT. Exécutez `codex login`.",
  "error.provider.cliUpdateFailed": "OpenBot n’a pas pu mettre à jour la CLI {provider}. {reason}",
  "error.provider.tryAgain": "Réessayez.",
  "error.provider.noAgentProcess": "{provider} n’a aucun processus en cours pour cet agent.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} s’est arrêté avant le démarrage du processus de l’agent.",
  "error.provider.archiveUnreadable":
    "L’archive de l’environnement d’exécution est illisible ou utilise un format non pris en charge.",
  "error.provider.antigravityArchivePath": "L’archive Gemini contient un fichier inattendu.",
  "error.provider.antigravityChecksum": "La somme de contrôle de l’environnement d’exécution Gemini ne correspond pas.",
  "error.provider.antigravityReleaseShape": "La version Gemini a une forme inattendue.",
  "error.provider.antigravityMissing": "Gemini n’est pas téléchargé. Téléchargez-le dans OpenBot pour continuer.",
  "error.provider.antigravityNotStarted": "Le serveur Gemini a été trouvé, mais sa version est illisible.",
  "error.provider.antigravityVersionUnreadable": "Impossible de lire la version du serveur Gemini.",
  "error.provider.antigravitySignIn": "Connectez-vous avec Google pour utiliser Gemini.",
  "error.provider.cursorArchivePath": "L’archive Cursor contient un fichier inattendu.",
  "error.provider.cursorChecksum": "La somme de contrôle de l’environnement d’exécution Cursor ne correspond pas.",
  "error.provider.cursorReleaseShape": "La version Cursor a une forme inattendue.",
  "error.provider.cursorMissing": "Cursor n’est pas téléchargé. Téléchargez-le dans OpenBot pour continuer.",
  "error.provider.cursorNotStarted": "L’agent Cursor a été trouvé, mais sa version est illisible.",
  "error.provider.cursorVersionUnreadable": "Impossible de lire la version de l’agent Cursor.",
  "error.provider.cursorSignIn": "Connectez-vous avec Cursor ou définissez CURSOR_API_KEY pour utiliser Cursor.",
  "error.provider.foreignReasoning":
    "{provider} n’a pas accepté le raisonnement précédent de cette conversation, car un autre compte ou une autre clé API l’a reçu. OpenBot a ouvert une nouvelle session {provider} avec l’historique de la conversation. Réessayez.",
  "error.provider.grokSignIn": "Exécutez `grok login` ou définissez XAI_API_KEY pour utiliser Grok.",
  "error.provider.acpSignInTimedOut": "La connexion a expiré.",
  "error.provider.acpSignInStopped": "La connexion s’est arrêtée avant la fin.",
  "error.provider.acpSignInFailed": "La connexion n’a pas abouti.",
  "error.provider.messageTooLarge": "OpenBot a arrêté {provider}, car il a envoyé un message de plus de {limit} Mo.",
  "error.provider.customAgentIdInvalid":
    "Un ID d’agent ne peut contenir que des lettres minuscules, des chiffres ou `-`, et ne peut pas être l’ID d’un fournisseur intégré.",
  "error.provider.customAgentEnvInvalid":
    "Un nom de variable ne peut contenir que des lettres, des chiffres ou `_`, et ne doit pas commencer par un chiffre. Utilisez chaque nom une seule fois, 16 noms au plus.",
  "error.provider.customAgentCommandInvalid":
    "La commande doit être un chemin complet, un chemin qui commence par ~/, ou un nom de commande sans espaces.",
  "error.provider.customAgentArgsInvalid":
    "Un argument ne peut pas contenir de saut de ligne. Utilisez au plus 32 arguments.",
  "error.provider.customAgentWindowsScript":
    "Une commande .cmd ou .bat n’accepte que des lettres, des chiffres et - _ . , : = @ + / \\ dans ses arguments.",
  "error.provider.customAgentNotFound": "OpenBot ne trouve pas {command}. Saisissez le chemin complet de la commande.",
  "error.provider.customAgentCheckTimedOut": "L’agent n’a pas répondu en 20 secondes.",
  "error.provider.customAgentCheckStopped": "L’agent s’est arrêté avant de répondre.",
  "error.provider.customAgentProtocolVersion":
    "L’agent utilise la version {version} d’ACP. OpenBot utilise la version 1.",
  "error.provider.customAgentCheckFailed": "L’agent n’a pas répondu comme un agent ACP.",
  "error.provider.customAgentRemoveBusy":
    "Attendez la fin du tour actif et de la file d’attente avant de supprimer cet agent personnalisé.",
  "error.provider.customAgentNone": "Aucun agent personnalisé n’est enregistré.",
  "error.provider.customAgentMissing": "Cet agent personnalisé n’est plus enregistré. Choisissez un autre modèle.",
  "error.provider.customAgentSignIn": "Connectez-vous avec la commande propre à l’agent, puis réessayez.",
  "error.provider.customAgentsReadOnly":
    "Les agents personnalisés enregistrés ont été écrits par une version plus récente d’OpenBot, ou le fichier est illisible. Mettez à jour OpenBot pour les modifier.",
  "error.provider.customAgentNoSecureStorage":
    "Cet ordinateur n’a pas de stockage sécurisé : impossible d’enregistrer les valeurs d’environnement. Supprimez-les et réessayez.",
  "error.provider.customAgentNotSaved":
    "Cet agent personnalisé n’est pas enregistré. Actualisez la liste et réessayez.",
  "error.provider.customAgentTooMany": "Vous pouvez enregistrer au plus {count} agents personnalisés.",
  "error.provider.customAgentEnvValueMissing": "Saisissez une valeur pour {name}.",
} as const satisfies PartialTranslation<typeof source>;
