import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Code",
  "marketplace.category.design": "Design",
  "marketplace.category.dataAnalytics": "Données et analyse",
  "marketplace.category.documents": "Documents",
  "marketplace.category.productivity": "Productivité",
  "marketplace.category.research": "Recherche",
  "marketplace.category.automation": "Automatisation",
  "marketplace.category.other": "Autre",
  "marketplace.loadFailed": "Impossible de charger la Marketplace.",
  "marketplace.loading.skills": "Chargement des compétences",
  "marketplace.loading.agents": "Chargement des agents",
  "marketplace.noMatch.skills": "Aucune compétence ne correspond à cette recherche.",
  "marketplace.noMatch.agents": "Aucun agent ne correspond à cette recherche.",
  "marketplace.loadMore": "Charger plus",
  "marketplace.version": "Version {version}",

  "marketplace.title": "Marketplace",
  "marketplace.kinds": "Types de contenu de la Marketplace",
  "marketplace.tab.agents": "Agents",
  "marketplace.tab.skills": "Compétences",
  "marketplace.description.apps": "Connectez les outils et les services avec lesquels vos agents travaillent.",
  "marketplace.description.agents": "Des agents prêts à l’emploi, avec leurs propres instructions et compétences.",
  "marketplace.description.skills": "Des instructions qui apprennent une tâche ou un outil à un agent.",

  "marketplace.plugins.missing": "Ce plugin n’est pas dans le catalogue OpenBot.",

  "marketplace.agents.loadingDetail": "Chargement des détails de l’agent…",
  "marketplace.agents.skills": "Compétences",
  "marketplace.agents.routines": "Routines",
  "marketplace.agents.routineInactive": "Inactive",
  "marketplace.agents.by": "par {name}",
  "marketplace.agents.routineCount": { one: "{count} routine", other: "{count} routines" },
  "marketplace.agents.yours": "Vos agents",
  "marketplace.agents.all": "Tous les agents",
  "marketplace.agents.missing": "Cet agent n’est pas dans la Marketplace.",
  "marketplace.agents.trust.reviewed":
    "Créé par un autre utilisateur d’OpenBot. OpenBot l’a examiné avant sa publication.",
  "marketplace.agents.trust.reviewedBeforeAdd":
    "Créé par un autre utilisateur d’OpenBot. OpenBot l’a examiné avant sa publication. Une fois ajouté, il peut agir en votre nom.",
  "marketplace.agents.trust.pending": "Partagé par son créateur avant l’examen d’OpenBot.",
  "marketplace.agents.trust.pendingBeforeAdd":
    "Partagé par son créateur avant l’examen d’OpenBot. Une fois ajouté, il peut agir en votre nom.",
  "marketplace.agents.source.pending": "Pas encore examiné",

  "marketplace.skill.loading": "Chargement de la compétence",
  "marketplace.try.readFailed": "OpenBot n’a pas pu lire les compétences de cet agent. Réessayez.",
  "marketplace.try.enable": "Activez cette compétence dans les réglages de l’agent pour l’essayer.",
  "marketplace.try.repair": "Réparez cette compétence dans les réglages de l’agent pour l’essayer.",
  "marketplace.try.update": "Mettez à jour cette compétence pour essayer cette version.",
  "marketplace.try.composerUnavailable": "La zone de message de l’agent n’est pas disponible.",

  "marketplace.open": "Ouvrir {name}",
  "marketplace.tab.apps": "Apps",
  "marketplace.crumbs.label": "Emplacement",
  "marketplace.search.label": "Rechercher dans la Marketplace",
  "marketplace.search.placeholder": "Rechercher",
  "marketplace.installs": { one: "{installs} installation", other: "{installs} installations" },
  "marketplace.filter.clear": "Effacer les filtres",
  "marketplace.noMatch.apps": "Aucune app ne correspond à cette recherche.",
  "marketplace.noMatch.filters": "Aucun résultat ne correspond aux filtres.",
  "marketplace.noMatch.showAgents": { one: "Afficher {count} agent", other: "Afficher {count} agents" },
  "marketplace.noMatch.showApps": { one: "Afficher {count} app", other: "Afficher {count} apps" },
  "marketplace.noMatch.showSkills": { one: "Afficher {count} compétence", other: "Afficher {count} compétences" },
  "marketplace.empty.agents": "La Marketplace ne contient encore aucun agent.",
  "marketplace.empty.apps": "La Marketplace ne contient encore aucune app.",
  "marketplace.empty.skills": "La Marketplace ne contient encore aucune compétence.",
  "marketplace.properties.creator": "Créateur",
  "marketplace.properties.category": "Catégorie",
  "marketplace.properties.version": "Version",
  "marketplace.properties.updated": "Mise à jour",
  "marketplace.properties.installs": "Installations",

  "marketplace.agent.add": "Ajouter",
  "marketplace.agent.addNamed": "Ajouter {name}",
  "marketplace.agent.addAgent": "Ajouter un agent",
  "marketplace.agent.added": "Ajouté",
  "marketplace.agent.updateAvailable": "Mise à jour disponible",
  "marketplace.agent.update": "Mettre à jour",
  "marketplace.agent.openChat": "Ouvrir la discussion",

  "marketplace.app.connect": "Connecter",
  "marketplace.app.reconnect": "Reconnecter",
  "marketplace.app.connectNamed": "Connecter {name}",
  "marketplace.app.reconnectNamed": "Reconnecter {name}",
  "marketplace.app.connected": "Connecté",
  "marketplace.app.attention": "Action requise",
  "marketplace.app.partialTitle": "{name} n’est pas complet",
  "marketplace.app.partialDescription":
    "Certaines de ses apps ou compétences ne sont pas installées. Reconnecter les installe.",
  "marketplace.app.notConnected": "Non connecté",
  "marketplace.app.custom": "Serveur MCP",
  "marketplace.app.githubTagline": "Dépôts, tickets et pull requests",
  "marketplace.app.onePasswordTagline": "Connectez-vous aux sites avec les identifiants que vous partagez",
  "marketplace.app.slackTagline": "Mentions et messages directs dans Slack",
  "marketplace.app.discordTagline": "Mentions et messages directs dans Discord",
  "marketplace.app.telegramTagline": "Groupes et discussions privées dans Telegram",
  "marketplace.app.whatsappTagline": "Votre propre discussion et les personnes que vous autorisez dans WhatsApp",
  "marketplace.app.bitwardenTagline": "Connectez-vous aux sites avec les identifiants d’un dossier partagé",
  "marketplace.app.protonPassTagline": "Connectez-vous aux sites avec les identifiants d’un coffre partagé",
  "marketplace.app.onePasswordCategory": "Gestion des identifiants et des connexions",
  "marketplace.app.yourApps": "Vos apps",
  "marketplace.app.addCustom": "Ajout personnalisé",
  "marketplace.app.server": "Serveur",
  "marketplace.app.command": "Commande",
  "marketplace.app.address": "Adresse",
  "marketplace.app.disconnect.title": "Déconnecter {name}",
  "marketplace.app.disconnect.description":
    "Supprimer {name} et ses compétences de cet ordinateur. Vous pourrez le connecter à nouveau plus tard.",
  "marketplace.app.disconnect.action": "Déconnecter",
  "marketplace.app.remove.title": "Supprimer le serveur",
  "marketplace.app.remove.description": "Vos agents ne peuvent plus utiliser ce serveur. Ses réglages sont supprimés.",
  "marketplace.app.remove.action": "Supprimer",
  "marketplace.app.remove.confirmTitle": "Supprimer {name} ?",
  "marketplace.app.remove.keep": "Conserver",
  "marketplace.app.connection": "Connexion",
  "marketplace.app.access.use": "Peut utiliser",
  "marketplace.app.access.noAgents": "Aucun agent",
  "marketplace.app.access.agentsOf": "Agents qui peuvent utiliser {name}",
  "marketplace.app.access.chooseAgents": "{name} : {summary}. Choisir les agents",
  "marketplace.app.access.level": "Accès de {role} à {name}",
  "marketplace.app.setup.account": "Connectez-vous avec votre compte {name} dans le navigateur.",
  "marketplace.app.setup.key": "Nécessite une clé API de votre compte {name}.",
  "marketplace.app.setup.keySaved": "{field} est enregistré sur {host}.",
  "marketplace.app.account.removeDescription": "OpenBot supprime la connexion de ce compte sur {host}.",
  "marketplace.app.setup.desktop": "S’exécute dans l’app de bureau {name} à l’adresse {address}.",
  "marketplace.app.setup.desktopConnected": "Connecté à {address}.",
  "marketplace.app.setup.open": "Aucune connexion ni clé requise.",
  "marketplace.app.blocked.update":
    "{host} utilise une ancienne version d’OpenBot qui ne peut pas connecter d’apps. Mettez à jour OpenBot sur {host}, ou demandez à son propriétaire de le faire.",
  "marketplace.app.blocked.member":
    "Seul un propriétaire ou un admin de {host} peut y connecter des apps. Demandez-lui de connecter {name}, ou de mettre à jour OpenBot sur {host} pour que les membres puissent connecter des apps.",
  "marketplace.app.connectAgain": "Reconnecter",
  "marketplace.app.automation.askOnInstall": "Demander l’accès à macOS à l’installation",
  "marketplace.app.automation.title": "Accès aux apps Apple",
  "marketplace.app.automation.description":
    "macOS affiche une demande pour chaque app. Une app fermée s’ouvre un instant, puis se ferme.",
  "marketplace.app.automation.request": "Demander l’accès",
  "marketplace.app.automation.allowed": "OpenBot peut maintenant contrôler toutes les apps Apple.",
  "marketplace.app.automation.refused":
    "macOS n’a pas donné l’accès à {apps}. Autorisez OpenBot dans Réglages Système › Confidentialité et sécurité › Automatisation.",
  "marketplace.app.automation.failed": "OpenBot n’a pas pu interroger macOS pour {apps}. Réessayez.",
  "marketplace.app.automation.app.calendar": "Calendrier",
  "marketplace.app.automation.app.contacts": "Contacts",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Notes",
  "marketplace.app.automation.app.reminders": "Rappels",
  "marketplace.app.automation.app.messages": "Messages",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "Reconnectez-vous à {name}",
  "marketplace.app.signInDescription":
    "{name} a refusé la connexion enregistrée. Vos agents ne peuvent pas l’utiliser tant que vous ne vous reconnectez pas.",

  "marketplace.plugin.aave.tagline": "Données et transactions Aave",
  "marketplace.plugin.aave.description":
    "Aave permet d’explorer les marchés Aave V3 et V4 en direct, de consulter les positions d’un portefeuille et la gouvernance de la DAO, de simuler des opérations de prêt et de préparer des transactions non custodiales. Chaque transaction est renvoyée non signée : le plugin lit les marchés et écrit l’appel, et le portefeuille reste entre les mains de l’utilisateur.",
  "marketplace.plugin.aave.app":
    "Marchés V3 et V4 en direct, positions de portefeuille, gouvernance de la DAO et transactions préparées, via un seul serveur MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield":
    "Où puis-je obtenir le meilleur rendement sur les stablecoins dans Aave en ce moment ?",
  "marketplace.plugin.aave.prompt.usdcRates":
    "Lequel rapporte le plus sur l’USDC en ce moment, Aave V3 ou V4 sur Ethereum ?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Quel est le facteur de santé de 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, et à quelle distance est-il de la liquidation ?",
  "marketplace.plugin.canva.tagline": "Designs, ressources et exports",
  "marketplace.plugin.canva.description":
    "Canva permet de créer et de modifier des designs avec des mots, de rechercher dans sa propre bibliothèque de designs, d’importer et d’organiser des ressources, d’exporter au format qu’un canal demande et de laisser des commentaires là où se trouve le travail. Chaque utilisateur se connecte à son propre compte Canva, et l’agent peut faire ce que ce compte peut faire.",
  "marketplace.plugin.canva.app":
    "Création et modification de designs, recherche dans la bibliothèque, gestion des ressources et de la marque, exports et commentaires, via un seul serveur MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Montrez-moi mon design Canva modifié le plus récemment.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Redimensionnez mon affiche de lancement pour Instagram et exportez les deux en PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Transformez ces notes de version en une présentation Canva de six diapositives.",
  "marketplace.plugin.linear.tagline": "Tickets et tri des projets",
  "marketplace.plugin.linear.description":
    "Linear permet aux agents de lister les tickets assignés, de trier le backlog, de mettre à jour les statuts et de rédiger de nouveaux tickets dans l’espace de travail du compte connecté. Chaque utilisateur se connecte à son propre compte Linear dans le navigateur.",
  "marketplace.plugin.linear.app":
    "Recherche de tickets, tri, mises à jour de statut et création de tickets, via le serveur MCP de Linear avec connexion dans le navigateur.",
  "marketplace.plugin.linear.prompt.myWeek": "Qu’est-ce qui m’est assigné cette semaine ?",
  "marketplace.plugin.linear.prompt.backlog":
    "Triez le backlog : qu’est-ce qui est obsolète, bloqué ou sans responsable ?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Créez un ticket pour le plantage dans la file de synchronisation, avec les étapes de reproduction.",
  "marketplace.plugin.notion.tagline": "Documents et base de connaissances",
  "marketplace.plugin.notion.description":
    "Notion permet aux agents de lire et d’écrire des pages, de rechercher dans l’espace de travail et de garder les notes de réunion et les spécifications là où l’équipe travaille déjà. Chaque utilisateur se connecte à son propre compte Notion dans le navigateur.",
  "marketplace.plugin.notion.app":
    "Recherche, lecture et écriture de pages, et navigation dans l’espace de travail, via le serveur MCP de Notion avec connexion dans le navigateur.",
  "marketplace.plugin.notion.prompt.findSpec":
    "Trouvez la spécification de lancement actuelle et résumez les questions ouvertes.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Transformez ces puces en une note de réunion structurée dans l’espace de mon équipe.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Mettez à jour le document d’intégration avec la nouvelle liste de contrôle de version.",
  "marketplace.plugin.cobrain.tagline": "Une mémoire partagée pour vos agents IA",
  "marketplace.plugin.cobrain.description":
    "Cobrain est une mémoire Markdown que chaque IA connectée peut lire et modifier. Les agents chargent le contexte d’un client ou d’un projet avant de travailler, recherchent des notes et des décisions passées, et enregistrent ce qu’ils apprennent pour que la conversation suivante reprenne là où la précédente s’est arrêtée. Chaque utilisateur se connecte à son propre compte Cobrain.",
  "marketplace.plugin.cobrain.app":
    "Lecture, recherche et écriture de notes dans votre cerveau Cobrain, via un serveur MCP.",
  "marketplace.plugin.cobrain.prompt.startSession": "Chargez mon contexte Cobrain pour ce projet avant de commencer.",
  "marketplace.plugin.cobrain.prompt.searchDecision":
    "Cherchez dans mes notes Cobrain ce que nous avons décidé pour les prix.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Enregistrez dans Cobrain une note avec ce que nous avons fait aujourd’hui et ce qui reste.",
  "marketplace.plugin.honcho.tagline": "Votre mémoire dans tous vos outils d'IA",
  "marketplace.plugin.honcho.description":
    "Honcho, de Plastic Labs, donne aux agents une mémoire à long terme de vous que d'autres outils d'IA connectés peuvent partager. Les agents enregistrent ce qu'ils apprennent, et Honcho raisonne dessus pour construire un modèle de vos préférences, objectifs et façons de travailler. Les agents l'interrogent avant de commencer. Les agents OpenBot ont aussi leur propre mémoire ; Honcho est la mémoire qui vous suit dans d'autres outils. Les messages que les agents enregistrent vont sur votre compte Honcho.",
  "marketplace.plugin.honcho.app":
    "Enregistrez et interrogez une mémoire à long terme dans vos espaces de travail Honcho via un seul serveur MCP.",
  "marketplace.plugin.honcho.prompt.recall":
    "Avant de commencer, demande à Honcho ce qu'il sait de ma façon de travailler.",
  "marketplace.plugin.honcho.prompt.save": "Enregistre dans Honcho les décisions de ce fil.",
  "marketplace.plugin.honcho.prompt.preferences":
    "Que dit Honcho de mon style d'écriture ? Utilise-le pour ce brouillon.",
  "marketplace.plugin.honcho.hint.apiKey": "Créez une clé sur app.honcho.dev.",
  "marketplace.plugin.hindsight.tagline": "Une mémoire qui apprend avec le temps",
  "marketplace.plugin.hindsight.description":
    "Hindsight, de Vectorize, donne aux agents une mémoire à long terme dans Hindsight Cloud. Les agents retiennent des faits et des événements, les retrouvent par sens, par date et par entité, et y réfléchissent pour former des modèles mentaux. Les souvenirs sont rangés dans des banques, et les agents peuvent créer une banque pour chaque projet ou personne. Les agents OpenBot ont aussi leur propre mémoire ; Hindsight est la mémoire que d'autres outils d'IA connectés peuvent partager. Ce que les agents retiennent va sur votre compte Hindsight Cloud.",
  "marketplace.plugin.hindsight.app":
    "Retenez, retrouvez et analysez des souvenirs dans vos banques Hindsight Cloud via un seul serveur MCP.",
  "marketplace.plugin.hindsight.prompt.recall":
    "Avant de commencer, retrouve dans Hindsight ce que nous savons de ce projet.",
  "marketplace.plugin.hindsight.prompt.retain":
    "Retiens dans Hindsight les décisions et les questions ouvertes de ce fil.",
  "marketplace.plugin.hindsight.prompt.reflect":
    "Réfléchis à mes souvenirs Hindsight : quelles tendances vois-tu dans mon travail du mois dernier ?",
  "marketplace.plugin.hindsight.hint.apiKey": "Créez une clé sur la page Connect de Hindsight Cloud.",
  "marketplace.plugin.figma.tagline": "Designs et prototypes",
  "marketplace.plugin.figma.description":
    "Figma permet aux agents de lire des fichiers de design, d’inspecter les composants, les styles et les variables, et de transmettre les spécifications de production aux développeurs. Il se connecte au serveur MCP de l’app de bureau Figma, sur cet ordinateur. Le serveur peut seulement lire les designs ; la prise en charge de l’écriture est en cours.",
  "marketplace.plugin.figma.app":
    "Contexte de design, métadonnées, variables et captures d’écran, via le serveur MCP de l’app de bureau Figma. Lecture seule pour l’instant.",
  "marketplace.plugin.figma.prompt.handoff":
    "Préparez la transmission du fichier de paiement : listez les écrans, les composants et les styles.",
  "marketplace.plugin.figma.prompt.audit":
    "Vérifiez ce fichier pour trouver les espacements et les couleurs incohérents.",
  "marketplace.plugin.figma.prompt.assets": "Extrayez les icônes marketing en 2x pour le bundle de l’app.",
  "marketplace.plugin.paper.tagline": "Canevas de design basé sur HTML et CSS",
  "marketplace.plugin.paper.description":
    "Paper permet aux agents de lire et d’écrire le fichier de design ouvert dans Paper Desktop : inspecter les plans de travail, les sélections, les styles calculés, le JSX et les tokens, et créer ou modifier des cadres, du texte et des styles. Installez Paper Desktop, ouvrez-le une fois et ouvrez un fichier avant de commencer. OpenBot démarre la CLI Paper que Paper Desktop installe. Paper ne demande aucune clé. Les outils d’écriture modifient le fichier ouvert : vérifiez chaque écriture avant de l’approuver.",
  "marketplace.plugin.paper.app":
    "Lit et écrit le fichier Paper Desktop ouvert, via le serveur MCP local que la CLI Paper relaie. Demande Paper Desktop avec un fichier ouvert.",
  "marketplace.plugin.paper.prompt.implement":
    "Implémentez le cadre Paper sélectionné dans ce code, avec nos conventions de code.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Utilisez les styles de ce dépôt et concevez une page de réglages dans Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Listez les tokens de design du fichier Paper ouvert et comparez-les avec notre thème.",
  "marketplace.plugin.higgsfield.tagline": "Images, vidéos et audio par IA",
  "marketplace.plugin.higgsfield.description":
    "Higgsfield permet aux agents de générer des images, des vidéos, des personnages et de l'audio avec des modèles Higgsfield comme Seedance, Kling, Veo et MiniMax Hailuo, de consulter le solde de crédits et de parcourir l'Asset Library. Les résultats sont enregistrés dans les Assets Higgsfield de l'utilisateur. Chaque utilisateur se connecte à son propre compte Higgsfield dans le navigateur. Chaque génération utilise des crédits de ce compte au tarif standard, même avec un forfait illimité.",
  "marketplace.plugin.higgsfield.app":
    "Génération d'images, de vidéos et d'audio, personnages, crédits et assets, via le serveur MCP de Higgsfield avec connexion dans le navigateur.",
  "marketplace.plugin.higgsfield.prompt.credits": "Combien de crédits Higgsfield me reste-t-il ?",
  "marketplace.plugin.higgsfield.prompt.productShot":
    "Crée avec Higgsfield une photo produit d'une tasse en céramique sur une table en bois.",
  "marketplace.plugin.higgsfield.prompt.clip":
    "Crée avec Higgsfield une vidéo de 5 secondes de vagues au coucher du soleil.",
  "marketplace.plugin.sunra.tagline": "Images, vidéos, audio et 3D par IA",
  "marketplace.plugin.sunra.description":
    "Sunra permet aux agents de créer des images, des vidéos, de l'audio et des modèles 3D avec des modèles comme GPT Image, Nano Banana, Seedream, FLUX, Seedance, Kling et Veo, de consulter le solde de crédits et de récupérer les résultats. Les résultats sont enregistrés dans un projet du compte Sunra de l'utilisateur. Chaque utilisateur se connecte à son propre compte Sunra dans le navigateur. Sunra indique d'abord le coût de chaque génération et ne dépense les crédits de ce compte qu'après confirmation.",
  "marketplace.plugin.sunra.app":
    "Génération d'images, de vidéos, d'audio et de 3D, crédits et résultats, via le serveur MCP de Sunra avec connexion dans le navigateur.",
  "marketplace.plugin.sunra.prompt.balance": "Combien de crédits Sunra me reste-t-il ?",
  "marketplace.plugin.sunra.prompt.poster":
    "Crée avec Sunra une affiche d'un marché de nuit sous la pluie, au format portrait.",
  "marketplace.plugin.sunra.prompt.clip":
    "Crée avec Sunra une vidéo de 5 secondes d'un bateau en papier sur une rivière. Donne-moi d'abord le coût.",
  "marketplace.plugin.elevenlabs.tagline": "Parole, voix et agents vocaux",
  "marketplace.plugin.elevenlabs.description":
    "ElevenLabs permet aux agents de convertir du texte en parole, de travailler avec des voix, et de créer, tester et examiner des agents vocaux ElevenLabs et leurs conversations. L'audio généré revient sous forme de lien de téléchargement de courte durée. Chaque utilisateur se connecte à son propre compte ElevenLabs dans le navigateur, et chaque génération utilise des crédits de ce compte.",
  "marketplace.plugin.elevenlabs.app":
    "Synthèse vocale, voix et gestion des agents vocaux, via le serveur MCP d'ElevenLabs avec connexion dans le navigateur.",
  "marketplace.plugin.elevenlabs.prompt.speech":
    "Lis ce paragraphe à voix haute avec une voix calme d'ElevenLabs et donne-moi l'audio.",
  "marketplace.plugin.elevenlabs.prompt.agents": "Liste mes agents vocaux ElevenLabs et la voix utilisée par chacun.",
  "marketplace.plugin.elevenlabs.prompt.conversations":
    "Résume les dix dernières conversations de mon agent vocal d'assistance.",
  "marketplace.plugin.appleApps.tagline": "Mail, Calendrier et plus sur votre Mac",
  "marketplace.plugin.appleApps.description":
    "Apple apps permet aux agents d’utiliser Mail, Calendrier, Contacts, Rappels, Notes, Messages et Safari sur ce Mac. Il fonctionne uniquement sous macOS. OpenBot démarre mcp-icloud, un serveur communautaire qui n’est fait ni par Apple ni par OpenBot. Le serveur contrôle les apps via AppleScript, sur cet ordinateur, et ne demande ni compte ni clé. À l’installation, OpenBot peut demander à macOS l’accès à toutes ces apps en une fois, avec une demande par app. Sinon, macOS demande la première fois qu’un agent utilise une app. Pour changer ce choix plus tard, ouvrez Réglages Système › Confidentialité et sécurité › Automatisation. Les agents peuvent envoyer des e-mails et des iMessages, et modifier ou supprimer des événements, des contacts et des rappels : vérifiez chaque écriture avant de l’approuver. Ce que les outils lisent, comme le texte des e-mails, est envoyé au fournisseur du modèle de l’agent.",
  "marketplace.plugin.appleApps.app":
    "Mail, Calendrier, Contacts, Rappels, Notes, Messages et Safari, via le serveur local mcp-icloud. Demande macOS et l’accès Automatisation.",
  "marketplace.plugin.appleApps.prompt.unread": "Résumez mes e-mails non lus d’aujourd’hui dans Apple Mail.",
  "marketplace.plugin.appleApps.prompt.today": "Qu’y a-t-il dans mon Calendrier Apple aujourd’hui et demain ?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Trouvez le dernier e-mail sur la réunion du projet et ajoutez la réunion à mon calendrier.",
  "marketplace.plugin.sentry.tagline": "Erreurs et tri des plantages",
  "marketplace.plugin.sentry.description":
    "Sentry permet aux agents de rechercher les erreurs récentes, d’inspecter les traces de pile et les versions touchées, et de résumer ce qui a cassé après un déploiement. Chaque utilisateur se connecte à son propre compte Sentry dans le navigateur.",
  "marketplace.plugin.sentry.app":
    "Recherche d’erreurs, inspection des problèmes et santé des versions, via le serveur MCP de Sentry avec connexion dans le navigateur.",
  "marketplace.plugin.sentry.prompt.newErrors":
    "Quelles nouvelles erreurs sont apparues depuis le déploiement d’hier ?",
  "marketplace.plugin.sentry.prompt.topCrash": "Expliquez le principal plantage du projet mobile et sa cause probable.",
  "marketplace.plugin.sentry.prompt.releaseHealth":
    "Quelle est la santé de la version actuelle par rapport à la précédente ?",
  "marketplace.plugin.gitlab.tagline": "Tickets, merge requests et pipelines",
  "marketplace.plugin.gitlab.description":
    "GitLab permet aux agents de rechercher des projets, de lire et créer des tickets, de relire et mettre à jour des merge requests, de lire les fichiers et les commits du dépôt, et de vérifier les pipelines et les jobs CI sur GitLab.com. Chaque utilisateur se connecte à son propre compte GitLab dans le navigateur. Les agents ont les mêmes droits que l’utilisateur : ils peuvent pousser des commits, modifier des tickets et des merge requests, et les fusionner. Pour un GitLab auto-hébergé, ajoutez un serveur MCP avec votre adresse GitLab suivie de /api/v4/mcp dans les réglages des serveurs MCP, puis connectez-vous.",
  "marketplace.plugin.gitlab.app":
    "Projets, tickets, merge requests, dépôts et pipelines CI, via le serveur MCP de GitLab avec connexion dans le navigateur.",
  "marketplace.plugin.gitlab.prompt.reviewQueue": "Quelles merge requests attendent ma relecture ?",
  "marketplace.plugin.gitlab.prompt.failedPipeline":
    "Pourquoi le dernier pipeline de la branche par défaut a-t-il échoué ?",
  "marketplace.plugin.gitlab.prompt.newIssue":
    "Créez un ticket pour le plantage dans la file de synchronisation, avec les étapes de reproduction.",
  "marketplace.plugin.vercel.tagline": "Déploiements, journaux de build et projets",
  "marketplace.plugin.vercel.description":
    "Vercel permet aux agents de lister les projets et les déploiements récents, de lire les journaux de build et d’exécution, et de trouver pourquoi un build a échoué. Chaque utilisateur se connecte à son propre compte Vercel dans le navigateur et choisit les équipes que les agents peuvent utiliser. Dans ces équipes, les agents ont les mêmes droits que le compte de l’utilisateur. Ils peuvent aussi modifier les variables d’environnement, les domaines, les enregistrements DNS et les déploiements, et acheter des domaines.",
  "marketplace.plugin.vercel.app":
    "Projets, déploiements, journaux de build et d’exécution, via le serveur MCP de Vercel avec connexion dans le navigateur.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Pourquoi le dernier déploiement de production a-t-il échoué ?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Listez les déploiements d’aujourd’hui et leur statut.",
  "marketplace.plugin.vercel.prompt.runtimeErrors":
    "Quelles routes ont eu des erreurs d’exécution au cours de la dernière heure ?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, stockage et journaux",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare permet aux agents de lister et de gérer les Workers, les enregistrements DNS, R2, D1 et KV via l’API Cloudflare, d’interroger les journaux des Workers et de chercher dans la documentation Cloudflare. Chaque utilisateur se connecte à son propre compte Cloudflare dans le navigateur. Sur la page de consentement de Cloudflare, choisissez Read only : avec l’option par défaut, Minimal, les agents ne voient ni les Workers, ni les journaux, ni les enregistrements DNS. Avec les droits d’écriture, les agents peuvent déployer et supprimer des Workers, modifier les enregistrements DNS et changer d’autres paramètres du compte.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, stockage et journaux, via le serveur MCP de l’API Cloudflare avec connexion dans le navigateur.",
  "marketplace.plugin.cloudflare.prompt.workers": "Quels Workers sont déployés dans mon compte Cloudflare ?",
  "marketplace.plugin.cloudflare.prompt.errors":
    "Quels Workers Cloudflare ont enregistré des erreurs au cours de la dernière heure ?",
  "marketplace.plugin.cloudflare.prompt.dns": "Listez les enregistrements DNS de chaque zone de mon compte Cloudflare.",
  "marketplace.plugin.supabase.tagline": "Bases de données, journaux et edge functions",
  "marketplace.plugin.supabase.description":
    "Supabase permet aux agents de lister les projets, d’exécuter du SQL, de lire les schémas des tables et les journaux, de consulter les recommandations de sécurité et de performance des advisors, de gérer les edge functions et les branches, et de chercher dans la documentation Supabase. Chaque utilisateur se connecte à son propre compte Supabase dans le navigateur et choisit une organisation. Les agents ont un accès complet : ils peuvent exécuter du SQL qui modifie ou supprime des données, appliquer des migrations, déployer des edge functions et créer ou mettre en pause des projets.",
  "marketplace.plugin.supabase.app":
    "Bases de données, journaux et edge functions, via le serveur MCP de Supabase avec connexion dans le navigateur.",
  "marketplace.plugin.supabase.prompt.projects": "Quels projets se trouvent dans mon organisation Supabase ?",
  "marketplace.plugin.supabase.prompt.tables": "Listez les tables et les colonnes de ma base de données Supabase.",
  "marketplace.plugin.supabase.prompt.errors":
    "Quelles erreurs mon projet Supabase a-t-il enregistrées au cours de la dernière heure ?",
  "marketplace.plugin.context7.tagline": "Documentation à jour des bibliothèques",
  "marketplace.plugin.context7.description":
    "Context7 récupère la documentation et les références d’API à jour des bibliothèques et des frameworks, pour que les réponses utilisent la version que le projet exécute réellement. Il ne demande ni compte ni clé.",
  "marketplace.plugin.context7.app":
    "Consultation de la documentation à jour des bibliothèques, via le serveur MCP de Context7, sans connexion.",
  "marketplace.plugin.context7.prompt.apiCheck":
    "Quelle est l’API actuelle pour les listes virtualisées dans ce framework ?",
  "marketplace.plugin.context7.prompt.migrate": "Qu’est-ce qui a changé entre la v2 et la v3 de ce routeur ?",
  "marketplace.plugin.context7.prompt.example": "Montrez un exemple actuel d’envoi de fichiers authentifié.",
  "marketplace.plugin.stripe.tagline": "Paiements et facturation",
  "marketplace.plugin.stripe.description":
    "Stripe permet aux agents de consulter les paiements, les clients et les factures, et de rédiger des liens de paiement, dans le compte auquel l’utilisateur connecté a accès. Chaque utilisateur se connecte à son propre compte Stripe dans le navigateur.",
  "marketplace.plugin.stripe.app":
    "Consultation des paiements, des clients et des factures, via le serveur MCP de Stripe avec connexion dans le navigateur.",
  "marketplace.plugin.stripe.prompt.payment": "Consultez ce paiement et expliquez pourquoi il a échoué.",
  "marketplace.plugin.stripe.prompt.customer": "Résumez les factures et le solde impayé de ce client.",
  "marketplace.plugin.stripe.prompt.link": "Rédigez un lien de paiement pour le forfait Pro à 49 par mois.",
  "marketplace.plugin.revenuecat.tagline": "Abonnements, produits et paywalls",
  "marketplace.plugin.revenuecat.description":
    "RevenueCat permet aux agents de lire et de modifier la configuration de vos abonnements intégrés : apps, produits, entitlements, offerings, packages, paywalls et expériences. Les agents peuvent aussi consulter les clients et leurs achats, et lire les graphiques et les indicateurs. Une clé API secrète RevenueCat va dans un en-tête Authorization. La clé donne accès à un projet. Avec une clé en lecture seule, les agents peuvent seulement lire. Avec une clé en écriture, les agents peuvent soumettre des produits à la vérification de l'App Store, accorder des entitlements à des clients et supprimer des packages, des règles de ciblage et des webhooks.",
  "marketplace.plugin.revenuecat.app":
    "Produits, entitlements, offerings, paywalls et indicateurs, via le serveur MCP de RevenueCat avec une clé API secrète.",
  "marketplace.plugin.revenuecat.prompt.offerings": "Quels offerings et packages contient mon projet RevenueCat ?",
  "marketplace.plugin.revenuecat.prompt.revenue":
    "Comment mes revenus et mes abonnements actifs RevenueCat ont-ils évolué ce mois-ci ?",
  "marketplace.plugin.revenuecat.prompt.customer":
    "Quels entitlements ce client RevenueCat a-t-il, et quand expirent-ils ?",
  "marketplace.plugin.revenuecat.hint.apiKey":
    "Dans le tableau de bord RevenueCat, ouvrez API keys dans votre projet et créez une clé API secrète. Une clé en lecture seule suffit pour consulter les données.",
  "marketplace.plugin.posthog.tagline": "Analyse produit et feature flags",
  "marketplace.plugin.posthog.description":
    "PostHog permet aux agents d’interroger les événements et les entonnoirs, d’inspecter les feature flags et de résumer ce qui a changé après une version. Une clé API personnelle des réglages du projet va dans un seul en-tête Authorization.",
  "marketplace.plugin.posthog.app":
    "Accès aux événements, aux entonnoirs et aux feature flags, via le serveur MCP de PostHog avec une clé API personnelle.",
  "marketplace.plugin.posthog.prompt.funnel": "À quoi ressemble l’entonnoir d’inscription sur les 14 derniers jours ?",
  "marketplace.plugin.posthog.prompt.flag": "Quels feature flags sont activés pour cet utilisateur ?",
  "marketplace.plugin.posthog.prompt.release": "L’activation a-t-elle changé après la version de la semaine dernière ?",
  "marketplace.plugin.airtable.tagline": "Bases et enregistrements",
  "marketplace.plugin.airtable.description":
    "Airtable permet aux agents de lister les bases, de lire et de mettre à jour des enregistrements, et de résumer le contenu des tables. Une clé API de la page du compte est transmise au serveur local dans une variable d’environnement.",
  "marketplace.plugin.airtable.app":
    "Liste des bases et accès aux enregistrements, via un serveur MCP local avec une clé API Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "À quelles bases ai-je accès ?",
  "marketplace.plugin.airtable.prompt.records": "Résumez la table de suivi du lancement.",
  "marketplace.plugin.airtable.prompt.update":
    "Marquez les fonctionnalités livrées comme terminées dans la base de la feuille de route.",
  "marketplace.plugin.firecrawl.tagline": "Extraction et recherche web",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl permet aux agents d’extraire le contenu de pages, d’en tirer des données structurées et de rechercher sur le web via une seule API. Une clé API du tableau de bord Firecrawl est transmise au serveur local dans une variable d’environnement.",
  "marketplace.plugin.firecrawl.app":
    "Extraction de pages, extraction de données et recherche web, via un serveur MCP local avec une clé API Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape":
    "Extrayez le tableau des tarifs de cette page sous forme de données structurées.",
  "marketplace.plugin.firecrawl.prompt.research": "Recherchez les tarifs des concurrents et citez chaque page source.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Qu’est-ce qui a changé sur notre page de changelog ce mois-ci ?",
  "marketplace.plugin.braveSearch.tagline": "Recherche web privée",
  "marketplace.plugin.braveSearch.description":
    "Brave Search permet aux agents de rechercher sur le web et dans les résultats locaux sans pistage. Une clé API du tableau de bord Brave Search API est transmise au serveur local dans une variable d’environnement.",
  "marketplace.plugin.braveSearch.app": "Recherche web et locale, via un serveur MCP local avec une clé API Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Que disent les critiques de cette version du framework ?",
  "marketplace.plugin.braveSearch.prompt.news": "Trouvez les annonces du jour pour ce domaine de produit.",
  "marketplace.plugin.braveSearch.prompt.compare": "Comparez ces deux fournisseurs en citant les sources.",
  "marketplace.plugin.obsidian.tagline": "Les notes de votre coffre",
  "marketplace.plugin.obsidian.description":
    "Obsidian permet aux agents de rechercher, lire et écrire les notes de votre coffre, qui peut ainsi servir de mémoire. Le serveur local se connecte au plugin Local REST API de l'application Obsidian sur cet ordinateur. La clé API du plugin est transmise au serveur local dans une variable d'environnement. Gardez Obsidian ouvert pendant que les agents l'utilisent.",
  "marketplace.plugin.obsidian.app":
    "Recherche, lecture et modification de notes, via un serveur MCP local avec la clé du plugin Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Que disent mes notes sur les décisions de ce projet ?",
  "marketplace.plugin.obsidian.prompt.save": "Enregistrez cette décision dans une nouvelle note de mon coffre.",
  "marketplace.plugin.obsidian.prompt.log": "Ajoutez un résumé du travail d'aujourd'hui à ma note Journal de travail.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'Dans Obsidian, ouvrez Settings > Local REST API. Copiez la clé API et activez "Enable non-encrypted (HTTP) server".',
  "marketplace.plugin.resend.tagline": "E-mails transactionnels",
  "marketplace.plugin.resend.description":
    "Resend permet aux agents d’envoyer des e-mails transactionnels et de vérifier leur livraison via une seule API. Une clé API du tableau de bord Resend est transmise au serveur local dans une variable d’environnement.",
  "marketplace.plugin.resend.app":
    "Envoi d’e-mails et vérification de la livraison, via un serveur MCP local avec une clé API Resend.",
  "marketplace.plugin.resend.prompt.send": "Envoyez le brouillon de l’annonce de lancement à la liste bêta.",
  "marketplace.plugin.resend.prompt.status": "L’e-mail de facture est-il arrivé chez le client ?",
  "marketplace.plugin.resend.prompt.template":
    "Rédigez un e-mail de réinitialisation du mot de passe pour le nouveau parcours.",
  "marketplace.plugin.omnisend.tagline": "Marketing par e-mail et SMS",
  "marketplace.plugin.omnisend.description":
    "Omnisend permet aux agents de lire les rapports des campagnes et des formulaires, de trouver des contacts et des segments, et de créer et modifier des campagnes, des automatisations, des modèles d'e-mail, des formulaires et des produits. Chaque utilisateur se connecte à son propre compte Omnisend dans le navigateur et choisit le niveau d'accès sur l'écran de consentement. Avec l'accès en écriture, les agents peuvent aussi envoyer des campagnes et supprimer des données. Choisissez l'accès en lecture seule si les agents n'ont besoin que des rapports.",
  "marketplace.plugin.omnisend.app":
    "Campagnes, automatisations, contacts, segments, formulaires et rapports, via le serveur MCP d'Omnisend avec connexion dans le navigateur.",
  "marketplace.plugin.omnisend.prompt.lastCampaign":
    "Quels résultats ont eu les campagnes de la semaine dernière par rapport à la semaine précédente ?",
  "marketplace.plugin.omnisend.prompt.segment":
    "Combien de contacts compte le segment VIP, et comment a-t-il évolué ce mois-ci ?",
  "marketplace.plugin.omnisend.prompt.draftCampaign":
    "Prépare un brouillon de campagne pour la nouvelle collection, mais ne l'envoie pas.",
  "marketplace.plugin.postiz.tagline": "Planification des réseaux sociaux",
  "marketplace.plugin.postiz.description":
    "Postiz permet aux agents de lister vos comptes de réseaux sociaux, et de rédiger, planifier et publier des posts sur plus de 30 réseaux, comme X, LinkedIn, Instagram et TikTok. Les agents peuvent aussi importer des médias et créer des images et des vidéos par IA. Connectez-vous à votre compte Postiz dans le navigateur, ou collez la clé API de Settings › Developers dans Postiz. Toutes les offres cloud de Postiz incluent l'accès à l'API. Les agents peuvent publier un post tout de suite : vérifiez chaque post avant de l'approuver.",
  "marketplace.plugin.postiz.app":
    "Comptes, brouillons, posts planifiés et médias, via le serveur MCP de Postiz avec une connexion dans le navigateur ou une clé API.",
  "marketplace.plugin.postiz.prompt.channels": "Quels comptes de réseaux sociaux sont connectés à Postiz ?",
  "marketplace.plugin.postiz.prompt.week": "Quels posts sont planifiés pour la semaine prochaine ?",
  "marketplace.plugin.postiz.prompt.draft":
    "Rédige un post LinkedIn sur notre nouvelle version, mais ne le planifie pas.",
  "marketplace.plugin.trypost.tagline": "Planification des réseaux sociaux",
  "marketplace.plugin.trypost.description":
    "TryPost permet aux agents de lister vos canaux connectés, et de rédiger, planifier, mettre en file d'attente et publier des posts sur X, LinkedIn, Instagram, Facebook, TikTok, YouTube, Threads, Bluesky, Mastodon, Pinterest et plus encore. Les agents peuvent aussi lire les statistiques, gérer les idées et les approbations, et définir les horaires de publication. Connectez-vous à votre compte TryPost dans le navigateur et choisissez un espace de travail. Les agents peuvent publier un post immédiatement, donc vérifiez chaque post avant de l'approuver.",
  "marketplace.plugin.trypost.app":
    "Canaux, posts, file d'attente, idées et statistiques, via le serveur MCP de TryPost avec connexion dans le navigateur.",
  "marketplace.plugin.trypost.prompt.week": "Quels posts sont planifiés cette semaine ?",
  "marketplace.plugin.trypost.prompt.draft":
    "Rédige un post LinkedIn sur notre nouvelle version, mais ne le planifie pas.",
  "marketplace.plugin.trypost.prompt.analytics": "Lesquels de mes posts du mois dernier ont eu le plus d'engagement ?",
  "marketplace.plugin.composio.tagline": "Gmail, Slack, GitHub et plus de 1 000 autres apps",
  "marketplace.plugin.composio.description":
    "Composio connecte vos agents à Gmail, Slack, GitHub et plus de 1 000 autres apps via un seul serveur MCP. Connectez-vous avec votre compte Composio. Quand un agent a besoin d’une app, il vous demande de la connecter.",
  "marketplace.plugin.composio.app":
    "Les apps que vous connectez dans votre compte Composio. Un agent vous demande de connecter une app quand il en a besoin.",
  "marketplace.plugin.composio.prompt.inbox": "Résumez mes e-mails non lus et rédigez des réponses aux plus urgents.",
  "marketplace.plugin.composio.prompt.handoff":
    "Publiez un résumé de cette pull request dans le canal de notre équipe.",
  "marketplace.plugin.composio.prompt.apps": "Quelles apps et actions pouvez-vous utiliser via Composio ?",
  "marketplace.plugin.composio.hint.apiKey":
    "Vous la trouverez dans votre compte Composio, sous Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Projets, branches et migrations Postgres",
  "marketplace.plugin.neon.description":
    "Neon permet aux agents de lister les projets et les branches, d’exécuter du SQL, de lire les schémas des tables, de tester des changements de schéma sur une branche temporaire, de trouver les requêtes lentes et de chercher dans la documentation Neon. Chaque utilisateur se connecte à son propre compte Neon dans le navigateur et peut choisir un accès en lecture seule lors de l’autorisation. Avec un accès complet, les agents peuvent exécuter du SQL qui modifie ou supprime des données, et créer, réinitialiser ou supprimer des branches, des bases de données et des projets. Neon recommande son serveur MCP pour le développement et les tests, pas pour les bases de données de production.",
  "marketplace.plugin.neon.app":
    "Projets, branches, SQL et migrations Postgres, via le serveur MCP de Neon avec connexion dans le navigateur.",
  "marketplace.plugin.neon.prompt.projects": "Quels projets et quelles branches y a-t-il dans mon compte Neon ?",
  "marketplace.plugin.neon.prompt.slowQueries":
    "Quelles requêtes sont les plus lentes sur ma base de données Neon, et pourquoi ?",
  "marketplace.plugin.neon.prompt.migration":
    "Ajoutez un index sur la table orders dans une branche temporaire, et montrez-moi le résultat avant de l’appliquer.",
  "marketplace.plugin.prisma.tagline": "Bases de données Postgres, sauvegardes et apps Compute",
  "marketplace.plugin.prisma.description":
    "Prisma permet aux agents de lister et de créer des bases de données Prisma Postgres, de lire les schémas, d’exécuter du SQL, de lister les sauvegardes et de les restaurer dans une nouvelle base de données, de gérer les buckets Object Storage, de lire les builds et les journaux Compute, et de chercher dans la documentation Prisma. Chaque utilisateur se connecte à son propre compte Prisma dans le navigateur et choisit un workspace. Les agents ont un accès complet : ils peuvent exécuter du SQL qui modifie ou supprime des données, mettre à jour les schémas, supprimer des bases de données et des buckets, et arrêter, restaurer une version précédente ou supprimer des déploiements Compute.",
  "marketplace.plugin.prisma.app":
    "Bases de données, SQL, sauvegardes et apps Compute, via le serveur MCP de Prisma avec connexion dans le navigateur.",
  "marketplace.plugin.prisma.prompt.databases": "Quelles bases de données y a-t-il dans mon workspace Prisma ?",
  "marketplace.plugin.prisma.prompt.backups": "Montrez-moi toutes les sauvegardes disponibles de ma base de données.",
  "marketplace.plugin.prisma.prompt.logs": "Affichez les journaux d’exécution de mon dernier déploiement Compute.",
  "marketplace.plugin.netlify.tagline": "Projets, déploiements et journaux de requêtes",
  "marketplace.plugin.netlify.description":
    "Netlify permet aux agents de lister les projets et les déploiements, de lire les journaux des requêtes edge, de créer des projets et de déployer du code dans un projet existant. Chaque utilisateur se connecte à son propre compte Netlify dans le navigateur. Les agents ont le même accès que le compte de l’utilisateur : ils peuvent modifier les variables d’environnement, les formulaires et l’accès des visiteurs, installer ou retirer des extensions, et supprimer des soumissions de formulaires et des variables d’environnement.",
  "marketplace.plugin.netlify.app":
    "Projets, déploiements, journaux de requêtes et paramètres du site, via le serveur MCP de Netlify avec connexion dans le navigateur.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "Quel est le statut du dernier déploiement de chacun de mes projets Netlify ?",
  "marketplace.plugin.netlify.prompt.errors":
    "Quelles URL de mon site ont renvoyé des erreurs serveur au cours du dernier jour ?",
  "marketplace.plugin.netlify.prompt.deploy": "Déployez ce dossier dans mon projet Netlify existant.",
  "marketplace.plugin.railway.tagline": "Projets, services et déploiements",
  "marketplace.plugin.railway.description":
    "Railway permet aux agents de lister les projets et les services, de créer des projets, de redéployer des services et de gérer les feature flags. Les agents peuvent aussi confier un travail en plusieurs étapes au Railway Agent, qui lit les journaux, trouve pourquoi un déploiement a échoué, crée des services et définit des variables. Chaque utilisateur se connecte à son propre compte Railway dans le navigateur et choisit les espaces de travail et les projets que les agents peuvent utiliser. Dans ces projets, les agents ont un accès complet : ils peuvent déployer les modifications en attente, supprimer des feature flags, et modifier les services, les variables, les bases de données et le réseau via le Railway Agent.",
  "marketplace.plugin.railway.app":
    "Projets, services et déploiements, via le serveur MCP de Railway avec connexion dans le navigateur.",
  "marketplace.plugin.railway.prompt.projects":
    "Quels projets et services se trouvent dans mon espace de travail Railway ?",
  "marketplace.plugin.railway.prompt.crash": "Pourquoi mon service backend sur Railway plante-t-il au déploiement ?",
  "marketplace.plugin.railway.prompt.redeploy": "Redéploie le service API de mon projet Railway.",
  "marketplace.plugin.render.tagline": "Services, déploiements et journaux",
  "marketplace.plugin.render.description":
    "Render permet aux agents de lister les espaces de travail et les services, de lire les journaux, les événements et les métriques, de consulter l'historique des déploiements, de lancer des déploiements et d'exécuter du SQL en lecture seule sur Render Postgres. Une clé d'API Render va dans un en-tête Authorization. La clé donne accès à tous les espaces de travail du compte Render. Les agents peuvent créer des services web, des sites statiques, des tâches cron, des bases de données Postgres et des instances Key Value, ce qui peut coûter de l'argent, et ils peuvent remplacer les variables d'environnement d'un service. Le serveur ne peut supprimer aucune ressource.",
  "marketplace.plugin.render.app":
    "Services, déploiements, journaux et métriques, via le serveur MCP de Render avec une clé d'API.",
  "marketplace.plugin.render.prompt.services": "Quels services se trouvent dans mon espace de travail Render ?",
  "marketplace.plugin.render.prompt.logs":
    "Quelles erreurs mon service web Render a-t-il journalisées au cours de la dernière heure ?",
  "marketplace.plugin.render.prompt.deploy": "Pourquoi le dernier déploiement de mon service Render a-t-il échoué ?",
  "marketplace.plugin.atlassian.tagline": "Éléments de travail Jira et pages Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian permet aux agents de rechercher et de lire les éléments de travail Jira, les pages Confluence et les pull requests Bitbucket, et de créer ou de mettre à jour des éléments de travail, des pages et des commentaires. Chaque utilisateur se connecte à son propre compte Atlassian dans le navigateur et approuve l’accès sur un écran de consentement. Les agents ont les mêmes droits que l’utilisateur : ils peuvent modifier les éléments de travail et les pages, modifier les autorisations des pages et fusionner des pull requests. Les outils qui suppriment des données Jira restent désactivés jusqu’à ce qu’un administrateur de l’organisation les active. Chaque appel d’outil consomme des crédits Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence et Bitbucket, via le serveur MCP d’Atlassian avec connexion dans le navigateur.",
  "marketplace.plugin.atlassian.prompt.assigned": "Quels éléments de travail Jira ouverts me sont attribués ?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Trouve la page Confluence sur notre processus de release et résume-la.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Crée un élément de travail Jira pour le bug de connexion avec les étapes pour le reproduire.",
  "marketplace.plugin.todoist.tagline": "Tâches, projets et rappels",
  "marketplace.plugin.todoist.description":
    "Todoist permet aux agents de trouver des tâches par date, texte, étiquette ou filtre, d’ajouter et de replanifier des tâches, et de gérer les projets, sections, étiquettes, commentaires et rappels. Chaque utilisateur se connecte à son propre compte Todoist dans le navigateur. Les agents ont un accès en lecture et en écriture : ils peuvent modifier, terminer et supprimer des tâches, des projets et d'autres éléments.",
  "marketplace.plugin.todoist.app":
    "Tâches, projets et rappels, via le serveur MCP de Todoist avec connexion dans le navigateur.",
  "marketplace.plugin.todoist.prompt.today": "Quelles tâches Todoist sont à faire aujourd’hui ?",
  "marketplace.plugin.todoist.prompt.capture": "Ajoute ces actions à ma boîte de réception Todoist.",
  "marketplace.plugin.todoist.prompt.overdue": "Reporte mes tâches Todoist en retard à demain.",
  "marketplace.plugin.ticktick.tagline": "Tâches, listes, habitudes et concentration",
  "marketplace.plugin.ticktick.description":
    "TickTick permet aux agents de rechercher et filtrer des tâches, d'ajouter et modifier des tâches, et de gérer les listes, sections, dossiers, étiquettes et commentaires. Les agents peuvent aussi lire et modifier les habitudes et les sessions de concentration, et lire les événements des calendriers connectés à TickTick. Chaque utilisateur se connecte à son propre compte TickTick dans le navigateur. Les agents ont un accès en lecture et en écriture : ils peuvent terminer, déplacer et supprimer des tâches, et supprimer des étiquettes et des sessions de concentration.",
  "marketplace.plugin.ticktick.app":
    "Tâches, listes, habitudes et sessions de concentration, via le serveur MCP de TickTick avec connexion dans le navigateur.",
  "marketplace.plugin.ticktick.prompt.today": "Quelles tâches TickTick sont à faire aujourd'hui ?",
  "marketplace.plugin.ticktick.prompt.capture": "Ajoute ces actions à ma boîte de réception TickTick.",
  "marketplace.plugin.ticktick.prompt.week": "Quelles tâches TickTick ai-je terminées la semaine dernière ?",
  "marketplace.plugin.trello.tagline": "Tableaux, listes et cartes",
  "marketplace.plugin.trello.description":
    "Trello permet aux agents de rechercher et lire les tableaux, listes, cartes, checklists et commentaires, de créer des tableaux et des cartes, de déplacer les listes et les cartes, de marquer des cartes comme terminées, et d’ajouter des checklists, des commentaires et des étiquettes. Les agents peuvent aussi lire et ajouter des cartes dans la boîte de réception Trello de l’utilisateur, et lire les événements du Planner, qui peuvent venir d’un agenda Google ou Outlook connecté. Chaque utilisateur se connecte à son propre compte Trello dans le navigateur et choisit les espaces de travail sur un écran de consentement. Les agents ont les mêmes droits que l’utilisateur dans ces espaces de travail. Ils peuvent archiver des cartes et des listes, mais le serveur ne peut rien supprimer définitivement.",
  "marketplace.plugin.trello.app":
    "Tableaux, listes et cartes, via le serveur MCP de Trello avec connexion dans le navigateur.",
  "marketplace.plugin.trello.prompt.myCards": "Quelles cartes Trello me sont attribuées ?",
  "marketplace.plugin.trello.prompt.board": "Résume ce qui est en cours sur mon tableau Trello.",
  "marketplace.plugin.trello.prompt.newCards": "Ajoute ces actions comme cartes à mon tableau Trello.",
  "marketplace.plugin.clickup.tagline": "Tâches, documents et nouvelles de l'équipe",
  "marketplace.plugin.clickup.description":
    "ClickUp permet aux agents de rechercher des tâches, des documents, des commentaires et des messages de chat, de créer et modifier des tâches, des listes et des documents, de publier des commentaires, d'envoyer des messages de chat et de suivre le temps. Chaque utilisateur se connecte à son propre compte ClickUp dans le navigateur. Les agents ont les mêmes droits que l'utilisateur. Ils peuvent mettre des tâches à la corbeille et supprimer des commentaires.",
  "marketplace.plugin.clickup.app":
    "Tâches, documents, commentaires, chat et suivi du temps, via le serveur MCP de ClickUp avec connexion dans le navigateur.",
  "marketplace.plugin.clickup.prompt.findTasks": "Trouve mes tâches ClickUp ouvertes à échéance cette semaine.",
  "marketplace.plugin.clickup.prompt.createTask": "Crée une tâche ClickUp avec ces actions et assigne-la-moi.",
  "marketplace.plugin.clickup.prompt.summarizeDoc":
    "Trouve la dernière mise à jour du projet dans ClickUp et résume les questions ouvertes.",
  "marketplace.plugin.coinbase.tagline": "Cours crypto, portefeuilles et trading",
  "marketplace.plugin.coinbase.description":
    "Coinbase permet aux agents de lire les cours, soldes, portefeuilles, ordres et frais dans Coinbase Advanced Trade, de prévisualiser et passer des ordres, de convertir entre actifs et de déplacer des fonds entre portefeuilles. Chaque utilisateur se connecte à son propre compte Coinbase dans le navigateur. Les agents ont les mêmes autorisations que l'utilisateur. Les ordres et conversions utilisent des fonds réels, et les agents peuvent payer des requêtes x402 avec le solde en USDC.",
  "marketplace.plugin.coinbase.app":
    "Cours, soldes, portefeuilles, ordres et conversions, via le serveur MCP de Coinbase avec connexion dans le navigateur.",
  "marketplace.plugin.coinbase.prompt.balances": "Quels sont mes soldes Coinbase dans chaque portefeuille ?",
  "marketplace.plugin.coinbase.prompt.price": "Montre le cours BTC-USD sur Coinbase et son évolution cette semaine.",
  "marketplace.plugin.coinbase.prompt.previewOrder":
    "Prévisualise un achat au marché de 50 USD d'ETH sur Coinbase. Ne passe pas l'ordre.",
  "marketplace.plugin.robinhood.tagline": "Comptes de courtage et trading par agents",
  "marketplace.plugin.robinhood.description":
    "Robinhood permet aux agents de lire les comptes, positions, soldes, historique des transactions et listes de suivi d'un client Robinhood, de lire les données de marché et de passer des ordres sur actions, options et crypto. Chaque utilisateur se connecte à son propre compte Robinhood dans le navigateur. À la première connexion, Robinhood demande à l'utilisateur d'ouvrir un compte Agentic distinct. Les agents ne peuvent négocier que dans ce compte et, par défaut, ils passent des ordres sans demander à l'utilisateur d'approuver chacun d'eux.",
  "marketplace.plugin.robinhood.app":
    "Comptes, positions, données de marché et transactions, via le serveur MCP de Robinhood avec connexion dans le navigateur.",
  "marketplace.plugin.robinhood.prompt.positions": "Résume mes positions Robinhood et leur évolution aujourd'hui.",
  "marketplace.plugin.robinhood.prompt.watchlist":
    "Comment chaque action de ma liste de suivi Robinhood a-t-elle évolué cette semaine ?",
  "marketplace.plugin.robinhood.prompt.agenticCash":
    "Combien de liquidités y a-t-il sur mon compte Agentic Robinhood ?",
  "marketplace.plugin.huggingface.tagline": "Modèles, jeux de données et articles sur le Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face permet aux agents de rechercher des modèles, des jeux de données, des Spaces, des collections et des articles sur le Hugging Face Hub, de lire les model cards et les fichiers des dépôts, de prévisualiser des jeux de données et de rechercher dans la documentation de Hugging Face. Il utilise les données publiques du Hub et ne demande ni compte ni clé. Les outils ne font que lire : les agents ne peuvent pas créer de dépôts ni lancer de jobs.",
  "marketplace.plugin.huggingface.app":
    "Recherche de modèles, jeux de données, Spaces, articles et documentation, via le serveur MCP de Hugging Face sans connexion.",
  "marketplace.plugin.huggingface.prompt.models":
    "Trouve de petits modèles ouverts de reconnaissance vocale sur Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "Quels articles sont en tendance sur Hugging Face aujourd’hui ?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Trouve un jeu de données de séries temporelles météo et montre ses colonnes.",
  "marketplace.auth.apiKey": "Clé API",
  "marketplace.auth.personalApiKey": "Clé API personnelle",
  "marketplace.auth.createKey": "Créer une clé",

  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Essayer dans {name}",
  "marketplace.skills.yours": "Vos compétences",
  "marketplace.skills.seeAll": "Tout afficher",
  "marketplace.skills.seeAllName": "Tout afficher : {name}",
  "marketplace.skills.none": "Aucun agent n’a encore de compétence.",
  "marketplace.skills.noneHint":
    "Une compétence apprend une tâche à un agent. Ajoutez-en une ci-dessous ou créez la vôtre.",
  "marketplace.skills.sourceLabel": "Source",
  "marketplace.skills.source.all": "Toutes",
  "marketplace.skills.source.verified": "Vérifiées",
  "marketplace.skills.source.public": "Publiques",
  "marketplace.skills.source.verifiedLong": "Vérifiée par OpenBot",
  "marketplace.skills.source.publicLong": "Examinée par OpenBot",
  "marketplace.skills.sortLabel": "Trier",
  "marketplace.skills.sortName": "Trier : {name}",
  "marketplace.skills.sort.installs": "Les plus utilisées",
  "marketplace.skills.sort.updated": "Mises à jour récemment",
  "marketplace.skills.sort.name": "Nom",
  "marketplace.skills.featured": "À la une",
  "marketplace.skills.all": "Toutes les compétences",
  "marketplace.skills.count": { one: "{count} compétence", other: "{count} compétences" },
  "marketplace.skills.searchIn": "Rechercher dans {name}",
  "marketplace.skills.missing": "Cette compétence n’est pas dans la Marketplace.",
  "marketplace.skills.state.off": "Désactivée",
  "marketplace.skills.state.repair": "À réparer",
  "marketplace.skills.state.update": "Mise à jour disponible",
  "marketplace.skills.state.modified": "Modifiée par vous",
  "marketplace.skills.stateOn": "{state} sur {agents}",
  "marketplace.skills.version": "Version {version}",
  "marketplace.skills.origin.local": "Créée sur cet ordinateur",
  "marketplace.skills.origin.workspace": "Dans le dossier de cet agent",
  "marketplace.skills.origin.marketplace": "De la Marketplace · version {version}",
  "marketplace.skills.origin.github": "De GitHub · {repository}",
  "marketplace.skills.github.search": "Rechercher ou coller un lien GitHub",
  "marketplace.skills.github.reading": "Recherche de compétences dans le dépôt",
  "marketplace.skills.github.trust":
    "OpenBot n'a pas vérifié les compétences de GitHub. Lisez une compétence avant de l'ajouter.",
  "marketplace.skills.github.source": "GitHub · {repository} au commit {commit}",
  "marketplace.skills.github.open": "GitHub",
  "marketplace.skills.github.openName": "Ouvrir {repository} sur GitHub",
  "marketplace.skills.status.notAdded": "Non ajoutée",
  "marketplace.skills.status.on": "Activée sur {agents}",
  "marketplace.skills.agentCount": { one: "{count} agent", other: "{count} agents" },
  "marketplace.skills.allAgents": "tous les agents",
  "marketplace.skills.agentsTitle": "Agents · {total}",
  "marketplace.skills.agents.search": "Rechercher des agents",
  "marketplace.skills.agents.searchName": "Rechercher les agents avec {name}",
  "marketplace.skills.agents.noMatch": "Aucun agent ne correspond à « {query} ».",
  "marketplace.skills.agents.removeAll": "Tout retirer",
  "marketplace.skills.agents.removeAllName": {
    one: "Retirer {name} de {count} agent",
    other: "Retirer {name} des {count} agents",
  },
  "marketplace.skills.agent.toggle": "{name} pour {agent}",
  "marketplace.skills.agent.remove": "Retirer",
  "marketplace.skills.agent.removeName": "Retirer {name} de {agent}",
  "marketplace.skills.add": "Ajouter",
  "marketplace.skills.addName": "Ajouter {name} à des agents",
  "marketplace.skills.addToAgents": "Ajouter à des agents",
  "marketplace.skills.onOf": "Activée : {have} sur {total}",
  "marketplace.skills.chooseAgents": "{name} est sur {agents}. Choisir les agents",
  "marketplace.skills.dialog.list": "Agents avec {name}",
  "marketplace.skills.dialog.search": {
    one: "Rechercher parmi {count} agent",
    other: "Rechercher parmi {count} agents",
  },
  "marketplace.skills.dialog.all": { one: "{count} agent", other: "Les {count} agents" },
  "marketplace.skills.dialog.allMatches": { one: "{count} résultat", other: "Les {count} résultats" },
  "marketplace.skills.dialog.checked": "{checked} sur {total}",
  "marketplace.skills.dialog.save": "Enregistrer",
  "marketplace.skills.dialog.saveBoth": "Enregistrer : ajouter {added}, retirer {removed}",
  "marketplace.skills.dialog.addTo": "Ajouter à {agents}",
  "marketplace.skills.dialog.removeFrom": "Retirer de {agents}",
  "marketplace.skills.dialog.full": "Limite de compétences atteinte",
  "marketplace.skills.dialog.unread": "Compétences non lues",
  "marketplace.skills.local.gone": "Aucun agent n’a cette compétence maintenant.",

  "marketplace.notice.agentAdded": "{name} ajouté.",
  "marketplace.notice.agentUpdated": "{name} mis à jour.",
  "marketplace.notice.appConnected": "{name} connecté.",
  "marketplace.notice.appDisconnected": "{name} déconnecté.",
  "marketplace.notice.serverRemoved": "{name} supprimé.",
  "marketplace.notice.skillInstalled": {
    one: "{name} installé sur {count} agent.",
    other: "{name} installé sur {count} agents.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} supprimé de {count} agent.",
    other: "{name} supprimé de {count} agents.",
  },
  "marketplace.error.skillPartial": "{name} n’a pas changé sur ces agents : {agents}. {reason}",

  "marketplace.error.openLink": "Impossible d’ouvrir le lien.",
  "marketplace.error.copyLink": "Impossible de copier le lien.",
  "marketplace.error.connectNoServer": "Sélectionnez un serveur local pour connecter cette app.",
  "marketplace.error.installNoServer": "Sélectionnez un serveur local pour installer un plugin.",
  "marketplace.error.installNoAgent": "Choisissez un agent pour installer les compétences de ce plugin.",
  "marketplace.error.installLocalOnHost":
    "Installez {name} sur l’ordinateur qui exécute ces agents : son app exécute son serveur sur cet ordinateur.",
  "marketplace.error.installOnHost":
    "Installez {name} sur l’ordinateur qui exécute ces agents : son app demande une connexion dans le navigateur.",
  "marketplace.error.appInvalid": "Impossible d’ajouter {name} : {reason}",
  "marketplace.error.uninstallNoServer": "Sélectionnez un serveur local pour désinstaller un plugin.",
  "marketplace.error.uninstallPartial": "Une partie de {name} n’a pas pu être supprimée. {failures}",
  "marketplace.error.actionFailed": "Impossible de terminer l’action dans la Marketplace. Réessayez.",
  "marketplace.thisAgent": "cet agent",
} as const satisfies PartialTranslation<typeof source>;
