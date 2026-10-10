import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} non è un JSON valido.",
  "error.import.notAgentExport": "{manifest} non è un'esportazione di agenti OpenBot.",
  "error.import.newerExportSkill":
    "Questa esportazione è stata creata da una skill di esportazione più recente. Aggiorna OpenBot e riprova.",
  "error.import.noAgents": "L'esportazione non contiene agenti.",
  "error.import.tooManyAgents": "L'esportazione contiene più di {limit} agenti.",
  "error.import.tooManyChannels": "L'esportazione contiene più di {limit} canali.",
  "error.import.channelSkipped": "{name}: il canale viene saltato perché nessuno dei suoi agenti è nell'esportazione.",
  "error.import.membersLeftOut": "{name}: i membri che non sono agenti in questa esportazione vengono esclusi.",
  "error.import.leadNotMember": "{name}: il responsabile non è un membro, quindi il canale non ha un responsabile.",
  "error.import.routineLimit": "{name}: vengono importate solo le prime {limit} routine.",
  "error.import.routineInvalid":
    '{name}: la routine "{routine}" viene saltata perché il nome, il testo o la pianificazione non sono validi.',
  "error.import.memoriesSkipped":
    "{name}: {skipped} memorie vengono saltate perché sono vuote o più lunghe di {limit} caratteri.",
  "error.import.memoryLimit": "{name}: vengono importate solo le prime {limit} memorie.",
  "error.import.manifestMissing": "L'esportazione deve contenere {manifest}.",
  "error.import.skillFolderMissing": "{name}: la cartella della skill {skill} non ha un file SKILL.md.",
  "error.import.avatarSkipped": "{name}: l'avatar viene saltato perché non è un PNG, JPEG o WebP sotto i 512 KB.",
  "error.import.exportClosed": "L'esportazione non è più aperta. Scegline di nuovo una.",
  "error.import.agentNotInExport": "La selezione indica un agente che non è nell'esportazione.",
  "error.import.channelNotInExport": "La selezione indica un canale che non è nell'esportazione.",
  "error.import.serverAgentLimit": "Un server può avere al massimo {limit} agenti.",
  "error.import.exportChanged": "L'esportazione è cambiata dopo il controllo. Scegline di nuovo una.",
  "error.import.noMembersImported": "Nessuno dei suoi agenti è stato importato.",
  "error.import.leadNotImported": "{name}: il suo responsabile non è stato importato, quindi non ha un responsabile.",
  "error.import.routineSkipped": '{name}: la routine "{routine}" viene saltata. {reason}',
  "error.import.fileRenamed": "{name}: {file} esiste già, quindi questa copia viene salvata come {saved}.",
  "error.import.fileSkipped": "{name}: il file {file} viene saltato. {reason}",
  "error.import.chooseZip": "Scegli un file .zip.",
  "error.import.zipTooLarge": "L'esportazione deve essere un file .zip sotto i 500 MB.",
  "error.import.unsafeFile": "L'esportazione contiene un file non sicuro: {name}",
  "error.import.expandedTooLarge":
    "L'esportazione, una volta estratta, deve occupare meno di 500 MB e contenere al massimo {limit} file.",
  "error.import.zipInvalid":
    "Il file selezionato non è un .zip valido. Se Grok Bot lo sta ancora salvando, attendi e sceglilo di nuovo.",
  "error.import.empty": "L'esportazione è vuota.",
  "error.import.remoteZipTooLarge":
    "Per importare in un server a cui sei collegato, l'esportazione deve essere un file .zip sotto i 100 MB.",
  "error.import.hostBusy": "Il server sta leggendo altre esportazioni. Riprova tra qualche minuto.",
  "error.import.skillKept":
    '{name}: il server ha già la skill "{skill}", quindi l\'agente usa quella skill. Chiedi a un amministratore di aggiornarla.',
} as const satisfies PartialTranslation<typeof source>;
