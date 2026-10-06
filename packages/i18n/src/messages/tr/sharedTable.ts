import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tablolar",
  "sharedTable.description": "Ajanların görevler arasında sakladığı veriler ve her bir kayıt kümesini başlatan ajan",
  "sharedTable.close": "Tabloları kapat",
  "sharedTable.loading": "Tablolar yükleniyor…",
  "sharedTable.empty":
    "Henüz tablo yok. Bir görev turlar arasında kayıtlara ihtiyaç duyduğunda ajan bunu kendisi oluşturur ve her ajan kullanabilir.",
  "sharedTable.loadFailed": "Tablolar yüklenemedi.",
  "sharedTable.deleteFailed": "Bu öge silinemedi.",
  "sharedTable.madeOutside": "OpenBot dışında oluşturuldu · herhangi bir ajan silebilir",
  "sharedTable.keptBy": "{name} tarafından tutuluyor",
  "sharedTable.keptByDeleted": "Artık var olmayan bir ajan tarafından tutuluyor",
  "sharedTable.deleteName": "{name} ögesini sil",
  "sharedTable.confirmDelete": "Bu tüm ajanlar için silinsin mi? Kayıtlar kurtarılamaz.",
  "sharedTable.notCounted": "sayılmadı",
  "sharedTable.records": { one: "{count} kayıt", other: "{count} kayıt" },
} as const satisfies PartialTranslation<typeof source>;
