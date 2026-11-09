import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  // Agent import errors and warnings.
  "error.import.manifestNotJson": "{manifest} n’est pas un fichier JSON valide.",
  "error.import.notAgentExport": "{manifest} n’est pas une exportation d’agents OpenBot.",
  "error.import.newerExportSkill":
    "Cette exportation a été créée par une compétence d’exportation plus récente. Mettez à jour OpenBot, puis réessayez.",
  "error.import.noAgents": "L’exportation ne contient aucun agent.",
  "error.import.tooManyAgents": "L’exportation contient plus de {limit} agents.",
  "error.import.tooManyChannels": "L’exportation contient plus de {limit} canaux.",
  "error.import.channelSkipped": "{name} : le canal est ignoré, car aucun de ses agents n’est dans l’exportation.",
  "error.import.membersLeftOut": "{name} : les membres qui ne sont pas des agents de cette exportation sont exclus.",
  "error.import.leadNotMember": "{name} : le responsable n’est pas membre, donc le canal n’a pas de responsable.",
  "error.import.routineLimit": "{name} : seules les {limit} premières routines sont importées.",
  "error.import.routineInvalid":
    "{name} : la routine « {routine} » est ignorée, car son nom, son texte ou sa planification n’est pas valide.",
  "error.import.memoriesSkipped":
    "{name} : {skipped} souvenirs sont ignorés, car ils sont vides ou dépassent {limit} caractères.",
  "error.import.memoryLimit": "{name} : seuls les {limit} premiers souvenirs sont importés.",
  "error.import.manifestMissing": "L’exportation doit contenir {manifest}.",
  "error.import.skillFolderMissing": "{name} : le dossier de compétence {skill} n’a pas de SKILL.md.",
  "error.import.avatarSkipped":
    "{name} : l’avatar est ignoré, car ce n’est pas un fichier PNG, JPEG ou WebP de moins de 512 Ko.",
  "error.import.exportClosed": "L’exportation n’est plus ouverte. Choisissez-la de nouveau.",
  "error.import.agentNotInExport": "La sélection contient un agent qui n’est pas dans l’exportation.",
  "error.import.channelNotInExport": "La sélection contient un canal qui n’est pas dans l’exportation.",
  "error.import.serverAgentLimit": "Un serveur peut avoir au maximum {limit} agents.",
  "error.import.exportChanged": "L’exportation a changé après sa vérification. Choisissez-la de nouveau.",
  "error.import.noMembersImported": "Aucun de ses agents n’a été importé.",
  "error.import.leadNotImported": "{name} : son responsable n’a pas été importé, donc il n’a pas de responsable.",
  "error.import.routineSkipped": "{name} : la routine « {routine} » est ignorée. {reason}",
  "error.import.fileRenamed": "{name} : {file} existe déjà, cette copie est donc enregistrée sous {saved}.",
  "error.import.fileSkipped": "{name} : le fichier {file} est ignoré. {reason}",
  "error.import.chooseZip": "Choisissez un fichier .zip.",
  "error.import.unsafeFile": "L’exportation contient un fichier non sûr : {name}",
  "error.import.tooManyFiles": "L’exportation doit contenir au maximum {limit} fichiers.",
  "error.import.diskSpace":
    "{name} : ses fichiers nécessitent {size} Go d’espace disque libre, et {free} Go sont libres. Libérez de l’espace, puis importez de nouveau l’agent.",
  "error.import.remoteExpandedTooLarge": "L’exportation décompressée doit faire moins de 500 Mo et {limit} fichiers.",
  "error.import.zipInvalid":
    "Le fichier choisi n’est pas un .zip valide. Si Grok Bot l’enregistre encore, attendez, puis choisissez-le de nouveau.",
  "error.import.entryDamaged": "Le fichier est endommagé dans l’exportation.",
  "error.import.foldersSkipped":
    "{number} fichiers des dossiers .git et node_modules sont omis. Un outil peut les recréer.",
  "error.import.empty": "L’exportation est vide.",
  "error.import.remoteZipTooLarge":
    "Pour importer dans un serveur rejoint, l’exportation doit être un fichier .zip de moins de 100 Mo.",
  "error.import.hostBusy": "Le serveur lit d’autres exportations. Réessayez dans quelques minutes.",
  "error.import.skillKept":
    "{name} : le serveur a déjà la compétence « {skill} », l’agent utilise donc celle-ci. Demandez à un administrateur de la mettre à jour.",
  "error.import.transferRemoteTooLarge":
    "Un fichier de transfert pour un serveur rejoint doit faire moins de 100 Mo. Désactivez les fichiers des espaces de travail ou exportez moins d’agents.",
  "error.import.transferNotFile": "Ce fichier n’est pas un fichier de transfert OpenBot.",
  "error.import.transferNewer":
    "Ce fichier a été créé par une version plus récente d’OpenBot. Mettez à jour OpenBot et réessayez.",
  "error.import.transferEmpty": "Le fichier ne contient ni agents ni réglages.",
  "error.import.transferTooLarge":
    "Un fichier de transfert doit faire moins de 2 Go et contenir moins de 50 000 fichiers. Désactivez les fichiers des espaces de travail ou exportez moins d’agents.",
  "error.import.transferAgentInvalid": "L’agent {number} du fichier n’est pas valide. Il est ignoré.",
  "error.import.transferSettingsInvalid":
    "Les réglages de l’app dans le fichier ne sont pas valides. Ils ne sont pas importés.",
  "error.import.transferModelMissing":
    "{name} : le modèle « {model} » n’est pas encore disponible ici, donc l’agent utilise le modèle par défaut. Choisissez de nouveau le modèle quand son fournisseur est prêt.",
  "error.import.transferSettingSkipped": "{name} n’est pas importé. {reason}",
  "error.import.transferRoutineFlowSkipped": "L’import a laissé de côté un flux de routine. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name} : les agents personnalisés ne sont pas importés, car ils exécutent une commande. Vérifiez la commande « {command} » et ajoutez de nouveau l’agent dans les réglages.",
  "error.import.transferSkillLimit":
    "{name} : seules les {limit} premières de ses {total} compétences sont dans le fichier, car un agent peut avoir {limit} compétences.",
  "error.import.transferFilesGone":
    "{number} fichiers ont été supprimés pendant l’exportation. Ils ne sont donc pas dans le fichier.",
  "error.import.transferProviderKey": "{name} : saisissez de nouveau sa clé API dans les réglages.",
  "error.import.transferAgentEnv": "{name} : saisissez de nouveau les valeurs de {names} dans les réglages.",
  "error.import.transferMcpValues":
    "{name} : le serveur MCP est ajouté désactivé. Vérifiez sa commande, saisissez de nouveau ses valeurs et son adresse complète, puis activez-le dans les réglages MCP.",
  "error.import.transferValuesCleared":
    "{name} : les valeurs qui peuvent contenir un secret ont été retirées de ses arguments ou de son adresse. Saisissez-les de nouveau dans les réglages.",
  "error.import.transferSharedKept":
    "{number} fichiers du dossier partagé sont déjà présents ici. Ils restent tels quels.",
} as const satisfies PartialTranslation<typeof source>;
