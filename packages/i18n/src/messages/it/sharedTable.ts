import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tabelle",
  "sharedTable.description":
    "Ciò che gli agenti conservano tra un'attività e l'altra, con l'agente che ha avviato ogni insieme di record",
  "sharedTable.close": "Chiudi le tabelle",
  "sharedTable.loading": "Caricamento delle tabelle…",
  "sharedTable.empty":
    "Ancora nessuna tabella. Un agente ne crea una da solo quando un'attività ha bisogno di record tra un turno e l'altro, e ogni agente può usarla.",
  "sharedTable.loadFailed": "Impossibile caricare le tabelle.",
  "sharedTable.deleteFailed": "Impossibile eliminare questo elemento.",
  "sharedTable.madeOutside": "Creata fuori da OpenBot · qualsiasi agente può eliminarla",
  "sharedTable.keptBy": "Gestita da {name}",
  "sharedTable.keptByDeleted": "Gestita da un agente che non esiste più",
  "sharedTable.deleteName": "Elimina {name}",
  "sharedTable.confirmDelete": "Eliminare per tutti gli agenti? I record non si possono recuperare.",
  "sharedTable.notCounted": "non conteggiato",
  "sharedTable.records": { one: "{count} record", other: "{count} record" },
} as const satisfies PartialTranslation<typeof source>;
