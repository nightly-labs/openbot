import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/agentSettings";

export const messages = {
  "agentSettings.session.title": "Impostazioni del provider",
  "agentSettings.session.readFailed": "Impossibile leggere le impostazioni del provider.",
  "agentSettings.session.pending": "Le modifiche salvate si applicano prima del prossimo turno.",
  "agentSettings.session.unavailable": "Il valore salvato {value} non è disponibile. Scegline un altro o reimpostalo.",
  "agentSettings.session.effective": "Valore attuale del provider: {value}",
  "agentSettings.session.reset": "Reimposta l'impostazione",
  "agentSettings.session.resetNamed": "Reimposta {name}",
  "agentSettings.label": "Impostazioni dell'agente",
  "agentSettings.title": "Impostazioni",
  "agentSettings.backToDetails": "Torna ai dettagli",
  "agentSettings.closeDetails": "Chiudi i dettagli",
  "agentSettings.backToSettings": "Torna alle impostazioni",
  "agentSettings.permissions.title": "Permessi",
  "agentSettings.advanced.title": "Avanzate",
  "agentSettings.groups.brain": "Cervello",
  "agentSettings.groups.knows": "Sa",
  "agentSettings.groups.does": "Fa",
  "agentSettings.groups.rules": "Regole",
  "agentSettings.saveFailed": "Impossibile salvare le impostazioni dell'agente.",

  "agentSettings.name": "Nome",
  "agentSettings.nameLabel": "Nome dell'agente",
  "agentSettings.agentTitle": "Titolo",
  "agentSettings.agentTitleLabel": "Titolo dell'agente",
  "agentSettings.agentTitlePlaceholder": "Descrivi cosa fa il tuo agente",
  "agentSettings.instructions": "Istruzioni",
  "agentSettings.instructionsLabel": "Istruzioni dell'agente",
  "agentSettings.instructionsPlaceholder": "A cosa serve questo agente",

  "agentSettings.avatar.edit": "Modifica l'avatar dell'agente",
  "agentSettings.avatar.editor": "Editor dell'avatar",
  "agentSettings.avatar.attachFiles": "Allega file",
  "agentSettings.avatar.image": "Immagine",
  "agentSettings.avatar.replaceImage": "Sostituisci l'immagine",
  "agentSettings.avatar.uploadImage": "Carica un'immagine",
  "agentSettings.avatar.imageHint": "PNG, JPEG o WebP · ritaglio quadrato",
  "agentSettings.avatar.generatedFace": "Volto generato",
  "agentSettings.avatar.resetToId": "Ripristina da ID",
  "agentSettings.avatar.newSet": "Nuovo set",
  "agentSettings.avatar.faces": "Volti avatar generati",
  "agentSettings.avatar.selected": "Avatar selezionato",
  "agentSettings.avatar.option": "Opzione avatar {number}",
  "agentSettings.avatar.color": "Colore",
  "agentSettings.avatar.colorLabel": "Colore dell'avatar",
  "agentSettings.avatar.autoColor": "Colore dell'avatar automatico",
  "agentSettings.avatar.autoInitial": "A",
  "agentSettings.avatar.hueColor": "Avatar di colore {hue}",
  "agentSettings.avatar.saveFailed": "Impossibile salvare l'avatar dell'agente.",
  "agentSettings.avatar.processFailed": "Impossibile elaborare l'avatar dell'agente.",

  "agentSettings.runtime.model": "Modello dell'agente",
  "agentSettings.runtime.modelBusy": "Attendi la fine del lavoro in corso prima di cambiare modello.",
  "agentSettings.runtime.modelUnavailable": "I modelli sono disponibili dopo la connessione di una CLI dell'agente.",
  "agentSettings.runtime.reasoning": "Ragionamento",
  "agentSettings.runtime.reasoningLabel": "Livello di ragionamento dell'agente",
  "agentSettings.runtime.selectReasoning": "Scegli il ragionamento",
  "agentSettings.runtime.reasoningSetByProvider": "Impostato da {provider}",
  "agentSettings.runtime.access": "Accesso",
  "agentSettings.runtime.accessLabel": "Accesso dell'agente",
  "agentSettings.runtime.busyMessage": "Durante il lavoro",
  "agentSettings.runtime.busyMessageLabel": "Messaggi mentre l'agente lavora",
  "agentSettings.runtime.workingDirectory": "Cartella di lavoro",
  "agentSettings.runtime.notAvailable": "Non ancora disponibile",
  "agentSettings.runtime.fullAccessNote":
    "L'agente gira con accesso completo al computer dal suo workspace e dalla cartella condivisa.",
  "agentSettings.runtime.claudeApprovalNote":
    "Claude agisce senza chiedere approvazione, tranne per le domande che ti rivolge.",
  "agentSettings.runtime.providerApprovalNote":
    "A seconda del provider, i comandi sensibili possono chiedere prima l'approvazione.",

  "agentSettings.access.workspace": "Solo workspace",
  "agentSettings.access.full": "Accesso completo",
  "agentSettings.busyMessage.appDefaultQueue": "Predefinito dell'app (Coda)",
  "agentSettings.busyMessage.appDefaultSteer": "Predefinito dell'app (Indirizza)",
  "agentSettings.busyMessage.queue": "Coda",
  "agentSettings.busyMessage.steer": "Indirizza",
  "agentSettings.busyMessage.steerUnsupported":
    "{provider} non può indirizzare un turno in corso. I messaggi inviati mentre lavora restano in coda.",

  "agentSettings.notifications.title": "Notifiche",

  "agentSettings.newChat.title": "Nuova chat",
  "agentSettings.newChat.description": "L'agente dimentica questa chat. La sua configurazione resta.",
  "agentSettings.newChat.button": "Inizia",
  "agentSettings.newChat.confirmTitle": "Iniziare una nuova chat con {name}?",
  "agentSettings.newChat.confirmDescription":
    "L'agente dimentica questa chat. I messaggi restano visibili sopra un divisore. Istruzioni, modello, tool, memorie, workspace e browser non cambiano.",
  "agentSettings.newChat.confirm": "Inizia una nuova chat",
  "agentSettings.newChat.failed": "Impossibile iniziare una nuova chat.",

  "agentSettings.fullAccess.title": "Dare accesso completo a questo agente?",
  "agentSettings.fullAccess.description":
    "L'agente potrà leggere, modificare ed eliminare qualsiasi file raggiungibile dal tuo account utente, eseguire qualsiasi comando e usare la rete. Un'istruzione fraintesa o una pagina web malevola può arrivare ai tuoi file personali.",
  "agentSettings.fullAccess.cancel": "Resta solo nel workspace",
  "agentSettings.fullAccess.confirm": "Consenti l'accesso completo",

  "agentSettings.links.usage": "Utilizzo",
  "agentSettings.links.memories": "Memorie",
  "agentSettings.links.memoriesCount": { one: "{count} salvata", other: "{count} salvate" },
  "agentSettings.links.skills": "Skill",
  "agentSettings.links.skillsCount": { one: "{count} assegnata", other: "{count} assegnate" },
  "agentSettings.links.tables": "Tabelle",
  "agentSettings.links.tablesCount": { one: "{count} tabella", other: "{count} tabelle" },
  "agentSettings.links.files": "File",
  "agentSettings.links.routines": "Routine",
  "agentSettings.links.routinesCount": { one: "{count} configurata", other: "{count} configurate" },
  "agentSettings.runtime.workspaceNote":
    "«Solo workspace» limita le scritture al workspace di questo agente, alla cartella condivisa e alle cartelle temporanee. Lettura e rete restano disponibili.",
  "agentSettings.runtime.workspaceEnforcedCommand":
    "Un comando che deve scrivere all'esterno te lo chiede prima, anche con l'approvazione automatica attiva.",
  "agentSettings.runtime.workspaceEnforcedClaude":
    "Una modifica a un file all'esterno te la chiede prima, anche con l'approvazione automatica attiva. Un comando non può scrivere all'esterno.",
  "agentSettings.runtime.workspaceUnlimited":
    "Il controllo del computer e il browser di OpenBot non sono limitati; puoi disattivare il controllo del computer qui sotto.",
  "agentSettings.computerUse.title": "Controllo del computer",
  "agentSettings.computerUse.description": "Permetti a questo agente di controllare le app su questo computer",
  "agentSettings.automation.title": "Script locali",
  "agentSettings.automation.description":
    "Permetti agli script sull'host di inviare messaggi, eseguire routine, rispondere alle domande e accettare o rifiutare le approvazioni",
  "agentSettings.runtime.workspaceEnforcedProcess":
    "L'intero processo di {provider} gira in una sandbox, quindi una scrittura all'esterno non riesce. Disponibile solo su macOS.",
} as const satisfies PartialTranslation<typeof source>;
