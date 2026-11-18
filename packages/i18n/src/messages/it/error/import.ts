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
  "error.import.hermesNoProfiles":
    "Questa cartella non ha profili Hermes. Scegli la cartella Hermes, che contiene config.yaml o SOUL.md.",
  "error.import.hermesClosed": "I profili Hermes non sono più aperti. Leggili di nuovo.",
  "error.import.hermesProfileMissing": "La selezione indica un profilo Hermes che non è stato letto.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md supera i {limit} caratteri, quindi le istruzioni conservano solo l'inizio. Il file completo è in imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": "{name}: la skill «{skill}» viene saltata. {reason}",
  "error.import.hermesSkillCodeAdded":
    "Contiene codice che non c'era quando i profili sono stati letti. Leggili di nuovo per consentirlo.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot non è riuscito a salvare quale agente proviene da questo profilo, quindi la prossima importazione lo aggiunge come nuovo agente.",
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
  "error.import.transferAgentSettingSkipped": "{name}: un'impostazione dell'agente non viene applicata. {reason}",
  "error.import.transferChannelInstructionsCut":
    "{name}: nel file ci sono solo i primi {limit} caratteri delle istruzioni del canale, perché un canale nuovo può averne {limit}.",
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
    "{name}: il server MCP viene aggiunto disattivato. Controlla il comando, inserisci di nuovo i valori e l'indirizzo completo, poi attivalo in Marketplace, App.",
  "error.import.transferValuesCleared":
    "{name}: i valori che possono contenere un segreto sono stati rimossi dagli argomenti o dall'indirizzo. Inseriscili di nuovo nelle Impostazioni.",
  "error.import.transferSharedKept":
    "{number} file della cartella condivisa sono già presenti qui, quindi restano come sono.",
  "error.import.transferPartSkipped":
    "Alcune parti del file non sono state importate. Le altre parti sono su questo server, quindi non importare di nuovo il file.",
  "error.import.transferChannelInvalid": "Il canale {number} nel file non è valido, quindi viene saltato.",
  "error.import.transferChannelLimit": "Nel file ci sono solo i primi {limit} canali.",
  "error.import.transferWorkflowInvalid": "Un flusso di lavoro nel file non è valido, quindi viene saltato.",
  "error.import.transferRoutineWebhook":
    "{name}: la routine «{routine}» ha un nuovo indirizzo webhook. Aprila, crea un nuovo segreto e comunica entrambi al mittente.",
  "error.import.transferWorkflowWebhook":
    "{name}: il flusso di lavoro ha bisogno di un nuovo indirizzo webhook. Aprilo, ricrea l'indirizzo e comunicalo al mittente.",
  "error.import.transferWorkflowConnection":
    "{name}: scegli di nuovo la connessione Slack, Discord o Telegram del flusso di lavoro dopo averla collegata qui.",
  "error.import.transferHistorySkipped":
    "{name}: la cronologia chat nel file non è valida, quindi non viene importata.",
  "error.import.transferChatsSkipped": {
    one: "{name}: {count} chat non viene importata.",
    other: "{name}: {count} chat non vengono importate.",
  },
  "error.import.transferLocalScripts":
    "{name}: «Script locali» era attivo per questo agente. Riattivalo nelle sue impostazioni se ti fidi del file.",
  "error.import.transferAgentNewChats":
    "{name}: «L'agente avvia nuove chat» era attivo per questo agente. Riattivalo nelle sue impostazioni se ti fidi del file.",
  "error.import.transferAlwaysAllow":
    "{name}: su altro computer consentivi sempre questo agente. Qui chiede prima finché non lo consenti di nuovo.",
  "error.import.transferFolders":
    "{name}: usava {number} cartelle fuori dal suo workspace. Aggiungile di nuovo nelle impostazioni, in Cartelle.",
  "error.import.transferPartsClosed": "Il trasferimento con il server si è interrotto. Riprova.",
  "error.import.transferPartInvalid": "Una parte del file di trasferimento non è arrivata correttamente. Riprova.",
  "error.import.transferStepFailed": "Questo server non l'ha salvato.",
  "error.import.transferNoSpace":
    "Non c'è abbastanza spazio libero su disco sul server per questo file di trasferimento.",
} as const satisfies PartialTranslation<typeof source>;
