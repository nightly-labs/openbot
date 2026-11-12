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
    "{name}: la routine «{routine}» viene saltata perché il nome, il testo o la pianificazione non sono validi.",
  "error.import.memoriesSkipped":
    "{name}: {skipped} memorie vengono saltate perché sono vuote o più lunghe di {limit} caratteri.",
  "error.import.memoryLimit": "{name}: vengono importate solo le prime {limit} memorie.",
  "error.import.manifestMissing": "L'esportazione deve contenere {manifest}.",
  "error.import.skillFolderMissing": "{name}: la cartella della skill {skill} non ha un file SKILL.md.",
  "error.import.avatarSkipped": "{name}: l'avatar viene saltato perché non è un PNG, JPEG o WebP sotto i 512 KB.",
  "error.import.exportClosed": "L'esportazione non è più aperta. Sceglila di nuovo.",
  "error.import.agentNotInExport": "La selezione indica un agente che non è nell'esportazione.",
  "error.import.channelNotInExport": "La selezione indica un canale che non è nell'esportazione.",
  "error.import.serverAgentLimit": "Un server può avere al massimo {limit} agenti.",
  "error.import.exportChanged": "L'esportazione è cambiata dopo il controllo. Sceglila di nuovo.",
  "error.import.noMembersImported": "Nessuno dei suoi agenti è stato importato.",
  "error.import.leadNotImported": "{name}: il suo responsabile non è stato importato, quindi non ha un responsabile.",
  "error.import.routineSkipped": "{name}: la routine «{routine}» viene saltata. {reason}",
  "error.import.fileRenamed": "{name}: {file} esiste già, quindi questa copia viene salvata come {saved}.",
  "error.import.fileSkipped": "{name}: il file {file} viene saltato. {reason}",
  "error.import.chooseZip": "Scegli un file .zip.",
  "error.import.unsafeFile": "L'esportazione contiene un file non sicuro: {name}",
  "error.import.tooManyFiles": "L'esportazione deve contenere al massimo {limit} file.",
  "error.import.diskSpace":
    "{name}: i suoi file richiedono {size} GB di spazio libero su disco e ne sono liberi {free} GB. Libera spazio, poi importa di nuovo l'agente.",
  "error.import.remoteExpandedTooLarge":
    "L'esportazione, una volta estratta, deve occupare meno di 500 MB e contenere al massimo {limit} file.",
  "error.import.zipInvalid":
    "Il file selezionato non è un .zip valido. Se Grok Bot lo sta ancora salvando, attendi e sceglilo di nuovo.",
  "error.import.entryDamaged": "Il file è danneggiato nell'esportazione.",
  "error.import.foldersSkipped":
    "{number} file nelle cartelle .git e node_modules sono esclusi. Uno strumento può ricrearli.",
  "error.import.empty": "L'esportazione è vuota.",
  "error.import.remoteZipTooLarge":
    "Per importare in un server a cui ti sei unito, l'esportazione deve essere un file .zip sotto i 100 MB.",
  "error.import.hostBusy": "Il server sta leggendo altre esportazioni. Riprova tra qualche minuto.",
  "error.import.uploadDiskSpace":
    "L'esportazione richiede {size} GB di spazio libero sul server, e ne sono liberi {free} GB. Libera spazio sul server, poi scegli di nuovo l'esportazione.",
  "error.import.remoteZipTooLargeOldHost":
    "Questo server accetta un'esportazione fino a 100 MB. Aggiorna OpenBot sul server per importare un'esportazione più grande.",
  "error.import.skillKept":
    "{name}: il server ha già la skill «{skill}», quindi l'agente usa quella skill. Chiedi a un amministratore di aggiornarla.",
  "error.import.skillRenamed":
    "{name}: il nome della skill «{skill}» è troppo simile a quello di un'altra skill, quindi viene salvata come «{renamed}».",
  "error.import.transferRemoteTooLarge":
    "Un file di trasferimento per un server a cui ti sei unito deve pesare meno di 100 MB. Disattiva i file del workspace o esporta meno agenti.",
  "error.import.transferNotFile": "Questo file non è un file di trasferimento OpenBot.",
  "error.import.transferNewer":
    "Questo file è stato creato da una versione più recente di OpenBot. Aggiorna OpenBot e riprova.",
  "error.import.transferEmpty": "Il file non contiene agenti né impostazioni.",
  "error.import.transferTooLarge":
    "Un file di trasferimento deve pesare meno di 2 GB e contenere meno di 50.000 file. Disattiva i file del workspace o esporta meno agenti.",
  "error.import.transferAgentInvalid": "L'agente {number} nel file non è valido, quindi viene saltato.",
  "error.import.transferSettingsInvalid":
    "Le impostazioni dell'app nel file non sono valide, quindi non vengono importate.",
  "error.import.transferModelMissing":
    "{name}: il modello «{model}» non è ancora disponibile qui, quindi l'agente usa il modello predefinito. Scegli di nuovo il modello quando il suo provider è pronto.",
  "error.import.transferSettingSkipped": "Importazione di {name} saltata. {reason}",
  "error.import.transferRunsSkipped":
    "{name}: la cronologia delle esecuzioni della routine «{routine}» non viene importata.",
  "error.import.transferSharedSkillsSkipped": "Impossibile leggere le skill condivise, quindi non sono nel file.",
  "error.import.transferSharedSkillsNotAdded": "Impossibile aggiungere a questo server le skill condivise del file.",
  "error.import.transferMemberPreferencesSkipped": {
    one: "Impossibile salvare le scelte di {count} membro.",
    other: "Impossibile salvare le scelte di {count} membri.",
  },
  "error.import.transferSharedSkillExists":
    "Su questo server è già presente una skill condivisa con questo nome e file diversi.",
  "error.import.transferServerPreferencesSkipped": {
    one: "{count} preferenza del server nel file non è valida qui, quindi non viene importata.",
    other: "{count} preferenze del server nel file non sono valide qui, quindi non vengono importate.",
  },
  "error.import.transferRoutineFlowSkipped": "L'importazione ha escluso un flusso di routine. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: gli agenti personalizzati non vengono importati, perché eseguono un comando. Controlla il comando «{command}» e aggiungi di nuovo l'agente nelle Impostazioni.",
  "error.import.transferSkillLimit":
    "{name}: nel file ci sono solo le prime {limit} delle sue {total} skill, perché un agente può avere {limit} skill.",
  "error.import.transferFilesGone":
    "{number} file sono stati eliminati durante l'esportazione, quindi non sono nel file.",
  "error.import.transferProviderKey": "{name}: inserisci di nuovo la sua chiave API nelle Impostazioni.",
  "error.import.transferAgentEnv": "{name}: inserisci di nuovo i valori di {names} nelle Impostazioni.",
  "error.import.transferMcpValues":
    "{name}: il server MCP viene aggiunto disattivato. Controlla il comando, inserisci di nuovo i valori e l'indirizzo completo, poi attivalo nelle impostazioni MCP.",
  "error.import.transferValuesCleared":
    "{name}: i valori che possono contenere un segreto sono stati rimossi dagli argomenti o dall'indirizzo. Inseriscili di nuovo nelle Impostazioni.",
  "error.import.transferSharedKept":
    "{number} file della cartella condivisa sono già presenti qui, quindi restano come sono.",
} as const satisfies PartialTranslation<typeof source>;
