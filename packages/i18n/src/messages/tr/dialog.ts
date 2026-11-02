import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Statik site dizinini seçin",
  "dialog.chooseAgentFolder": "{agent} için bir klasör seçin",
  "dialog.chooseAgentExclusion": "{agent} adlı ajanın değiştirmemesi gereken klasörü seç",
  "dialog.chooseSkill": "Bir beceri klasörü veya ZIP seçin",
  "dialog.filter.skillPackages": "Beceri paketleri",
  "dialog.filter.images": "Görseller",
  "dialog.filter.supportedFiles": "Desteklenen dosyalar",
  "dialog.filter.attachment": "Ek",
  "dialog.filter.zipArchive": "ZIP arşivi",
  "dialog.filter.jsonDocument": "JSON belgesi",
  "dialog.chooseAgentExport": "Bir ajan dışa aktarımı seçin",
  "dialog.filter.agentExports": "Ajan dışa aktarımları",
  "dialog.saveExportSkill": "Dışa aktarma becerisini kaydet",
  "dialog.saveTransfer": "Aktarım dosyasını kaydet",
  "dialog.chooseTransfer": "Bir aktarım dosyası seçin",
  "dialog.filter.transfer": "OpenBot aktarım dosyaları",
  "dialog.chooseExternalLinkApp": "Tarayıcı seçin",
  "dialog.filter.applications": "Uygulamalar",
} as const satisfies PartialTranslation<typeof source>;
