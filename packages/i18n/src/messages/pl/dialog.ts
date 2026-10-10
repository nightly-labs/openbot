import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Wybierz katalog statycznej strony",
  "dialog.chooseSkill": "Wybierz folder umiejętności lub plik ZIP",
  "dialog.filter.skillPackages": "Pakiety umiejętności",
  "dialog.filter.images": "Obrazy",
  "dialog.filter.supportedFiles": "Obsługiwane pliki",
  "dialog.filter.attachment": "Załącznik",
  "dialog.filter.zipArchive": "Archiwum ZIP",
  "dialog.filter.jsonDocument": "Dokument JSON",
  "dialog.chooseAgentExport": "Wybierz eksport agenta",
  "dialog.filter.agentExports": "Eksporty agentów",
  "dialog.saveExportSkill": "Zapisz umiejętność eksportu",
} as const satisfies PartialTranslation<typeof source>;
