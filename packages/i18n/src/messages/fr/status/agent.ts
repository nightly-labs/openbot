import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Écrire {path}, hors de l’espace de travail de l’agent, du dossier partagé et des dossiers temporaires.",
  "status.agent.contextCleared": "Contexte effacé. Une nouvelle discussion commence ici.",
} as const satisfies PartialTranslation<typeof source>;
