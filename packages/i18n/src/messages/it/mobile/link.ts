import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot non è riuscito a connettersi. Riprova.",
  "mobile.link.invite.signInTitle": "Accedi per unirti a questo server",
  "mobile.link.invite.signInDescription":
    "Scansiona il codice QR in OpenBot sul computer. Poi potrai controllare l'invito.",
  "mobile.link.invite.cancel": "Annulla invito",
  "mobile.link.pairing.title": "Collega questo telefono",
  "mobile.link.pairing.alreadySignedIn":
    "Hai già effettuato l'accesso. Esci dalle Impostazioni prima di collegare un altro account.",
  "mobile.link.pairing.description": "Continua solo se hai richiesto tu questo link Mobile Connect dal computer.",
  "mobile.link.pairing.connect": "Connetti",
  "mobile.link.plugin.title": "Apri la pagina del plugin",
  "mobile.link.plugin.description": "Guarda questo plugin sul sito di OpenBot.",
  "mobile.link.plugin.openFailed": "Impossibile aprire la pagina del plugin.",
  "mobile.link.plugin.view": "Vedi plugin",
  "mobile.link.unavailable.title": "Link non disponibile",
  "mobile.link.unavailable.description":
    "Questo link non è valido, non è più disponibile o non è supportato sul telefono.",
  "mobile.link.template.signInTitle": "Accedi per aggiungere questo agente",
  "mobile.link.template.signInDescription":
    "Scansiona il codice QR in OpenBot sul computer. Poi potrai controllare l'agente prima di aggiungerlo.",
  "mobile.link.template.loading": "Caricamento dell'agente…",
  "mobile.link.template.creator": "Di {name}",
  "mobile.link.template.section.instructions": "Istruzioni",
  "mobile.link.template.section.skills": "Skill",
  "mobile.link.template.section.noSkills": "Nessuna skill.",
  "mobile.link.template.section.routines": "Routine",
  "mobile.link.template.section.noRoutines": "Nessuna routine.",
  "mobile.link.template.skill.local": "Skill locale (solo SKILL.md)",
  "mobile.link.template.skill.marketplace": "Skill del Marketplace, versione {version}",
  "mobile.link.template.server.title": "Aggiungi al server",
  "mobile.link.template.server.footer": "Sono elencati solo i server di cui sei proprietario o amministratore.",
  "mobile.link.template.server.updateRequired": "Aggiorna OpenBot su questo server per aggiungere agenti condivisi.",
  "mobile.link.template.server.none":
    "Per aggiungere un agente condiviso devi essere proprietario o amministratore di un server.",
  "mobile.link.template.install.action": "Aggiungi agente",
  "mobile.link.template.install.pending": "Aggiunta in corso…",
  "mobile.link.template.install.failed": "Impossibile aggiungere l'agente.",
  "mobile.link.template.notFound.title": "Agente non trovato",
  "mobile.link.template.notFound.description": "Questo agente condiviso non esiste o il suo autore lo ha rimosso.",
  "mobile.link.template.error.title": "Impossibile caricare l'agente",
  "mobile.link.template.error.loadFailed": "Impossibile leggere l'agente condiviso. Riprova.",
  "mobile.link.template.error.unsupported":
    "Questo server non può aggiungere agenti condivisi. Aggiorna OpenBot sul computer su cui gira il server.",
} as const satisfies PartialTranslation<typeof source>;
