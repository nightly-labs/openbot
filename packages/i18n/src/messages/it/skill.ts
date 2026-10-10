import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/skill";

export const messages = {
  "skill.title": "Skill",
  "skill.close": "Chiudi le skill",
  "skill.detailsDescription": "Dettagli di {name}",
  "skill.assignedDescription": "Skill assegnate a {name}",
  "skill.addFromMarketplace": "Aggiungi dal Marketplace",
  "skill.limitReached":
    "Questo agente ha raggiunto il limite di {limit} skill. Rimuovi una skill prima di aggiungerne un'altra.",
  "skill.managedOnHost": "Le skill di questo agente sono gestite sull'host.",
  "skill.loading": "Caricamento delle skill…",
  "skill.loadingDetails": "Caricamento dei dettagli…",
  "skill.emptyEnabled": "Questo agente non ha skill attive.",
  "skill.emptyAssigned": "Questo agente non ha ancora skill assegnate.",
  "skill.folderSkill": "OpenBot non ha installato questa skill. Modificala o rimuovila in {location}.",
  "skill.localOnHost": "Questa skill locale è salvata sull'host. Apri i suoi dettagli su quel computer.",
  "skill.moreFor": "Altro per {name}",
  "skill.update": "Aggiorna",
  "skill.updateName": "Aggiorna {name}",
  "skill.enableName": "Attiva {name}",
  "skill.repair": "Ripara",
  "skill.uninstall": "Disinstalla",
  "skill.version": "v{version}",
  "skill.versionUpdate": "v{installed} · v{available} disponibile",

  "skill.loadFailed": "Impossibile caricare le skill.",
  "skill.loadDetailsFailed": "Impossibile caricare i dettagli della skill.",
  "skill.enableFailed": "Impossibile attivare la skill.",
  "skill.disableFailed": "Impossibile disattivare la skill.",
  "skill.removeFailed": "Impossibile rimuovere la skill.",
  "skill.updateFailed": "Impossibile aggiornare la skill.",

  "skill.confirm.replaceTitle": "Sostituire le modifiche locali?",
  "skill.confirm.removeTitle": "Rimuovere questa skill?",
  "skill.confirm.replaceBody":
    "L'aggiornamento di questa skill sostituisce i file locali con l'ultimo pacchetto della skill. Le tue modifiche nella cartella della skill andranno perse.",
  "skill.confirm.removeModifiedBody":
    "Questa skill ha modifiche locali nel workspace dell'agente. Rimuovi elimina quei file. I messaggi originali della chat restano.",
  "skill.confirm.removeBody": "OpenBot rimuoverà questa skill dall'agente. La cronologia della chat resta.",
  "skill.confirm.replace": "Sostituisci skill",
  "skill.confirm.remove": "Rimuovi skill",

  "skill.unavailable.readOnly": "Le skill remote sono di sola lettura.",
  "skill.unavailable.add": "Aggiungi questa skill per provarla.",
  "skill.unavailable.repair": "Ripara questa skill per provarla.",
  "skill.unavailable.updateVersion": "Aggiorna questa skill per provare questa versione.",
  "skill.unavailable.updateRevision": "Aggiorna questa skill per provare questa revisione.",
  "skill.unavailable.saving": "Attendi che la skill finisca di salvarsi, poi provala.",
  "skill.unavailable.composer": "Il campo di scrittura dell'agente non è disponibile.",

  "skill.toolbar.source": "Origine della skill",
  "skill.toolbar.all": "Tutte",
  "skill.toolbar.local": "Locali",
  "skill.toolbar.enabled": "Attive",
  "skill.toolbar.create": "Crea skill",

  "skill.local.loadFailed": "Impossibile caricare le skill locali.",
  "skill.local.toggleFailed": "Impossibile cambiare lo stato della skill.",
  "skill.local.addFailed": "Impossibile aggiungere la skill locale.",
  "skill.local.back": "Torna alle skill locali",
  "skill.local.added": "Aggiunta",
  "skill.local.add": "Aggiungi skill",
  "skill.local.loading": "Caricamento delle skill locali…",
  "skill.local.empty": "Ancora nessuna skill locale.",

  "skill.preview.label": "Anteprima di {name}",
  "skill.preview.creator": "Di {name}",
  "skill.preview.examplePrompt": "Aiutami a usare questa skill.",
  "skill.preview.try": "Prova la skill",
  "skill.preview.linkFailed": "Impossibile aprire il link.",
} as const satisfies PartialTranslation<typeof source>;
