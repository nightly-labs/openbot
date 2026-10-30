import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Wybierz katalog statycznej strony",
  "dialog.chooseAgentFolder": "Wybierz folder dla agenta {agent}",
  "dialog.chooseAgentExclusion": "Wybierz folder, którego {agent} nie może zmieniać",
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
  "dialog.saveTransfer": "Zapisz plik przeniesienia",
  "dialog.chooseTransfer": "Wybierz plik przeniesienia",
  "dialog.filter.transfer": "Pliki przeniesienia OpenBot",
  "dialog.chooseExternalLinkApp": "Wybierz przeglądarkę",
  "dialog.filter.applications": "Aplikacje",
} as const satisfies PartialTranslation<typeof source>;
