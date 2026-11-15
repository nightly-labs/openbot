import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/uiBlock";

export const messages = {
  "uiBlock.status.answered": "Risposto",
  "uiBlock.status.waiting": "Tocca a te",
  "uiBlock.outcome.expired": "Nessuna risposta in tempo",
  "uiBlock.outcome.closed": "Chiuso senza risposta",
  "uiBlock.outcome.autoAnswered": "{outcome} (nessuno ha risposto in tempo)",
  "uiBlock.confirm.holdHint":
    "Tieni premuto il pulsante per confermare, oppure premilo per confermare in un secondo passaggio",
  "uiBlock.confirm.prompt": "Confermare: {action}?",
  "uiBlock.confirm.accept": "Conferma",
  "uiBlock.confirm.autoActionLabel": "{action} · {seconds} s",
  "uiBlock.confirm.autoActionClock": "{action} · {time}",
  "uiBlock.confirm.previewLabel": "Anteprima",
  "uiBlock.confirm.showFullPreview": "Mostra tutto",
  "uiBlock.confirm.hideFullPreview": "Mostra meno",
  "uiBlock.choice.submit": "Invia",
  "uiBlock.choice.shortcutHint": "Premi {first}–{last} per scegliere",
  "uiBlock.quick.label": "Risposte rapide",
  "uiBlock.form.submit": "Invia",
  "uiBlock.form.required": "Campo obbligatorio",
  "uiBlock.form.choose": "Scegli un'opzione",
  "uiBlock.form.notSet": "Non impostato",
  "uiBlock.form.invalid": "Alcune risposte non sono corrette. Controllale e riprova.",
  "uiBlock.form.hiddenValue": "Nascosto",
  "uiBlock.skip": "Salta",
  "uiBlock.error.answerFailed": "Impossibile inviare la risposta. Riprova.",
} as const satisfies PartialTranslation<typeof source>;
