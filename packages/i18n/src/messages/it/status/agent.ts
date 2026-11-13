import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Scrittura di {path}, fuori dal workspace dell'agente, dalla cartella condivisa e dalle cartelle temporanee.",
  "status.agent.contextCleared": "Contesto cancellato. Da qui inizia una nuova chat.",
  "status.agent.instructionsChanged": "Ha aggiornato le sue istruzioni",
  "status.agent.modelSwitchedForLimit": "Limite di utilizzo raggiunto. Passato a {model}.",
  "status.agent.modelReturnedAfterLimit": "Limite di utilizzo terminato. Tornato a {model}.",
  "status.agent.modelSwitchedForError": "Errore del provider. Passato a {model}.",
  "status.agent.modelSwitchedForSpentBalance":
    "{previous} non ha più crediti. Passaggio a {model}. Per usarlo di nuovo, aggiungi crediti e poi selezionalo.",
  "status.agent.modelReturnedAfterError": "Tornato a {model} dopo l’errore del provider.",
  "status.agent.marketplaceSuggested": "Ha suggerito un'app del Marketplace: {app}.",
  "status.agent.channelMemberAdded": "{agent} ha aggiunto {member} al canale. Lo ha chiesto {person}.",
  "status.agent.channelMemberRemoved": "{agent} ha rimosso {member} dal canale. Lo ha chiesto {person}.",
  "status.agent.channelInstructionsChanged": "{agent} ha modificato le istruzioni del canale. Lo ha chiesto {person}.",
  "status.agent.channelRoutineCreated": "{agent} ha creato la routine {routine}. Lo ha chiesto {person}.",
  "status.agent.channelRoutineUpdated": "{agent} ha modificato la routine {routine}. Lo ha chiesto {person}.",
  "status.agent.channelRoutineDeleted": "{agent} ha eliminato la routine {routine}. Lo ha chiesto {person}.",
  "status.agent.channelTaskCancelled":
    "{agent} ha annullato l’attività «{task}» e le sue sottoattività. Lo ha chiesto {person}.",
  "status.agent.screenCaptureScreen":
    "Acquisizione dello schermo principale e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureChannel":
    "L'immagine appare nel canale {channel} e ogni membro di questo server che legge il canale può vederla.",
  "status.agent.screenCaptureDisplay":
    "Acquisizione dello schermo {name} e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureWindow":
    "Acquisizione della finestra {name} e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureRegion":
    "Acquisizione dell'area dello schermo a {x}, {y}, {width} × {height} punti e invio dell'immagine al modello dell'agente.",
  "status.agent.reportProblem":
    "Diventerà una issue pubblica su GitHub, con la versione dell'app e il tuo sistema. Il tuo nome non viene mostrato.",
  "status.agent.sendIdea": "Diventa una issue pubblica su GitHub. Il tuo nome non viene mostrato.",
  "status.agent.feedbackRecentErrors": "Errori recenti nella chat:",
  "status.agent.feedbackSameAs": "Si aggiunge alla issue #{issue}",
  "status.agent.feedbackSent": "Inviato al team di OpenBot: {title}",
  "status.agent.serverInstallCommand":
    "Crea un comando monouso che installa OpenBot su un altro computer come server {name} e lo collega al tuo account. L'agente lo esegue lì.",
  "status.agent.serverInstallCard": "Comando di installazione per il server {name}",
  "status.agent.feedbackSending": "Invio del tuo feedback al team di OpenBot…",
  "status.agent.workflowDelete":
    "Elimina il flusso di lavoro {title} con le sue esecuzioni e versioni. I suoi passaggi aperti si fermano.",
  "status.agent.screenCaptureProgress": "Richiesta di acquisizione dello schermo…",
  "status.agent.screenCaptureReviewing": "Analisi dell'acquisizione dello schermo…",
  "status.agent.browserOpening": "Apertura di una pagina web…",
  "status.agent.browserReading": "Lettura della pagina web…",
  "status.agent.browserClicking": "Clic sulla pagina web…",
  "status.agent.browserTyping": "Digitazione nella pagina web…",
  "status.agent.browserActing": "Uso della pagina web…",
  "status.agent.browserReviewing": "Analisi della pagina web…",
  "status.agent.memoriesSearching": "Ricerca nelle sue memorie…",
  "status.agent.memoriesSearched": {
    one: "Ha cercato nelle sue memorie: {count} trovata",
    other: "Ha cercato nelle sue memorie: {count} trovate",
  },
  "status.agent.memoriesUpdating": "Aggiornamento delle sue memorie…",
  "status.agent.skillUsing": "Uso della skill {name}…",
  "status.agent.skillReading": "Lettura di una skill…",
  "status.agent.toolStepFailed":
    "Un passaggio dello strumento è fallito; analisi del risultato e scelta del prossimo tentativo…",
  "status.agent.toolResultReviewing": "Analisi dell’ultimo risultato dello strumento…",
  "status.agent.sourcesSearching": "Ricerca di informazioni aggiornate…",
  "status.agent.sourcesReviewing": "Analisi delle fonti e delle informazioni trovate…",
  "status.agent.informationGathering": "Raccolta delle informazioni rilevanti…",
  "status.agent.informationReviewing": "Analisi delle informazioni raccolte…",
  "status.agent.workChecking": "Verifica del lavoro…",
  "status.agent.workReviewing": "Analisi dei risultati della verifica…",
  "status.agent.changesMaking": "Esecuzione delle modifiche richieste…",
  "status.agent.changesReviewing": "Analisi delle modifiche effettuate…",
  "status.agent.agentCoordinating": "Coordinamento con un altro agente…",
  "status.agent.agentResponseReviewing": "Analisi della risposta dell’altro agente…",
  "status.agent.commandRunningUnnamed": "Esecuzione di un comando…",
  "status.agent.toolStepWorking": "Elaborazione del prossimo passaggio assistito dallo strumento…",
  "status.agent.webSearching": "Ricerca sul web di «{query}»…",
  "status.agent.urlFetching": "Apertura di {host}…",
  "status.agent.fileReading": "Lettura di {name}…",
  "status.agent.filesReading": "Lettura dei file…",
  "status.agent.filesListing": "Esame di {path}…",
  "status.agent.filesLooking": "Esame dei file…",
  "status.agent.textSearching": "Ricerca di «{query}»…",
  "status.agent.filesSearchingText": "Ricerca nei file…",
  "status.agent.folderSizesMeasuring": "Misurazione delle dimensioni delle cartelle…",
  "status.agent.diskSpaceChecking": "Controllo dello spazio libero su disco…",
  "status.agent.processesChecking": "Controllo dei processi in esecuzione…",
  "status.agent.gitChecking": "Controllo del repository Git…",
  "status.agent.commandRunning": "Esecuzione di {program}…",
  "status.agent.memoryChanges": "Memorie: {saved} salvate, {updated} aggiornate, {forgotten} dimenticate.",
  "status.agent.memoryChangesWithConflicts":
    "Memorie: {saved} salvate, {updated} aggiornate, {forgotten} dimenticate, {notChanged} non modificate perché un altro thread le ha modificate prima.",
  "status.agent.nextStepContinues":
    "L'agente si è fermato prima del passaggio successivo. Continua ({current} di {limit}).",
  "status.agent.planContinues": "Il piano ha passaggi aperti. L'agente continua ({current} di {limit}).",
  "status.agent.compactionContinues":
    "La connessione si è interrotta mentre l'agente compattava il contesto. L'agente continua.",
  "status.agent.branchTitle": "Chat ramificata",
} as const satisfies PartialTranslation<typeof source>;
