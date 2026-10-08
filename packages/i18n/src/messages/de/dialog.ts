import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Verzeichnis für eine statische Website auswählen",
  "dialog.chooseSkill": "Fähigkeitsordner oder ZIP auswählen",
  "dialog.filter.skillPackages": "Fähigkeitspakete",
  "dialog.filter.images": "Bilder",
  "dialog.filter.supportedFiles": "Unterstützte Dateien",
  "dialog.filter.attachment": "Anhang",
  "dialog.filter.zipArchive": "ZIP-Archiv",
  "dialog.filter.jsonDocument": "JSON-Dokument",
  "dialog.chooseAgentExport": "Agentenexport auswählen",
  "dialog.filter.agentExports": "Agentenexporte",
  "dialog.saveExportSkill": "Exportfähigkeit speichern",
} as const satisfies PartialTranslation<typeof source>;
