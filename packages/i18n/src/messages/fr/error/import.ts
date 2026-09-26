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
  "error.import.chooseZip": "Choisissez un fichier .zip.",
  "error.import.zipTooLarge": "L’exportation doit être un fichier .zip de moins de 500 Mo.",
  "error.import.unsafeFile": "L’exportation contient un fichier non sûr : {name}",
  "error.import.expandedTooLarge": "L’exportation décompressée doit faire moins de 500 Mo et {limit} fichiers.",
  "error.import.zipInvalid":
    "Le fichier choisi n’est pas un .zip valide. Si Grok Bot l’enregistre encore, attendez, puis choisissez-le de nouveau.",
  "error.import.empty": "L’exportation est vide.",
} as const satisfies PartialTranslation<typeof source>;
