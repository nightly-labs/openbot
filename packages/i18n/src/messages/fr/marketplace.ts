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
  "marketplace.close": "Fermer la Marketplace",
  "marketplace.kinds": "Types de contenu de la Marketplace",
  "marketplace.tab.agents": "Agents",
  "marketplace.tab.skills": "Compétences",

  "marketplace.plugins.missing": "Ce plugin n’est pas dans le catalogue OpenBot.",

  "marketplace.agents.loadingDetail": "Chargement des détails de l’agent…",
  "marketplace.agents.skills": "Compétences",
  "marketplace.agents.routines": "Routines",
  "marketplace.agents.routineActive": "Active",
  "marketplace.agents.routineInactive": "Inactive",

  "marketplace.skill.loading": "Chargement de la compétence",
  "marketplace.skill.update": "Mettre à jour la compétence",
  "marketplace.try.readFailed": "OpenBot n’a pas pu lire les compétences de cet agent. Réessayez.",
  "marketplace.try.enable": "Activez cette compétence dans les réglages de l’agent pour l’essayer.",
  "marketplace.try.repair": "Réparez cette compétence dans les réglages de l’agent pour l’essayer.",
  "marketplace.try.update": "Mettez à jour cette compétence pour essayer cette version.",
  "marketplace.try.composerUnavailable": "L’éditeur de l’agent n’est pas disponible.",

  "marketplace.open": "Ouvrir {name}",
  "marketplace.tab.apps": "Apps",
  "marketplace.crumbs.label": "Emplacement",
  "marketplace.search.label": "Rechercher dans la Marketplace",
  "marketplace.search.placeholder": "Rechercher",
  "marketplace.installs": { one: "{installs} installation", other: "{installs} installations" },
  "marketplace.filter": "Filtrer",
  "marketplace.filter.on": "Filtre : {filters}",
  "marketplace.filter.all": "Tout",
  "marketplace.filter.status": "État",
  "marketplace.filter.category": "Catégorie",
  "marketplace.filter.added": "Ajouté",
  "marketplace.filter.notAdded": "Non ajouté",
  "marketplace.filter.installed": "Installé",
  "marketplace.filter.notInstalled": "Non installé",
  "marketplace.filter.clear": "Effacer les filtres",
  "marketplace.noMatch.apps": "Aucune app ne correspond à cette recherche.",
  "marketplace.noMatch.filters": "Aucun résultat ne correspond aux filtres.",
  "marketplace.noMatch.showAgents": { one: "Afficher {count} agent", other: "Afficher {count} agents" },
  "marketplace.noMatch.showApps": { one: "Afficher {count} app", other: "Afficher {count} apps" },
  "marketplace.noMatch.showSkills": { one: "Afficher {count} compétence", other: "Afficher {count} compétences" },
  "marketplace.empty.agents": "La Marketplace ne contient encore aucun agent.",
  "marketplace.empty.apps": "La Marketplace ne contient encore aucune app.",
  "marketplace.empty.skills": "La Marketplace ne contient encore aucune compétence.",
  "marketplace.properties.agent": "À propos de cet agent",
  "marketplace.properties.skill": "À propos de cette compétence",
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
  "marketplace.app.notConnected": "Non connecté",
  "marketplace.app.custom": "Serveur MCP",
  "marketplace.app.githubTagline": "Dépôts, tickets et pull requests",
  "marketplace.app.onePasswordTagline": "Connectez-vous aux sites avec les identifiants que vous partagez",
  "marketplace.app.onePasswordCategory": "Gestion des identifiants et des connexions",
  "marketplace.app.yourApps": "Vos apps",
  "marketplace.app.moreApps": "Autres apps",
  "marketplace.app.server": "Serveur",
  "marketplace.app.command": "Commande",
  "marketplace.app.address": "Adresse",
  "marketplace.app.disconnect.title": "Déconnecter",
  "marketplace.app.disconnect.description":
    "Supprimer {name} et ses compétences de cet ordinateur. Vous pourrez le connecter à nouveau plus tard.",
  "marketplace.app.disconnect.action": "Déconnecter",
  "marketplace.app.remove.title": "Supprimer le serveur",
  "marketplace.app.remove.description": "Vos agents ne peuvent plus utiliser ce serveur. Ses réglages sont supprimés.",
  "marketplace.app.remove.action": "Supprimer",
  "marketplace.app.remove.confirmTitle": "Supprimer {name} ?",
  "marketplace.app.remove.keep": "Conserver",

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
    "Paper permet aux agents de lire et d’écrire le fichier de design ouvert dans Paper Desktop : inspecter les plans de travail, les sélections, les styles calculés, le JSX et les tokens, et créer ou modifier des cadres, du texte et des styles. Installez Paper Desktop, ouvrez-le une fois et ouvrez un fichier avant de commencer. OpenBot démarre le CLI Paper que Paper Desktop installe. Paper ne demande aucune clé. Les outils d’écriture modifient le fichier ouvert : vérifiez chaque écriture avant de l’approuver.",
  "marketplace.plugin.paper.app":
    "Lit et écrit le fichier Paper Desktop ouvert, via le serveur MCP local que le CLI Paper relaie. Demande Paper Desktop avec un fichier ouvert.",
  "marketplace.plugin.paper.prompt.implement":
    "Implémentez le cadre Paper sélectionné dans ce code, avec nos conventions de code.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Utilisez les styles de ce dépôt et concevez une page de réglages dans Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Listez les tokens de design du fichier Paper ouvert et comparez-les avec notre thème.",
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
  "marketplace.plugin.resend.tagline": "E-mails transactionnels",
  "marketplace.plugin.resend.description":
    "Resend permet aux agents d’envoyer des e-mails transactionnels et de vérifier leur livraison via une seule API. Une clé API du tableau de bord Resend est transmise au serveur local dans une variable d’environnement.",
  "marketplace.plugin.resend.app":
    "Envoi d’e-mails et vérification de la livraison, via un serveur MCP local avec une clé API Resend.",
  "marketplace.plugin.resend.prompt.send": "Envoyez le brouillon de l’annonce de lancement à la liste bêta.",
  "marketplace.plugin.resend.prompt.status": "L’e-mail de facture est-il arrivé chez le client ?",
  "marketplace.plugin.resend.prompt.template":
    "Rédigez un e-mail de réinitialisation du mot de passe pour le nouveau parcours.",
  "marketplace.plugin.composio.tagline": "De nombreuses apps via votre propre lien Composio",
  "marketplace.plugin.composio.description":
    "Composio connecte les agents à Gmail, Slack, GitHub et des centaines d’autres apps via un seul serveur MCP. Créez le serveur dans votre compte Composio, ajoutez-y les apps que vous voulez et collez son lien ici. Ajoutez une clé API seulement si votre serveur en demande une.",
  "marketplace.plugin.composio.app":
    "Les apps que vous ajoutez à votre serveur MCP Composio, via le lien de votre compte Composio.",
  "marketplace.plugin.composio.prompt.inbox": "Résumez mes e-mails non lus et rédigez des réponses aux plus urgents.",
  "marketplace.plugin.composio.prompt.handoff":
    "Publiez un résumé de cette pull request dans le canal de notre équipe.",
  "marketplace.plugin.composio.prompt.apps": "Quelles apps et actions pouvez-vous utiliser via Composio ?",

  "marketplace.skill.installMenu.install": "Installer",
  "marketplace.skill.installMenu.installNamed": "Installer {name}",
  "marketplace.skill.installMenu.allAgents": "Tous les agents",
  "marketplace.skill.installMenu.agents": { one: "{count} agent", other: "{count} agents" },
  "marketplace.skill.installMenu.here": "Vous êtes ici",
  "marketplace.skill.installMenu.change": {
    one: "{label} a {name}. Modifier",
    other: "{label} ont {name}. Modifier",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Essayer dans {name}",

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
