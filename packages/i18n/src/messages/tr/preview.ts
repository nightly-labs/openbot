import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Dosya önizlemesi",
  "preview.panel.resize": "Dosya önizlemesini yeniden boyutlandır",
  "preview.panel.openExternally": "Dosyayı harici uygulamada aç",
  "preview.panel.download": "Dosyayı indir",
  "preview.panel.reveal": "Dosyayı Finder'da göster",
  "preview.panel.close": "Dosya önizlemesini kapat",
  "preview.panel.back": "Geri",
  "preview.panel.rawMarkdown": "Markdown kaynağını göster",
  "preview.panel.rawHtml": "HTML kaynağını göster",
  "preview.panel.wrapLines": "Uzun satırları kaydır",
  "preview.folder.empty": "Bu klasör boş.",
  "preview.folder.truncated": "Yalnızca ilk {limit} öğe gösteriliyor.",
  "preview.truncated": "Önizleme {limit} karakterden sonra kesildi.",
  "preview.unavailable": "Önizleme kullanılamıyor.",
  "preview.unsupported.title": "Önizleme kullanılamıyor",
  "preview.unsupported.description": "Bu dosya türü varsayılan uygulamasında açılabilir.",
  "preview.unsupported.openExternally": "Harici olarak aç",
  "preview.spreadsheet.readFailed": "Bu elektronik tablo okunamadı.",
  "preview.spreadsheet.truncated": "Önizleme ilk {rows} satır ve {columns} sütunla sınırlandırıldı.",
} as const satisfies PartialTranslation<typeof source>;
